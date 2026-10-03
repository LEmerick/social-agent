/**
 * Scheduler d'époque (engine-architecture.md §6) : phases 1 à 7, boucle de ticks, une transaction par tick.
 *
 * Phases émises sur le bus : `init`, `plan`, `ticks` (phase 3, avec déplacements et scènes), `economy` (5),
 * `memory` (6), `close` (7). Chaque tick calcule son `TickBatch` en mémoire puis l'écrit d'un bloc
 * (`journal.commitTick`), ce qui positionne `last_committed_tick`. La clôture est une dernière transaction.
 *
 * Reprise : `resume(epochId)` recharge l'état (`loadSimStateWithRuntime`) et la timeline ouverte du journal,
 * puis repart à `last_committed_tick + 1`. La saison est relue par `seasons.findById`.
 */
import { DomainError } from '../core/errors.js';
import { simIdFactory } from '../core/sim-ids.js';
import type { DecisionPolicy, DestinationChoice, OutcomeModel } from '../decision/ports.js';
import type { CharacterStatus, StoragePort } from '../ports/storage.js';
import { type CharacterStateRecord, type SceneRecord, emptyTickBatch } from '../state/journal.js';
import { type TransitZones, loadSimStateWithRuntime, runtimeOf } from '../state/load-runtime.js';
import type { Id, SimState } from '../state/types.js';
import { EngineBus } from './bus.js';
import { type RunScope, createTickContext, idsOf, rngOf } from './context.js';
import { Timeline, sortedIds } from './timeline.js';
import type { EpochHooks, EpochResult, EpochRun, EpochRunOptions, MutableTickBatch, TickHook } from './types.js';

export interface EpochSchedulerDeps {
  readonly storage: StoragePort;
  readonly decision: DecisionPolicy;
  readonly outcome?: OutcomeModel;
  readonly hooks?: EpochHooks;
}

export interface EpochScheduler {
  run(options: EpochRunOptions): EpochRun;
  resume(epochId: Id): EpochRun;
}

type Target = ({ readonly kind: 'run' } & EpochRunOptions) | { readonly kind: 'resume'; readonly epochId: Id };

export function createEpochScheduler(deps: EpochSchedulerDeps): EpochScheduler {
  const start = (target: Target): EpochRun => {
    const bus = new EngineBus();
    // Un tour de boucle de latence : l'appelant a le temps de brancher ses écouteurs sur `bus` avant la phase `init`.
    const done = Promise.resolve().then(() => execute(deps, bus, target));
    return { bus, done };
  };
  return {
    run: (options) => start({ kind: 'run', ...options }),
    resume: (epochId) => start({ kind: 'resume', epochId }),
  };
}

const newBatch = (epochId: Id, tick: number): MutableTickBatch => emptyTickBatch(epochId, tick) as MutableTickBatch;

interface Started {
  readonly scope: RunScope;
  readonly firstTick: number;
  /** Lot du tick 0 déjà ouvert par la phase `plan` (null à la reprise). */
  readonly planBatch: MutableTickBatch | null;
}

async function execute(deps: EpochSchedulerDeps, bus: EngineBus, target: Target): Promise<EpochResult> {
  const started = await initialise(deps, bus, target);
  const { scope } = started;
  const { ticksPerEpoch } = scope.state.world.config;
  try {
    let planBatch = started.planBatch;
    if (planBatch) {
      bus.emit('phase.started', { epoch: scope.epochNumber, phase: 'plan' });
      scope.state.tick = 0;
      await deps.hooks?.plan?.(createTickContext(scope, 'plan', 0, planBatch));
    }

    bus.emit('phase.started', { epoch: scope.epochNumber, phase: 'ticks' });
    for (let tick = started.firstTick; tick < ticksPerEpoch; tick++) {
      await playTick(deps, scope, tick, tick === 0 && planBatch ? planBatch : newBatch(scope.epochId, tick));
      planBatch = null;
    }

    await closeEpoch(deps, scope);
  } catch (error) {
    await deps.storage.tx((s) => s.epochs.setStatus(scope.epochId, 'failed')).catch(() => undefined);
    throw error;
  }
  return { epochId: scope.epochId, number: scope.epochNumber, firstTick: started.firstTick, ticksPerEpoch };
}

async function initialise(deps: EpochSchedulerDeps, bus: EngineBus, target: Target): Promise<Started> {
  const { storage } = deps;
  let state: SimState;
  let transitZones: TransitZones;
  let timeline: Timeline;
  let epoch: { readonly id: Id; readonly number: number };
  let firstTick = 0;

  if (target.kind === 'run') {
    const existing = await storage.tx((s) => s.epochs.findByNumber(target.worldId, target.number));
    if (existing) {
      throw new DomainError('EPOCH_EXISTS', `L'époque ${String(target.number)} existe déjà (${existing.status})`);
    }
    ({ state, transitZones } = await loadSimStateWithRuntime(storage, target.worldId, target.seasonNumber, {
      epochNumber: target.number,
      resume: false,
    }));
    requireTicks(state);
    const epochId = simIdFactory(state.world.seed, state.world.config, target.number, 0, 'epoch').next();
    await storage.tx((s) =>
      s.epochs.insert({
        id: epochId,
        worldId: state.world.id,
        seasonId: state.season.id,
        number: target.number,
        status: 'running',
        rngSeed: `${state.world.seed}|epoch:${String(target.number)}`,
        rulesVersion: state.season.rulesVersion,
        lastCommittedTick: -1,
      }),
    );
    epoch = { id: epochId, number: target.number };
    timeline = new Timeline(transitZones);
  } else {
    const record = await storage.tx((s) => s.epochs.findById(target.epochId));
    if (!record) throw new DomainError('NOT_FOUND', `Époque ${target.epochId} introuvable`);
    if (record.status === 'completed') throw new DomainError('EPOCH_COMPLETED', `L'époque ${record.id} est terminée`);
    const season = await storage.tx((s) => s.seasons.findById(record.seasonId));
    if (!season) throw new DomainError('NOT_FOUND', `Saison ${record.seasonId} introuvable`);

    const midway = record.lastCommittedTick >= 0;
    ({ state, transitZones } = await loadSimStateWithRuntime(storage, record.worldId, season.number, {
      epochNumber: record.number,
      resume: midway,
    }));
    requireTicks(state);
    timeline = midway
      ? Timeline.restore(await storage.tx((s) => s.journal.read(record.id)), transitZones)
      : new Timeline(transitZones);
    firstTick = record.lastCommittedTick + 1;
    epoch = { id: record.id, number: record.number };
    await storage.tx((s) => s.epochs.setStatus(record.id, 'running'));
  }

  state.epoch = epoch;
  bus.emit('phase.started', { epoch: epoch.number, phase: 'init' });
  const scope: RunScope = {
    state,
    timeline,
    bus,
    decision: deps.decision,
    outcome: deps.outcome,
    epochId: epoch.id,
    epochNumber: epoch.number,
    idFactories: new Map(),
  };
  return { scope, firstTick, planBatch: firstTick === 0 ? newBatch(epoch.id, 0) : null };
}

function requireTicks(state: SimState): void {
  const { ticksPerEpoch } = state.world.config;
  if (!Number.isInteger(ticksPerEpoch) || ticksPerEpoch < 1) {
    throw new DomainError('INVALID_CONFIG', `ticksPerEpoch invalide : ${String(ticksPerEpoch)}`);
  }
}

/** Phase 3 pour un tick : déplacements, scènes, hooks `tick`, puis une transaction. */
async function playTick(
  deps: EpochSchedulerDeps,
  scope: RunScope,
  tick: number,
  batch: MutableTickBatch,
): Promise<void> {
  const { state, timeline } = scope;
  state.tick = tick;
  const ctx = createTickContext(scope, 'ticks', tick, batch);
  await deps.hooks?.beforeTick?.(ctx);

  const choices = new Map<Id, DestinationChoice>();
  for (const actorId of timeline.choosers(state)) {
    choices.set(
      actorId,
      await deps.decision.chooseDestination({ actorId, state, rng: rngOf(scope, tick, 'destination', actorId) }),
    );
  }
  timeline.move(state, tick, choices);
  const openBefore = new Map(timeline.scenes);
  timeline.place(state, tick, scope.epochId, batch, {
    scene: idsOf(scope, tick, 'scene'),
    presence: idsOf(scope, tick, 'presence'),
  });

  for (const hook of deps.hooks?.tick ?? []) await hook(ctx);

  batch.characterStates = characterStates(scope);
  await deps.storage.tx((s) => s.journal.commitTick(batch));
  publish(scope, batch, openBefore);
  scope.bus.emit('tick.committed', { epoch: scope.epochNumber, tick });
}

/** Phases 5 à 7 : un lot de clôture (tick = `ticksPerEpoch`) commité avec le snapshot et le statut `completed`. */
async function closeEpoch(deps: EpochSchedulerDeps, scope: RunScope): Promise<void> {
  const { state, timeline, bus } = scope;
  const end = state.world.config.ticksPerEpoch;
  state.tick = end;
  const batch = newBatch(scope.epochId, end);

  const phases: readonly (readonly ['economy' | 'memory' | 'close', TickHook | undefined])[] = [
    ['economy', deps.hooks?.economy],
    ['memory', deps.hooks?.memory],
    ['close', deps.hooks?.close],
  ];
  for (const [phase, hook] of phases) {
    bus.emit('phase.started', { epoch: scope.epochNumber, phase });
    await hook?.(createTickContext(scope, phase, end, batch));
  }

  const openBefore = new Map(timeline.scenes);
  timeline.closeAll(end, batch);
  batch.characterStates = characterStates(scope);
  const relationships = Object.keys(state.relationships)
    .sort()
    .map((key) => structuredClone(state.relationships[key]))
    .filter((edge) => edge !== undefined);
  await deps.storage.tx(async (s) => {
    await s.journal.commitTick(batch);
    await s.snapshots.saveRelationships(scope.epochId, relationships);
    await s.epochs.setStatus(scope.epochId, 'completed');
  });
  publish(scope, batch, openBefore);
  bus.emit('tick.committed', { epoch: scope.epochNumber, tick: end });
  bus.emit('epoch.completed', { epochId: scope.epochId });
}

/** Une ligne `character_state` par personnage, avec les données de reprise. */
function characterStates(scope: RunScope): CharacterStateRecord[] {
  const { state, epochId, timeline } = scope;
  return sortedIds(state).flatMap((characterId) => {
    const character = state.characters[characterId];
    if (!character) return [];
    return [
      {
        characterId,
        epochId,
        stats: { ...character.stats },
        credits: character.credits,
        status: character.status,
        mood: { ...character.mood },
        scores: { ...character.scores },
        runtime: runtimeOf(state, characterId, timeline.transitZones),
      },
    ];
  });
}

/** Publie sur le bus ce que le tick a écrit, après son commit. */
function publish(scope: RunScope, batch: MutableTickBatch, openBefore: ReadonlyMap<Id, SceneRecord>): void {
  const { bus } = scope;
  for (const scene of batch.scenesOpened) bus.emit('scene.opened', { scene });
  for (const closed of batch.scenesClosed) {
    const scene = openBefore.get(closed.id);
    if (scene) bus.emit('scene.closed', { scene: { ...scene, tickEnd: closed.tickEnd } });
  }
  for (const event of batch.events) {
    bus.emit('event', { event });
    if (event.type === 'status_changed') {
      const { characterId, from, to } = event.payload as {
        characterId: Id;
        from: CharacterStatus;
        to: CharacterStatus;
      };
      bus.emit('character.status', { characterId, from, to });
    }
  }
  for (const utterance of batch.utterances) bus.emit('utterance', { utterance });
  for (const effect of batch.effects) bus.emit('effect.applied', { effect });
}

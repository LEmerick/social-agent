import type { IdFactory } from '../core/id.js';
import { Rng } from '../core/rng.js';
import { simIdFactory } from '../core/sim-ids.js';
import type { DecisionPolicy, OutcomeModel } from '../decision/ports.js';
import { type Listener, audience } from '../scene/audience.js';
import type { Id, SimState, Volume } from '../state/types.js';
import type { EngineBus, Phase } from './bus.js';
import type { Timeline } from './timeline.js';
import type { MutableTickBatch, SceneView, TickContext } from './types.js';

/** Ce que partagent tous les contextes d'une exécution. */
export interface RunScope {
  readonly state: SimState;
  readonly timeline: Timeline;
  readonly bus: EngineBus;
  readonly decision: DecisionPolicy;
  readonly outcome: OutcomeModel | undefined;
  readonly epochId: Id;
  readonly epochNumber: number;
  /** Fabriques d'identifiants, par (tick, flux) : un même flux ne repart jamais de zéro dans un tick. */
  readonly idFactories: Map<string, IdFactory>;
  /** Dernière ligne `character_state` écrite par cette exécution (JSON) : seules les lignes modifiées sont réécrites. */
  readonly writtenStates: Map<Id, string>;
}

export function idsOf(scope: RunScope, tick: number, stream: string): IdFactory {
  const key = `${String(tick)}|${stream}`;
  let factory = scope.idFactories.get(key);
  if (!factory) {
    factory = simIdFactory(scope.state.world.seed, scope.state.world.config, scope.epochNumber, tick, stream);
    scope.idFactories.set(key, factory);
  }
  return factory;
}

export function rngOf(scope: RunScope, tick: number, ...parts: ReadonlyArray<string | number>): Rng {
  return Rng.derive(scope.state.world.seed, scope.epochNumber, tick, ...parts);
}

export function createTickContext(scope: RunScope, phase: Phase, tick: number, batch: MutableTickBatch): TickContext {
  return {
    phase,
    state: scope.state,
    batch,
    epochId: scope.epochId,
    epochNumber: scope.epochNumber,
    tick,
    bus: scope.bus,
    decision: scope.decision,
    outcome: scope.outcome,
    get scenes(): readonly SceneView[] {
      return scope.timeline.views(scope.state);
    },
    rng: (...parts) => rngOf(scope, tick, ...parts),
    ids: (stream) => idsOf(scope, tick, stream),
    audience: (sceneId: Id, speakerId: Id, volume: Volume): Listener[] => {
      const view = scope.timeline.views(scope.state).find((v) => v.scene.id === sceneId);
      return audience(
        scope.state,
        (view?.members ?? []).map((m) => m.characterId),
        speakerId,
        volume,
      );
    },
  };
}

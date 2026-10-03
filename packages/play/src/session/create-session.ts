/**
 * Session de jeu : la Maison des Palmiers en mémoire, une époque à la fois, un personnage incarné.
 *
 * Le scheduler tourne en tâche de fond. Chaque fois qu’il a besoin du joueur (destination, action, issue), la session
 * publie une `PlayRequest` et suspend le moteur jusqu’à `answer`. Le reste du monde joue seul : politique
 * pondérée déterministe, ou LLM si un `LLMPort` est fourni. Le joueur ne reçoit que des événements perçus.
 */
import {
  AgendaDecisionPolicy,
  type DecisionPolicy,
  DomainError,
  type EpochHooks,
  type Id,
  type LLMPort,
  type OutcomeModel,
  type SimState,
  type StoragePort,
  HeuristicOutcomeModel,
  LlmDecisionPolicy,
  LlmDialogue,
  LlmOutcomeModel,
  SummaryDialogue,
  createEpochScheduler,
  economyHook,
  interactionHook,
  loadSimState,
  of,
  personaPrompt,
  relKey,
} from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { PALMIERS_CHARACTERS, PALMIERS_SEED, aWorld, seedWorld } from '@ai-reality/testkit';
import { ACQUAINTANCE_FR, BELIEF_FR, SOURCE_FR, clockOf, factText, nameOf } from './fr.js';
import { NpcDecisionPolicy } from './npc-policy.js';
import { Perception, visibleOthers } from './perception.js';
import { type Choice, PlayerDecisionPolicy, PlayerOutcomeModel, type Prompter } from './player-policy.js';
import type {
  EpochSummary,
  PlayClock,
  PlayMap,
  PlayEvent,
  PlayRequest,
  PlayRequestKind,
  PlaySignal,
  PlayerKnowledge,
  PlayerRelation,
  PlayerStatus,
} from './types.js';

export interface PlaySessionOptions {
  /** `alexandre`, `sarah`, `lea` ou `thomas`. */
  readonly characterSlug: string;
  /** Graine du monde (défaut : celle de la fixture des Palmiers). */
  readonly seed?: string;
  /** Nombre d’époques jouables à la suite (défaut 1). */
  readonly epochs?: number;
  /** Active les autres personnages, les issues et les dialogues par LLM. Sans lui, tout est local et déterministe. */
  readonly llm?: LLMPort;
  /** Stockage à utiliser (défaut : mémoire). Utile pour relire le journal après coup. */
  readonly storage?: StoragePort;
  /** Politique des autres personnages (défaut : tirage pondéré). Surtout utile aux tests. */
  readonly npc?: DecisionPolicy;
}

export interface PlaySession {
  readonly player: { readonly id: Id; readonly slug: string; readonly name: string };
  readonly seed: string;
  /** Prochaine chose à faire : une demande au joueur, ou la fin de l’époque. */
  next(): Promise<PlaySignal>;
  /** Répond à la demande en cours (`choice` : numéro d’option, à partir de 1). */
  answer(requestId: string, choice: number): void;
  /** Lance l’époque suivante après un `epoch_end` ; `false` s’il n’en reste pas. */
  nextEpoch(): boolean;
  onEvent(listener: (event: PlayEvent) => void): () => void;
  /** Journal perçu depuis le début de la session. */
  log(): readonly PlayEvent[];
  status(): PlayerStatus;
  relations(): PlayerRelation[];
  knowledge(): PlayerKnowledge[];
  clock(): PlayClock;
  /** Les lieux de la Maison et leurs liaisons (public). */
  map(): PlayMap;
  /** Abandonne la partie : la demande en cours est rejetée et le moteur s’arrête. */
  close(): void;
}

export const PLAYABLE_CHARACTERS: readonly { readonly slug: string; readonly name: string }[] = PALMIERS_CHARACTERS.map(
  (c) => ({ slug: c.slug, name: c.firstName }),
);

const SEASON_NUMBER = 1;

export async function createPlaySession(options: PlaySessionOptions): Promise<PlaySession> {
  const seed = options.seed ?? PALMIERS_SEED;
  const totalEpochs = Math.max(1, options.epochs ?? 1);
  const storage = options.storage ?? createMemoryStorage();
  const fixture = aWorld().withSeed(seed).build();
  const record = fixture.characters.find((c) => c.slug === options.characterSlug);
  if (!record) {
    const known = PLAYABLE_CHARACTERS.map((c) => c.slug).join(', ');
    throw new DomainError(
      'UNKNOWN_CHARACTER',
      `Personnage inconnu « ${options.characterSlug} » (choisir parmi : ${known})`,
    );
  }
  await seedWorld(storage, fixture);
  const playerId = record.id;
  let state: SimState = await loadSimState(storage, fixture.world.id, SEASON_NUMBER, { epochNumber: 0 });

  // ── Journal perçu ──
  const log: PlayEvent[] = [];
  const listeners = new Set<(e: PlayEvent) => void>();
  let currentEpoch = 0;
  const perception = new Perception(playerId, (draft) => {
    const event: PlayEvent = {
      seq: log.length,
      epoch: currentEpoch,
      time: clockOf(state.world.config, draft.tick),
      ...draft,
    };
    log.push(event);
    for (const l of listeners) l(event);
  });

  // ── Dialogue avec le moteur : demandes, signaux ──
  const signals: PlaySignal[] = [];
  const waiters: { resolve: (s: PlaySignal) => void; reject: (e: Error) => void }[] = [];
  let failure: Error | null = null;
  let closed = false;
  let requestCount = 0;
  let pending: {
    request: PlayRequest;
    values: readonly unknown[];
    resolve: (v: never) => void;
    reject: (e: Error) => void;
  } | null = null;

  const push = (signal: PlaySignal): void => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(signal);
    else signals.push(signal);
  };
  const fail = (error: Error): void => {
    failure = error;
    for (const w of waiters.splice(0)) w.reject(error);
  };

  const contextOf = (): PlayRequest['context'] => {
    const me = state.positions[playerId];
    const place = me?.kind === 'at' ? (state.locations[me.locationId]?.name ?? '?') : 'Hors-champ';
    const zoneSlug =
      me?.kind === 'at' ? state.locations[me.locationId]?.zones.find((z) => z.id === me.zoneId)?.slug : undefined;
    return { place, zone: zoneSlug ?? null, present: visibleOthers(state, playerId).map((id) => nameOf(state, id)) };
  };

  const prompter: Prompter = {
    ask<T>(question: { kind: PlayRequestKind; prompt: string; choices: readonly Choice<T>[] }): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (closed) {
          reject(new DomainError('SESSION_CLOSED', 'La partie est terminée'));
          return;
        }
        // Ce qui s'est passé dans ce tick (arrivée, départ, présents) est annoncé avant de poser la question.
        if (question.kind !== 'destination') perception.refreshPresence(state, state.tick);
        requestCount += 1;
        const request: PlayRequest = {
          id: `req-${String(requestCount)}`,
          kind: question.kind,
          epoch: currentEpoch,
          tick: state.tick,
          time: clockOf(state.world.config, state.tick),
          prompt: question.prompt,
          options: question.choices.map((c, i) => ({
            n: i + 1,
            label: c.label,
            ...(c.group === undefined ? {} : { group: c.group }),
          })),
          context: contextOf(),
        };
        pending = {
          request,
          values: question.choices.map((c) => c.value),
          resolve,
          reject,
        };
        push({ kind: 'request', request });
      });
    },
  };

  // ── Politiques ──
  // Les intentions différées (`tell`, issues de la propagation) passent avant le goût du moment.
  const npc = new AgendaDecisionPolicy(options.npc ?? new NpcDecisionPolicy());
  const persona = (id: Id): string => {
    const c = fixture.characters.find((x) => x.id === id);
    return c ? personaPrompt(c) : '';
  };
  const npcChoose: DecisionPolicy = options.llm
    ? new LlmDecisionPolicy({ llm: options.llm, persona, destination: npc })
    : npc;
  const player = new PlayerDecisionPolicy(playerId, prompter);
  const decision: DecisionPolicy = {
    choose: (input) => (input.actorId === playerId ? player.choose(input) : npcChoose.choose(input)),
    chooseDestination: (input) =>
      input.actorId === playerId ? player.chooseDestination(input) : npc.chooseDestination(input),
  };
  const innerOutcome: OutcomeModel = options.llm
    ? new LlmOutcomeModel({ llm: options.llm, persona })
    : new HeuristicOutcomeModel();
  const outcome = new PlayerOutcomeModel(playerId, prompter, innerOutcome);
  const dialogue = options.llm ? new LlmDialogue({ llm: options.llm, persona }) : new SummaryDialogue();

  let lastSummary: EpochSummary | null = null;
  const hooks: EpochHooks = {
    plan: (ctx) => {
      state = ctx.state;
      perception.begin(ctx.state);
    },
    tick: [
      interactionHook({ dialogue }),
      (ctx) => {
        state = ctx.state;
        perception.onTick(ctx);
      },
    ],
    economy: economyHook(),
    close: (ctx) => {
      perception.onClose(ctx);
      lastSummary = perception.summary(ctx.state, ctx.epochNumber);
    },
  };
  const scheduler = createEpochScheduler({ storage, decision, outcome, hooks });

  let epochsStarted = 0;
  let running = false;
  const startEpoch = (): void => {
    currentEpoch = epochsStarted;
    epochsStarted += 1;
    running = true;
    const run = scheduler.run({ worldId: fixture.world.id, seasonNumber: SEASON_NUMBER, number: currentEpoch });
    run.done.then(
      () => {
        running = false;
        const summary = lastSummary;
        if (summary) push({ kind: 'epoch_end', summary, hasNext: epochsStarted < totalEpochs });
      },
      (error: unknown) => {
        running = false;
        if (!closed) fail(error instanceof Error ? error : new Error(String(error)));
      },
    );
  };
  startEpoch();

  // ── Introspection ──
  const me = (): SimState['characters'][Id] => {
    const c = state.characters[playerId];
    if (!c) throw new DomainError('NOT_FOUND', 'Personnage joué absent de l’état');
    return c;
  };

  return {
    player: { id: playerId, slug: record.slug, name: record.firstName },
    seed,

    next(): Promise<PlaySignal> {
      if (failure) return Promise.reject(failure);
      const queued = signals.shift();
      if (queued) return Promise.resolve(queued);
      if (closed) return Promise.reject(new DomainError('SESSION_CLOSED', 'La partie est terminée'));
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },

    answer(requestId: string, choice: number): void {
      if (pending?.request.id !== requestId) {
        throw new DomainError('NO_SUCH_REQUEST', `Aucune demande en attente « ${requestId} »`);
      }
      if (!Number.isInteger(choice) || choice < 1 || choice > pending.values.length) {
        throw new DomainError(
          'INVALID_ANSWER',
          `Réponse ${String(choice)} hors de 1..${String(pending.values.length)}`,
        );
      }
      const { resolve, values } = pending;
      pending = null;
      resolve(values[choice - 1] as never);
    },

    nextEpoch(): boolean {
      if (running || epochsStarted >= totalEpochs) return false;
      startEpoch();
      return true;
    },

    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    log: () => log,

    status(): PlayerStatus {
      const c = me();
      const pos = state.positions[playerId];
      const ctx = contextOf();
      return {
        id: playerId,
        name: c.firstName,
        status: c.status,
        stats: { ...c.stats },
        credits: c.credits,
        place: pos?.kind === 'at' ? ctx.place : null,
        placeId: pos?.kind === 'at' ? pos.locationId : null,
        zone: ctx.zone,
        moving: pos?.kind === 'transit',
        present: ctx.present,
      };
    },

    relations(): PlayerRelation[] {
      return Object.keys(state.characters)
        .filter((id) => id !== playerId)
        .flatMap((id) => {
          const e = state.relationships[relKey(playerId, id)];
          if (!e) return [];
          const axes: Record<string, number> = {
            trust: e.trust,
            affection: e.affection,
            rivalry: e.rivalry,
            respect: e.respect,
            fear: e.fear,
            attraction: e.attraction,
            alliance: e.alliance,
            ...e.extraAxes,
          };
          return [
            {
              otherId: id,
              name: nameOf(state, id),
              acquaintance: ACQUAINTANCE_FR[e.acquaintance] ?? e.acquaintance,
              axes,
              labels: [...e.labels],
            },
          ];
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    },

    knowledge(): PlayerKnowledge[] {
      return of(state, playerId).map((k) => ({
        factId: k.fact.id,
        text: factText(state, k.fact),
        source: SOURCE_FR[k.knowledge.sourceType] ?? k.knowledge.sourceType,
        // La vérité d’un fait n’est jamais exposée : seulement ce que le joueur en croit.
        belief: k.fact.inventedById === playerId ? 'tu sais que c’est faux' : (BELIEF_FR[k.knowledge.belief] ?? ''),
        confidence: k.knowledge.confidence,
      }));
    },

    map(): PlayMap {
      const { tickMinutes } = state.world.config;
      return {
        locations: Object.values(state.locations)
          .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
          .map((l) => ({ id: l.id, name: l.name, zones: l.zones.map((z) => z.slug) })),
        routes: state.routes.map((r) => ({
          from: r.fromLocationId,
          to: r.toLocationId,
          minutes: r.travelTicks * tickMinutes,
        })),
      };
    },

    clock(): PlayClock {
      const { ticksPerEpoch } = state.world.config;
      return { epoch: currentEpoch, tick: state.tick, ticksPerEpoch, time: clockOf(state.world.config, state.tick) };
    },

    close(): void {
      if (closed) return;
      closed = true;
      const error = new DomainError('SESSION_CLOSED', 'La partie est terminée');
      pending?.reject(error);
      pending = null;
      for (const w of waiters.splice(0)) w.reject(error);
    },
  };
}

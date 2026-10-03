/**
 * API publique du scheduler d'époque : points d'extension (`EpochHooks`), contexte (`TickContext`), exécution (`EpochRun`).
 *
 * Les jalons suivants branchent leurs travaux ici : M3 (interactions, résolution, économie) comme hooks `tick`
 * et `economy`, M5 (agents LLM) comme `plan`, `tick` et `memory`. Le scheduler garde la main sur le temps,
 * les déplacements, les scènes et la présence ; un hook ne touche jamais au stockage.
 */
import type { IdFactory } from '../core/id.js';
import type { Rng } from '../core/rng.js';
import type { DecisionPolicy, OutcomeModel } from '../decision/ports.js';
import type { Listener } from '../scene/audience.js';
import type { PresenceRole } from '../scene/formation.js';
import type { SceneRecord, TickBatch } from '../state/journal.js';
import type { Id, SimState, Volume } from '../state/types.js';
import type { EngineBus, Phase } from './bus.js';

/** Un `TickBatch` que les hooks remplissent : mêmes champs, tableaux modifiables. */
export type MutableTickBatch = {
  -readonly [K in keyof TickBatch]: TickBatch[K] extends readonly (infer U)[]
    ? U[]
    : TickBatch[K] extends Readonly<Record<string, readonly unknown[]>>
      ? Record<string, unknown[]>
      : TickBatch[K];
};

export interface SceneMember {
  readonly characterId: Id;
  readonly zoneId: Id | null;
  readonly role: PresenceRole;
}

/** Une scène ouverte et ses membres (ordre des identifiants de personnage). */
export interface SceneView {
  readonly scene: SceneRecord;
  readonly members: readonly SceneMember[];
}

/**
 * Ce que reçoit chaque hook. Le contexte vaut pour un tick (ou une phase) et n'est valable que pendant l'appel.
 *
 * - `state` est le `SimState` vivant : les hooks le modifient (via `applyEffect`, `state.nextEventSeq`…) et
 *   journalisent la même chose dans `batch`. Rien n'est écrit en base hors de `batch`.
 * - `batch` est le lot du tick : une seule transaction `commitTick` à la fin du tick. Les hooks y ajoutent events,
 *   effects, interactions, relations modifiées… Le scheduler possède `scenesOpened/Closed`, `presences*` et
 *   `characterStates` : il les écrase ou les complète ; ne pas y toucher.
 * - Les enregistrements `event`, `utterance`, `effect.applied` du lot sont publiés sur le bus par le scheduler
 *   APRÈS le commit du tick (ne pas les émettre soi-même, sinon doublon et émission avant un éventuel échec).
 * - Identifiants : toujours `ids(flux)`. Un flux a sa propre suite par tick ; les flux `scene`, `presence` et `epoch`
 *   sont réservés. Ne jamais utiliser `Math.random`, `Date.now`, ni un identifiant tiré hors de `ids`.
 * - Hasard : `rng('flux', id…)` renvoie un nouveau `Rng` dérivé de `(graine du monde, époque, tick, …parties)` ;
 *   mêmes parties ⇒ même suite, donc une reprise rejoue exactement les mêmes tirages.
 * - Reprise : un tick qui échoue est annulé en base ; l'exécution reprend au tick suivant le dernier tick validé,
 *   avec un `state` rechargé. Un hook ne doit donc garder aucun état propre hors de `state`/`batch`.
 * - Ordre d'appel par tick : `beforeTick`, déplacements, formation des scènes, puis chaque hook de `tick`.
 *   `scenes` reflète les scènes et membres au moment de la lecture.
 */
export interface TickContext {
  readonly phase: Phase;
  readonly state: SimState;
  readonly batch: MutableTickBatch;
  readonly epochId: Id;
  readonly epochNumber: number;
  /** Numéro de tick. Phases `economy`, `memory`, `close` : `ticksPerEpoch` ; phase `plan` : 0 (lot du tick 0). */
  readonly tick: number;
  readonly bus: EngineBus;
  readonly decision: DecisionPolicy;
  readonly outcome: OutcomeModel | undefined;
  /** Scènes ouvertes avec leurs membres, triées par début puis identifiant. */
  readonly scenes: readonly SceneView[];
  rng(...parts: ReadonlyArray<string | number>): Rng;
  ids(stream: string): IdFactory;
  /** Qui entend et qui voit `speakerId` dans cette scène. */
  audience(sceneId: Id, speakerId: Id, volume: Volume): Listener[];
}

export type TickHook = (ctx: TickContext) => Promise<void> | void;

/**
 * Points d'extension de l'époque (engine-architecture.md §6). Chacun est optionnel.
 *
 * - `plan` (phase 2) : agendas. Écrit dans le lot du tick 0 ; non rejoué à la reprise si le tick 0 est validé.
 * - `beforeTick` : début de chaque tick, avant les déplacements (créneaux imposés, intentions du jour).
 * - `tick` : après déplacements et scènes de chaque tick, dans l'ordre de la liste (sélection d'interactions,
 *   conversations, résolution, propagation).
 * - `economy` (phase 5), `memory` (phase 6), `close` (phase 7) : écrivent dans le lot de clôture (tick = `ticksPerEpoch`),
 *   commité avec la fermeture des scènes, le snapshot des relations et le statut `completed`, en une transaction.
 */
export interface EpochHooks {
  readonly plan?: TickHook;
  readonly beforeTick?: TickHook;
  readonly tick?: readonly TickHook[];
  readonly economy?: TickHook;
  readonly memory?: TickHook;
  readonly close?: TickHook;
}

export interface EpochResult {
  readonly epochId: Id;
  readonly number: number;
  /** Premier tick joué par cette exécution (0 sauf reprise). */
  readonly firstTick: number;
  readonly ticksPerEpoch: number;
}

export interface EpochRun {
  /** À brancher tout de suite après l'appel : l'exécution démarre au tour de boucle suivant. */
  readonly bus: EngineBus;
  readonly done: Promise<EpochResult>;
}

export interface EpochRunOptions {
  readonly worldId: Id;
  readonly seasonNumber: number;
  readonly number: number;
}

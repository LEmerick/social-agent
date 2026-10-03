/**
 * Hooks de format pour l'époque (game-formats.md §6, implementation-plan.md M7). Ils se branchent sur `EpochHooks`
 * avec `withFormats` :
 *
 * - `plan` : charge le `FormatState`, met la saison en place la première fois (équipes, objets, calendrier), périme les
 *   objets, annonce les événements de l'époque ;
 * - `beforeTick` : déclenche ce qui est dû à (époque, tick) et ne demande pas de scène (fusion, dépôt d'objet, attribution
 *   de mission, mélange d'équipes), puis calcule les convocations du tick ;
 * - `tick` (avant les interactions) : suivi de présence, puis scènes imposées — épreuve, conseil, repas, annonce, finale ;
 * - `tick` (après les interactions) : évaluation des missions, objectifs persistés, instantané du `FormatState`.
 *
 * Le `FormatState` est déposé dans `TickBatch.ext['format']` à chaque tick : les adaptateurs l'écrivent dans la
 * transaction du tick, et une époque interrompue reprend à l'identique (le premier hook de la reprise le recharge).
 */
import type { DecisionPolicy, OutcomeModel } from '../decision/ports.js';
import type { EpochSchedulerDeps } from '../epoch/scheduler.js';
import type { EpochHooks, TickContext, TickHook } from '../epoch/types.js';
import type { StoragePort } from '../ports/storage.js';
import {
  FORMAT_EXT_KEY,
  formatOf,
  peekFormat,
  setFormatState,
  teamOf,
  type ScheduledEventNode,
} from '../state/format-state.js';
import { goalRecordOf } from '../state/journal.js';
import type { Id } from '../state/types.js';
import { runChallenge } from './challenge.js';
import { applyLogged } from './ceremony-kit.js';
import { openPublicVote, runCouncil } from './council.js';
import { runFinal } from './finale.js';
import { announceScheduled, dueEvents, fireScheduled } from './format-service.js';
import { absorb, formatContextOf, inGameIds, markBusy, stageFormat } from './hook-kit.js';
import { expireItems } from './inventory-use.js';
import { holdersOf, resolveMissions } from './missions.js';
import { emitEvent, emptyOutput } from './output.js';
import { loadFormatState } from './persist.js';
import type { SeasonFormat } from './season-format.js';
import { DEFAULT_SEASON_EPOCHS, needsSetup, setupFormat } from './setup.js';
import {
  CEREMONY_KINDS,
  FormatDecisionPolicy,
  ceremonyLocation,
  computeSummons,
  convenedOf,
  storeSummons,
} from './summons.js';
import { moveCharacter } from './teams.js';
import { trackPresence } from './tracking.js';

export interface FormatHookDeps {
  readonly storage: StoragePort;
  readonly format: SeasonFormat;
  /** Nombre d'époques sur lequel les périodicités du calendrier sont matérialisées. */
  readonly seasonEpochs?: number;
}

/** Charge le `FormatState` de la saison dans `state.ext` (premier hook d'une exécution, y compris une reprise) et active les actions du format. */
async function ensureLoaded(ctx: TickContext, deps: FormatHookDeps): Promise<void> {
  const { state } = ctx;
  if (state.ext[FORMAT_EXT_KEY] === undefined) {
    setFormatState(state, await loadFormatState(deps.storage, state.season.id));
  }
  const rules = state.season.rules as { enabledActions: readonly string[] };
  const missing = deps.format.actions.enable.filter((a) => !rules.enabledActions.includes(a));
  if (missing.length > 0) rules.enabledActions = [...rules.enabledActions, ...missing];
}

const planHook =
  (deps: FormatHookDeps): TickHook =>
  async (ctx) => {
    await ensureLoaded(ctx, deps);
    const fc = formatContextOf(ctx);
    if (needsSetup(ctx.state)) {
      absorb(
        ctx,
        setupFormat(ctx.state, fc, deps.format, ctx.rng('format-setup'), {
          epochs: deps.seasonEpochs ?? DEFAULT_SEASON_EPOCHS,
        }),
      );
    }
    absorb(ctx, expireItems(ctx.state, fc));
    // Les événements datés de l'époque sont annoncés : leurs participants s'y préparent (connaissance publique).
    const announced = new Set(Object.values(ctx.state.facts).map((f) => f.objectText));
    for (const s of Object.values(peekFormat(ctx.state).scheduled).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (s.epoch === ctx.epochNumber && s.firedEventId === null && !announced.has(`scheduled:${s.id}`)) {
        absorb(ctx, announceScheduled(ctx.state, fc, s));
      }
    }
    stageFormat(ctx);
  };

/** Mélange d'équipes : répartition circulaire dans l'ordre tiré, par équipes actives. */
function shuffleTeams(ctx: TickContext): void {
  const fs = formatOf(ctx.state);
  const teams = Object.values(fs.teams)
    .filter((t) => t.dissolvedEpoch === null)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (teams.length < 2) return;
  const rng = ctx.rng('team-shuffle');
  const players = inGameIds(ctx.state);
  for (let i = players.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    [players[i], players[j]] = [players[j] as Id, players[i] as Id];
  }
  const fc = formatContextOf(ctx);
  players.forEach((id, i) => {
    const team = teams[i % teams.length];
    if (team && teamOf(fs, id, ctx.epochNumber) !== team.id) absorb(ctx, moveCharacter(ctx.state, fc, id, team.id));
  });
}

const beforeTickHook =
  (deps: FormatHookDeps): TickHook =>
  async (ctx) => {
    await ensureLoaded(ctx, deps);
    const fc = formatContextOf(ctx);
    for (const s of dueEvents(ctx.epochNumber, ctx.tick, ctx.state)) {
      if (CEREMONY_KINDS.has(s.kind)) continue;
      const fired = fireScheduled(ctx.state, fc, s.id, { rng: ctx.rng('format-fire', s.id) });
      absorb(ctx, fired);
      if (s.kind === 'team_shuffle') shuffleTeams(ctx);
    }
    storeSummons(ctx.state, computeSummons(ctx.state, ctx.epochNumber, ctx.tick));
  };

/** Personnages réellement présents (participants d'une scène) au lieu `locationId` à ce tick. */
function presentAt(ctx: TickContext, locationId: Id): { sceneId: Id | null; ids: Id[] } {
  const view = ctx.scenes.find((v) => v.scene.locationId === locationId);
  return {
    sceneId: view?.scene.id ?? null,
    ids: (view?.members ?? []).filter((m) => m.role === 'participant').map((m) => m.characterId),
  };
}

async function runCeremony(ctx: TickContext, deps: FormatHookDeps, s: ScheduledEventNode): Promise<void> {
  const { state } = ctx;
  const fc = formatContextOf(ctx);
  const dated = s.tickStart !== null;
  const locationId = ceremonyLocation(state, s);
  const convened = convenedOf(state, s);
  // Un événement daté se joue avec ceux qui sont arrivés ; un déclencheur réunit tous les convoqués, hors scène.
  const here = dated && locationId ? presentAt(ctx, locationId) : { sceneId: null, ids: convened };
  const present = here.ids.filter((id) => convened.includes(id));
  markBusy(state, ctx.tick, present);

  const fired = fireScheduled(state, fc, s.id, { rng: ctx.rng('format-fire', s.id) });
  absorb(ctx, fired);
  const cause = fired.events[0]?.id ?? '';
  const place = { sceneId: here.sceneId, locationId };

  switch (s.kind) {
    case 'challenge':
      absorb(ctx, runChallenge(ctx, deps.format, s, present, cause));
      break;
    case 'council':
      // Le public vote pour tous les personnages en jeu, présents ou non ; un conseil d'élimination veut deux électeurs.
      if (s.params['vote'] === 'public') absorb(ctx, openPublicVote(ctx, deps.format, place, cause, inGameIds(state)));
      else if (present.length >= 2) await runCouncil(ctx, deps.format, s, present, place, cause, 'elimination');
      break;
    case 'meal': {
      const out = emptyOutput();
      const event = emitEvent(state, fc, out, {
        type: 'meal_shared',
        sceneId: here.sceneId,
        locationId,
        payload: { scheduledEventId: s.id, characterIds: present },
        causedByEventId: cause,
        participants: present.map((characterId) => ({ characterId, role: 'actor' as const })),
      });
      for (const id of present) {
        applyLogged(ctx, fc, out, event.id, id, 'stat', 'energy', 10);
        applyLogged(ctx, fc, out, event.id, id, 'stat', 'morale', 1);
      }
      absorb(ctx, out);
      break;
    }
    case 'announcement': {
      const out = emptyOutput();
      emitEvent(state, fc, out, {
        type: 'announcement',
        sceneId: here.sceneId,
        locationId,
        payload: { scheduledEventId: s.id, text: s.params['text'] ?? null, characterIds: present },
        causedByEventId: cause,
        participants: present.map((characterId) => ({ characterId, role: 'witness' as const })),
      });
      absorb(ctx, out);
      break;
    }
    case 'final':
      await runFinal(ctx, deps.format, cause);
      break;
    default:
      break;
  }
}

const scenesHook =
  (deps: FormatHookDeps): TickHook =>
  async (ctx) => {
    trackPresence(
      ctx.state,
      ctx.scenes.map((v) => v.members.filter((m) => m.role === 'participant').map((m) => m.characterId)),
    );
    for (const s of dueEvents(ctx.epochNumber, ctx.tick, ctx.state)) {
      if (CEREMONY_KINDS.has(s.kind)) await runCeremony(ctx, deps, s);
    }
  };

/** Évalue les missions après les events du tick ; les objectifs touchés sont persistés (`TickBatch.goals`). */
const settleHook: TickHook = (ctx) => {
  const fc = formatContextOf(ctx);
  const last = [...ctx.batch.events].sort((a, b) => b.seq - a.seq)[0] ?? null;
  const settled = resolveMissions(ctx.state, fc, last);
  absorb(ctx, settled);
  const fs = formatOf(ctx.state);
  for (const r of settled.resolutions) {
    const a = fs.assignments[r.assignmentId];
    if (!a) continue;
    for (const holder of holdersOf(ctx.state, a, ctx.epochNumber)) {
      const goal = ctx.state.characters[holder]?.goals.find((g) => g.id === a.id);
      if (goal) ctx.batch.goals.push(goalRecordOf(holder, goal, ctx.epochNumber, false));
    }
  }
  stageFormat(ctx);
};

export interface FormatHooks {
  readonly plan: TickHook;
  readonly beforeTick: TickHook;
  /** À placer avant les hooks d'interaction. */
  readonly scenes: TickHook;
  /** À placer après les hooks d'interaction. */
  readonly settle: TickHook;
}

export function formatHooks(deps: FormatHookDeps): FormatHooks {
  return { plan: planHook(deps), beforeTick: beforeTickHook(deps), scenes: scenesHook(deps), settle: settleHook };
}

const chain = (...hooks: readonly (TickHook | undefined)[]): TickHook | undefined => {
  const list = hooks.filter((h): h is TickHook => h !== undefined);
  if (list.length <= 1) return list[0];
  return async (ctx) => {
    for (const h of list) await h(ctx);
  };
};

export interface WithFormatsDeps {
  readonly storage: StoragePort;
  readonly decision: DecisionPolicy;
  readonly outcome?: OutcomeModel;
  /** Hooks de base (interactions, économie, mémoire…) : les hooks de format s'y intercalent. */
  readonly hooks?: EpochHooks;
  readonly format: SeasonFormat;
  readonly seasonEpochs?: number;
}

/**
 * Dépendances du scheduler pour une saison de format : politique enveloppée (convocations), hooks de format ajoutés
 * à ceux de base (`plan` et `beforeTick` d'abord ; scènes imposées avant les interactions, missions après).
 */
export function withFormats(deps: WithFormatsDeps): EpochSchedulerDeps {
  const fh = formatHooks({
    storage: deps.storage,
    format: deps.format,
    ...(deps.seasonEpochs !== undefined ? { seasonEpochs: deps.seasonEpochs } : {}),
  });
  const base = deps.hooks ?? {};
  const plan = chain(fh.plan, base.plan);
  const beforeTick = chain(fh.beforeTick, base.beforeTick);
  return {
    storage: deps.storage,
    decision: new FormatDecisionPolicy(deps.decision),
    ...(deps.outcome ? { outcome: deps.outcome } : {}),
    hooks: {
      ...base,
      ...(plan ? { plan } : {}),
      ...(beforeTick ? { beforeTick } : {}),
      tick: [fh.scenes, ...(base.tick ?? []), fh.settle],
    },
  };
}

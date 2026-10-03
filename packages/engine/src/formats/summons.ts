/**
 * Scènes imposées : un événement planifié daté convoque ses participants à un lieu. Le scheduler garde la main sur
 * les déplacements ; `FormatDecisionPolicy` enveloppe la politique de décision et force la destination des convoqués
 * (le temps de trajet plus un tick de marge avant `tickStart`), puis laisse faire la politique d'origine.
 */
import type { DecisionPolicy, DestinationChoice } from '../decision/ports.js';
import { membersOf, peekFormat, type ScheduledEventNode } from '../state/format-state.js';
import type { Id, SimState } from '../state/types.js';
import { shortestRoute } from '../world/shortest-route.js';
import { participantsOf } from './format-service.js';

const SUMMONS_KEY = 'format_summons';

/** Types d'événements planifiés qui réunissent des personnages (les autres s'exécutent sans scène). */
export const CEREMONY_KINDS: ReadonlySet<string> = new Set(['challenge', 'council', 'meal', 'announcement', 'final']);

export interface Summons {
  readonly tick: number;
  /** Personnage → lieu où il doit se trouver pour l'événement. */
  readonly forced: Readonly<Record<Id, Id>>;
}

export const summonsOf = (state: Readonly<SimState>, tick: number): Summons | undefined => {
  const s = state.ext[SUMMONS_KEY] as Summons | undefined;
  return s && s.tick === tick ? s : undefined;
};

const inGame = (state: Readonly<SimState>, id: Id): boolean => {
  const c = state.characters[id];
  return c !== undefined && c.status !== 'eliminated' && c.status !== 'paused';
};

/** Perdants de la dernière épreuve de l'époque (`params.result`), ou `null` si aucune épreuve n'a été jouée. */
function losingTeams(state: Readonly<SimState>, epoch: number): Id[] | null {
  const results = Object.values(peekFormat(state).scheduled)
    .filter((s) => s.kind === 'challenge' && s.epoch === epoch && s.firedEventId !== null)
    .sort((a, b) => (b.tickStart ?? 0) - (a.tickStart ?? 0))
    .map((s) => (s.params['result'] as { loserTeamIds?: Id[] } | undefined)?.loserTeamIds)
    .filter((r): r is Id[] => r !== undefined);
  return results[0] ?? null;
}

/** Personnages convoqués : `characterIds`, `team`, `losing_team` (équipes perdantes de l'épreuve du jour), sinon tous. */
export function convenedOf(state: Readonly<SimState>, s: ScheduledEventNode): Id[] {
  const epoch = state.epoch?.number ?? 0;
  if (s.participants['losing_team'] === true) {
    const losers = losingTeams(state, epoch);
    if (losers && losers.length > 0) {
      const fs = peekFormat(state);
      return losers
        .flatMap((t) => membersOf(fs, t, epoch))
        .filter((id) => inGame(state, id))
        .sort();
    }
  }
  return participantsOf(state, s).filter((id) => inGame(state, id));
}

/** Lieu d'un événement : celui qui est fixé, sinon le premier lieu non privé (par identifiant). */
export function ceremonyLocation(state: Readonly<SimState>, s: ScheduledEventNode): Id | null {
  if (s.locationId && state.locations[s.locationId]) return s.locationId;
  return (
    Object.values(state.locations)
      .filter((l) => !l.isPrivate)
      .map((l) => l.id)
      .sort()[0] ?? null
  );
}

/** Ticks de trajet restants pour que `id` soit au lieu `dest` (0 s'il y est déjà ou apparaît hors-jeu). */
function travelTicks(state: Readonly<SimState>, id: Id, dest: Id, tick: number): number | null {
  const position = state.positions[id];
  if (!position || position.kind === 'offstage') return 0;
  if (position.kind === 'at') return shortestRoute(state, position.locationId, dest)?.travelTicks ?? null;
  const rest = shortestRoute(state, position.toLocationId, dest)?.travelTicks;
  return rest === undefined ? null : Math.max(0, position.arrivalTick - tick) + rest;
}

/** Convocations du tick : les participants d'un événement daté non déclenché de l'époque, quand il est temps de partir. */
export function computeSummons(state: Readonly<SimState>, epoch: number, tick: number): Summons {
  const forced: Record<Id, Id> = {};
  const due = Object.values(peekFormat(state).scheduled)
    .filter(
      (s) =>
        CEREMONY_KINDS.has(s.kind) &&
        s.mandatory &&
        s.firedEventId === null &&
        s.epoch === epoch &&
        s.tickStart !== null &&
        s.tickStart >= tick,
    )
    .sort((a, b) => (a.tickStart ?? 0) - (b.tickStart ?? 0) || (a.id < b.id ? -1 : 1));
  for (const s of due) {
    const dest = ceremonyLocation(state, s);
    if (!dest) continue;
    for (const id of convenedOf(state, s)) {
      if (forced[id] !== undefined) continue;
      const travel = travelTicks(state, id, dest, tick);
      if (travel !== null && (s.tickStart ?? 0) - tick <= travel + 1) forced[id] = dest;
    }
  }
  return { tick, forced };
}

export function storeSummons(state: SimState, summons: Summons): void {
  state.ext[SUMMONS_KEY] = summons;
}

/** Enveloppe de politique : les convoqués vont où l'événement les attend, les autres suivent la politique d'origine. */
export class FormatDecisionPolicy implements DecisionPolicy {
  readonly #inner: DecisionPolicy;

  constructor(inner: DecisionPolicy) {
    this.#inner = inner;
  }

  choose(input: Parameters<DecisionPolicy['choose']>[0]): ReturnType<DecisionPolicy['choose']> {
    return this.#inner.choose(input);
  }

  chooseDestination(input: Parameters<DecisionPolicy['chooseDestination']>[0]): Promise<DestinationChoice> {
    const dest = summonsOf(input.state, input.state.tick)?.forced[input.actorId];
    if (dest === undefined) return this.#inner.chooseDestination(input);
    return Promise.resolve({ kind: 'go', locationId: dest, zoneId: null });
  }
}

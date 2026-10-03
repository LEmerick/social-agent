/**
 * Un rollout = un futur possible, tiré arête par arête (action-catalog.md §9.2), sur une copie du `SimState` :
 *
 *   pas 0     l'action de l'acteur : issue tirée dans la distribution, puis `resolveInteraction` (les règles de la simulation) ;
 *   pas 1..h−1 le fait laissé par l'action circule : chaque informé du pas précédent le raconte à chaque ignorant avec la
 *             probabilité de l'arête (`tellProbability`) ; les informés de seconde main peuvent confronter le sujet
 *             (utilité rapide) au pas suivant celui où ils l'ont appris, ce qui passe aussi par `resolveInteraction`.
 *
 * Limites : le fait suivi est celui de l'action (fait notable, ou `option.factId`) ; seule la cible l'apprend directement
 * (les témoins de la scène ne sont pas simulés) ; les réactions se limitent à `confront`.
 */
import type { IdFactory } from '../../core/id.js';
import type { Rng } from '../../core/rng.js';
import { resolveInteraction } from '../../resolution/resolve.js';
import { actionDef } from '../../rules/catalog.js';
import { costRefusal } from '../../rules/options.js';
import { notableFact } from '../../knowledge/notable.js';
import type { Id, SimState } from '../../state/types.js';
import type { ActionOption } from '../ports.js';
import type { MonteCarloConfig, RolloutPlan } from './montecarlo-config.js';
import { cloneForRollout } from './montecarlo-clone.js';
import { reactionProbability, tellProbability } from './montecarlo-spread.js';
import { valueFor } from './montecarlo-value.js';
import { isSuccess, leavesFact } from './outcome-values.js';
import { ProbabilisticOutcomeModel } from './probabilistic-outcome.js';
import { sampleOutcome } from './softmax.js';

export interface RolloutResult {
  readonly value: number;
  readonly outcome: string;
  readonly success: boolean;
  /** Personnages (hors acteur) qui connaissent le fait suivi à la fin du rollout. */
  readonly learned: readonly Id[];
}

/** Fait suivi par un rollout : sa gravité et son sujet. */
export interface WatchedFact {
  readonly sensitivity: number;
  readonly subjectId: Id;
  /** Qui le connaît déjà avant l'action (hors acteur). */
  readonly alreadyKnown: readonly Id[];
}

const FACT_ACTIONS: ReadonlySet<string> = new Set(['share_secret', 'confront', 'accuse']);

/** Le fait que l'option laisserait derrière elle, ou `null` (bavardage, compliment, repos…). */
export function watchedFactOf(state: Readonly<SimState>, actorId: Id, option: ActionOption): WatchedFact | null {
  if (option.targetId === null) return null;
  if (FACT_ACTIONS.has(option.action) && option.factId !== null) {
    const fact = state.facts[option.factId];
    if (!fact) return null;
    const known = Object.values(state.knowledge)
      .filter((k) => k.factId === option.factId && k.characterId !== actorId)
      .map((k) => k.characterId);
    return { sensitivity: fact.sensitivity, subjectId: fact.subjectId ?? actorId, alreadyKnown: [...new Set(known)] };
  }
  const def = actionDef(option.action);
  const notable = def ? notableFact(option.action, def.defaultVolume) : null;
  return notable ? { sensitivity: notable.sensitivity, subjectId: actorId, alreadyKnown: [] } : null;
}

const inGame = (state: Readonly<SimState>, id: Id): boolean => {
  const c = state.characters[id];
  return c !== undefined && c.status !== 'eliminated' && c.status !== 'paused';
};

const counterIds = (): IdFactory => {
  let n = 0;
  return { next: () => `mc-${String(n++)}` };
};

const CONFRONT = (aboutId: Id): ActionOption => ({
  action: 'confront',
  targetId: aboutId,
  factId: null,
  itemId: null,
  locationId: null,
});

export function runRollout(
  state: Readonly<SimState>,
  actorId: Id,
  option: ActionOption,
  distribution: Readonly<Record<string, number>>,
  watched: WatchedFact | null,
  plan: RolloutPlan,
  rng: Rng,
  config: MonteCarloConfig,
  outcomes: ProbabilisticOutcomeModel,
  reactions: Map<Id, number> = new Map(),
): RolloutResult {
  const sim = cloneForRollout(state);
  const ids = counterIds();
  const outcome = sampleOutcome(distribution, rng.next());
  resolveInteraction(sim, { option, actorId, outcome }, ids);

  const knowers = new Set<Id>();
  const parent = new Map<Id, Id>();
  let frontier: Id[] = [];
  if (watched && leavesFact(outcome) && option.targetId !== null) {
    for (const id of watched.alreadyKnown) knowers.add(id);
    knowers.add(actorId);
    if (!knowers.has(option.targetId)) {
      knowers.add(option.targetId);
      parent.set(option.targetId, actorId);
      frontier = [option.targetId];
    }
  }

  const candidates = Object.keys(sim.characters).sort();
  for (let step = 1; step < plan.horizon && watched && frontier.length > 0; step++) {
    const next: Id[] = [];
    for (const teller of frontier) {
      if (!inGame(sim, teller)) continue;
      const source = parent.get(teller) ?? actorId;
      for (const listener of candidates) {
        if (knowers.has(listener) || !inGame(sim, listener)) continue;
        const p =
          config.overrides?.tell?.(teller, listener) ??
          tellProbability(sim, teller, listener, source, watched.sensitivity);
        if (p > 0 && rng.next() < p) {
          knowers.add(listener);
          parent.set(listener, teller);
          next.push(listener);
        }
      }
      // Informé de seconde main, qui n'est ni le sujet ni la cible directe : il peut confronter le sujet.
      if (step > 1 && teller !== watched.subjectId && inGame(sim, watched.subjectId)) {
        react(state, sim, teller, watched, rng, config, outcomes, ids, reactions);
      }
    }
    frontier = next;
  }
  return {
    value: valueFor(state, sim, actorId),
    outcome,
    success: isSuccess(option.action, outcome),
    learned: [...knowers].filter((id) => id !== actorId),
  };
}

function react(
  root: Readonly<SimState>,
  sim: SimState,
  reactorId: Id,
  watched: WatchedFact,
  rng: Rng,
  config: MonteCarloConfig,
  outcomes: ProbabilisticOutcomeModel,
  ids: IdFactory,
  reactions: Map<Id, number>,
): void {
  const option = CONFRONT(watched.subjectId);
  // Calculée une fois par estimation, sur l'état de départ : l'utilité rapide ne se recalcule pas à chaque rollout.
  let p = config.overrides?.react?.(reactorId, watched.subjectId) ?? reactions.get(reactorId);
  if (p === undefined) {
    p = reactionProbability(root, reactorId, watched.subjectId, watched.sensitivity, config.utility);
    reactions.set(reactorId, p);
  }
  if (!(p > 0 && rng.next() < p)) return;
  if (costRefusal(sim, reactorId, option) !== null) return;
  const outcome = sampleOutcome(outcomes.distribution(sim, reactorId, option), rng.next());
  resolveInteraction(sim, { option, actorId: reactorId, outcome }, ids);
}

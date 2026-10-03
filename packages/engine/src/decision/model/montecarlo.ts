/**
 * Monte Carlo (decision-model.md §5) : pour chaque option candidate, N rollouts sur un `SimState` cloné avec les mêmes
 * règles pures que la simulation ; estimations d'espérance, de risque, de P(succès) et de P(« X l'apprend »).
 *
 * `estimateOptions` est le cœur ; `MonteCarloDecisionPolicy` en tire un choix (softmax sur les valeurs) et
 * `optionsForPlayer` les options chiffrées du mode directif. Même graine ⇒ même distribution.
 */
import { Rng } from '../../core/rng.js';
import type { Id, SimState } from '../../state/types.js';
import {
  type ActionOption,
  type DecisionPolicy,
  type DecisionResult,
  type DestinationChoice,
  optionKey,
} from '../ports.js';
import { type MonteCarloConfig, planFor } from './montecarlo-config.js';
import { runRollout, watchedFactOf } from './montecarlo-rollout.js';
import { ProbabilisticOutcomeModel } from './probabilistic-outcome.js';
import { sampleIndex, softmax, temperatureOf } from './softmax.js';
import { chooseDestinationByScore } from './utility-destination.js';
import { utilitiesOf } from './utility.js';
import { weightsOf } from './weights.js';

export const MONTECARLO_POLICY = 'montecarlo@1';

export interface OptionEstimate {
  readonly option: ActionOption;
  readonly rollouts: number;
  readonly horizon: number;
  /** Espérance de la valeur pour l'acteur. */
  readonly meanValue: number;
  /** Risque : écart-type de la valeur. */
  readonly risk: number;
  /** P(l'issue de l'action est un succès). */
  readonly pSuccess: number;
  /** P(valeur < 0). */
  readonly pLoss: number;
  /** P(chaque personnage apprend le fait laissé par l'action), pour ceux qui l'apprennent au moins une fois. */
  readonly pLearn: Readonly<Record<Id, number>>;
  /** Fréquence de chaque issue. */
  readonly outcomes: Readonly<Record<string, number>>;
}

const DEFAULT_OUTCOMES = new ProbabilisticOutcomeModel();

/** Estimations des options (toutes celles données, dans l'ordre). Consomme un seul tirage de `rng`. */
export function estimateOptions(
  state: Readonly<SimState>,
  actorId: Id,
  options: readonly ActionOption[],
  rng: Rng,
  config: MonteCarloConfig = {},
): OptionEstimate[] {
  const plan = planFor(state.characters[actorId], config);
  const outcomes = config.outcomes ?? DEFAULT_OUTCOMES;
  const base = String(Math.floor(rng.next() * 2 ** 32));
  return options.map((option) => {
    const stream = Rng.derive(base, optionKey(option));
    const distribution =
      config.overrides?.outcome?.({ actorId, option }) ?? outcomes.distribution(state, actorId, option);
    const watched = watchedFactOf(state, actorId, option);
    const reactions = new Map<Id, number>();
    let mean = 0;
    let m2 = 0;
    let successes = 0;
    let losses = 0;
    const learned = new Map<Id, number>();
    const seen = new Map<string, number>();
    for (let n = 1; n <= plan.rollouts; n++) {
      const r = runRollout(state, actorId, option, distribution, watched, plan, stream, config, outcomes, reactions);
      const delta = r.value - mean;
      mean += delta / n;
      m2 += delta * (r.value - mean);
      if (r.success) successes += 1;
      if (r.value < 0) losses += 1;
      for (const id of r.learned) learned.set(id, (learned.get(id) ?? 0) + 1);
      seen.set(r.outcome, (seen.get(r.outcome) ?? 0) + 1);
    }
    const n = plan.rollouts;
    return {
      option,
      rollouts: n,
      horizon: plan.horizon,
      meanValue: mean,
      risk: n > 1 ? Math.sqrt(m2 / (n - 1)) : 0,
      pSuccess: successes / n,
      pLoss: losses / n,
      pLearn: Object.fromEntries([...learned].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, k]) => [id, k / n])),
      outcomes: Object.fromEntries([...seen].sort(([a], [b]) => (a < b ? -1 : 1)).map(([o, k]) => [o, k / n])),
    };
  });
}

/** Les `limit` options les plus utiles a priori (utilité décroissante), pour ne simuler que les candidates. */
function shortlist(
  state: Readonly<SimState>,
  actorId: Id,
  options: readonly ActionOption[],
  limit: number,
  config: MonteCarloConfig,
): { option: ActionOption; utility: number }[] {
  const { utilities } = utilitiesOf(state, actorId, options, config.utility);
  return options
    .map((option, i) => ({ option, utility: utilities[i] ?? -Infinity }))
    .sort((a, b) => b.utility - a.utility || (optionKey(a.option) < optionKey(b.option) ? -1 : 1))
    .slice(0, limit);
}

export interface PlayerOption extends OptionEstimate {
  /** Utilité a priori (personnalité, relations, directive) : ce que le personnage ferait de lui-même, avant simulation. */
  readonly utility: number;
}

/**
 * Options chiffrées pour le mode directif (action-catalog.md §9.2) : P(succès), valeur moyenne, risque, P(« X l'apprend »).
 * Triées par valeur moyenne décroissante. Seules les `maxCandidates` (12) options d'utilité la plus haute sont simulées.
 */
export function optionsForPlayer(
  state: Readonly<SimState>,
  actorId: Id,
  options: readonly ActionOption[],
  rng: Rng,
  config: MonteCarloConfig = {},
): PlayerOption[] {
  const picked = shortlist(state, actorId, options, config.maxCandidates ?? 12, config);
  const estimates = estimateOptions(
    state,
    actorId,
    picked.map((p) => p.option),
    rng,
    config,
  );
  return estimates
    .map((e, i): PlayerOption => ({ ...e, utility: picked[i]?.utility ?? 0 }))
    .sort((a, b) => b.meanValue - a.meanValue || (optionKey(a.option) < optionKey(b.option) ? -1 : 1));
}

export class MonteCarloDecisionPolicy implements DecisionPolicy {
  readonly #config: MonteCarloConfig;

  constructor(config: MonteCarloConfig = {}) {
    this.#config = config;
  }

  choose(input: Parameters<DecisionPolicy['choose']>[0]): Promise<DecisionResult> {
    const { actorId, state, options, rng } = input;
    if (options.length === 0) return Promise.resolve({ chosen: null, rngDraw: null, policy: MONTECARLO_POLICY });
    const cfg = this.#config;
    const actor = state.characters[actorId];
    const weights = actor ? weightsOf(actor) : undefined;
    const reactivity = weights?.reactivity ?? 0.5;

    const picked = shortlist(state, actorId, options, cfg.maxCandidates ?? 6, cfg);
    const estimates = estimateOptions(
      state,
      actorId,
      picked.map((p) => p.option),
      rng,
      cfg,
    );
    const aversion = (cfg.riskAversion ?? 0.5) * (1 - reactivity);
    const scores = estimates.map((e, i) => {
      const prior = picked[i]?.utility ?? 0;
      return prior === -Infinity
        ? -Infinity
        : (e.meanValue - aversion * e.risk) / (cfg.valueScale ?? 5) + (cfg.priorWeight ?? 0.5) * prior;
    });
    const probs = softmax(scores, temperatureOf(reactivity, cfg.temperature));
    const draw = rng.next();
    const chosen = estimates[sampleIndex(probs, draw)]?.option ?? null;
    return Promise.resolve({
      chosen,
      distribution: estimates.map((e, i) => ({ option: e.option, p: probs[i] ?? 0 })),
      rngDraw: draw,
      policy: MONTECARLO_POLICY,
    });
  }

  chooseDestination(input: Parameters<DecisionPolicy['chooseDestination']>[0]): Promise<DestinationChoice> {
    return Promise.resolve(chooseDestinationByScore(input.state, input.actorId));
  }
}

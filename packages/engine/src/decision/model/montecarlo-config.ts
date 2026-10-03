/** Configuration du Monte Carlo et plan (horizon, rollouts) dérivé des traits (decision-model.md §5). */
import { NEUTRAL_TRAIT } from '../../character/compile.js';
import type { CharacterNode, Id } from '../../state/types.js';
import type { ActionOption } from '../ports.js';
import type { ProbabilisticOutcomeModel } from './probabilistic-outcome.js';
import type { TemperatureConfig } from './softmax.js';
import type { UtilityConfig } from './utility.js';

/** Valeurs imposées aux tirages (tests, reproduction d'un exemple chiffré) ; `undefined` ⇒ le modèle calcule. */
export interface RolloutOverrides {
  /** Distribution des issues de l'option de l'acteur. */
  outcome?(input: { actorId: Id; option: ActionOption }): Readonly<Record<string, number>> | undefined;
  /** Probabilité que `fromId`, qui sait, raconte le fait à `toId`. */
  tell?(fromId: Id, toId: Id): number | undefined;
  /** Probabilité que `reactorId`, informé d'un fait sur `aboutId`, le confronte. */
  react?(reactorId: Id, aboutId: Id): number | undefined;
}

export interface MonteCarloConfig {
  /** Impose le nombre de rollouts / l'horizon (sinon dérivés des traits). */
  readonly rollouts?: number;
  readonly horizon?: number;
  readonly minRollouts?: number;
  readonly maxRollouts?: number;
  readonly maxHorizon?: number;
  /** Options réellement simulées, présélectionnées par l'utilité. Défaut 6 (choix) ; 12 (options du joueur). */
  readonly maxCandidates?: number;
  /** Aversion au risque ×(1 − réactivité) : score = (moyenne − aversion × risque) / échelle + poids × utilité. Défaut 0,5. */
  readonly riskAversion?: number;
  /** Poids de l'utilité (personnalité, directive) dans le score final. Défaut 0,5. */
  readonly priorWeight?: number;
  /** Échelle des valeurs simulées, pour les rendre comparables à l'utilité. Défaut 5. */
  readonly valueScale?: number;
  readonly temperature?: TemperatureConfig;
  readonly utility?: UtilityConfig;
  readonly outcomes?: ProbabilisticOutcomeModel;
  readonly overrides?: RolloutOverrides;
}

export interface RolloutPlan {
  readonly horizon: number;
  readonly rollouts: number;
}

const trait = (c: Readonly<CharacterNode> | undefined, key: string): number => c?.traits[key] ?? NEUTRAL_TRAIT;

/**
 * Prévoyance = 0,5 manipulation + 0,3 ambition + 0,2 maîtrise de soi (100 − impulsivité), sur 0..100.
 * Horizon = 1 + ⌊prévoyance × 3,999 / 100⌋ ∈ 1..4 : un manipulateur ambitieux voit la chaîne de fuite,
 * un impulsif n'évalue que l'issue immédiate et la première réaction.
 * Rollouts = interpolation entre `minRollouts` (60) et `maxRollouts` (400) selon la minutie
 * (0,5 maîtrise de soi + 0,5 ambition).
 */
export function planFor(actor: Readonly<CharacterNode> | undefined, config: MonteCarloConfig = {}): RolloutPlan {
  const foresight =
    0.5 * trait(actor, 'manipulation') + 0.3 * trait(actor, 'ambition') + 0.2 * (100 - trait(actor, 'impulsivity'));
  const maxHorizon = config.maxHorizon ?? 4;
  const horizon = config.horizon ?? Math.min(maxHorizon, 1 + Math.floor((foresight * 3.999) / 100));
  const thorough = 0.5 * ((100 - trait(actor, 'impulsivity')) / 100) + 0.5 * (trait(actor, 'ambition') / 100);
  const lo = config.minRollouts ?? 60;
  const hi = config.maxRollouts ?? 400;
  const rollouts = config.rollouts ?? Math.round(lo + (hi - lo) * thorough);
  return { horizon: Math.max(1, horizon), rollouts: Math.max(1, rollouts) };
}

/** Modèle de décision (M9) : utilité + softmax, issues probabilistes, Monte Carlo. Voir `docs/decision-model.md`. */
export {
  MIN_TEMPERATURE,
  type TemperatureConfig,
  sampleIndex,
  sampleOutcome,
  softmax,
  temperatureOf,
} from './softmax.js';
export {
  expectedValence,
  hasUncertainOutcome,
  isSuccess,
  leavesFact,
  successProbability,
  valenceOf,
} from './outcome-values.js';
export { centered, weightsOf } from './weights.js';
export { type Coeffs, coeffsOf } from './probabilistic-coeffs.js';
export { PROBABILISTIC_OUTCOME_POLICY, ProbabilisticOutcomeModel, outcomeScore } from './probabilistic-outcome.js';
export { PROFILES, type Profile } from './utility-profiles.js';
export {
  REPETITION_WINDOW,
  type UtilityBreakdown,
  type UtilityConfig,
  affinity,
  utilitiesOf,
  utilityBreakdown,
  utilityOf,
} from './utility.js';
export {
  type DestinationScore,
  believedLocation,
  chooseDestinationByScore,
  destinationScores,
} from './utility-destination.js';
export {
  UTILITY_POLICY,
  UtilityDecisionPolicy,
  type UtilityPolicyConfig,
  utilityDistribution,
} from './utility-policy.js';
export { type MonteCarloConfig, type RolloutOverrides, type RolloutPlan, planFor } from './montecarlo-config.js';
export { cloneForRollout } from './montecarlo-clone.js';
export { reactionProbability, tellProbability } from './montecarlo-spread.js';
export { valueFor } from './montecarlo-value.js';
export { type RolloutResult, type WatchedFact, runRollout, watchedFactOf } from './montecarlo-rollout.js';
export {
  MONTECARLO_POLICY,
  MonteCarloDecisionPolicy,
  type OptionEstimate,
  type PlayerOption,
  estimateOptions,
  optionsForPlayer,
} from './montecarlo.js';

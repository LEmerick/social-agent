/** API publique de la partie pure de M3 : catalogue, options, résolution, économie, scores, rejeu. */
export * from './types.js';
export { OUTCOMES_BY_ACTION } from './outcomes.js';
export { relOf, memberOf, hasNegativePast } from './preconditions.js';
export {
  ACTION_CATALOG,
  CATALOG_VERSION,
  actionDef,
  assertInCatalog,
  isActionId,
  isEnabled,
  isPaidAction,
} from './catalog.js';
export { assertAllowed, availableOptions, costRefusal, effectiveCost, refusalReason } from './options.js';
export { type ResolveInput, type Resolution, refreshLabels, resolveInteraction } from '../resolution/resolve.js';
export { type RuleDef, RULE_TABLE, ruleFor, ruleId } from '../resolution/table.js';
export { eventTypeFor, importanceFor } from '../resolution/events-map.js';
export {
  HABITUATION_RULE,
  dailyCount,
  habituationFactor,
  habituationKey,
  lastKey,
  ticksSinceLast,
} from '../resolution/habituation.js';
export type { DraftEffect, Kit, RuleCtx, RuleFn, RuleSet } from '../resolution/kit.js';
export { COST_RULE, chargeAction, closingBalance, costEffect } from '../economy/charge.js';
export { type SettleOptions, type SettleResult, SURVIVAL_RULE, UPKEEP_RULE, settleEpoch } from '../economy/settle.js';
export { type ScoreSummary, type ScoreWeights, recomputeScores, scoreEntriesFor } from '../scoring/scores.js';
export { applyAndRecord, openEvent, type EventInit, type EventLink } from '../events/apply-record.js';
export {
  type ReplayOptions,
  effectPath,
  projectedValues,
  replayEffects,
  replayStatuses,
  untracedChanges,
} from '../events/replay.js';
export { journalHash, stateHash } from '../events/hash.js';
export { SCRIPTED_OUTCOME_POLICY, ScriptedOutcomeModel, type OutcomeScript } from '../decision/scripted-outcome.js';
export {
  HEURISTIC_OUTCOME_POLICY,
  HeuristicOutcomeModel,
  orderedLogit,
  successScore,
} from '../decision/heuristic-outcome.js';

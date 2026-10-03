export { type InteractionDeps, interactionHook } from './engine.js';
export {
  type DialogueGenerator,
  type DialogueInput,
  type DialogueResult,
  SummaryDialogue,
  type UtteranceDraft,
} from './dialogue.js';
export { type EconomyHookOptions, economyHook } from '../economy/hook.js';
export { ScoringService, type RecomputeResult } from '../scoring/service.js';

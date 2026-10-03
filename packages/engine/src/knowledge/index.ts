/** Connaissances, propagation et contexte d'agent (M4, partie pure). */
export { type FactInput, type RumorInput, type RumorResult, createFact, createRumor } from './facts.js';
export { type KnowledgeFilter, type KnownFact, bestEdge, edgesOf, knows, of, provenance } from './query.js';
export {
  ALLY_MIN_ALLIANCE,
  ALLY_MIN_TRUST,
  TELL_MIN_SENSITIVITY,
  type AgendaAddition,
  bondStrength,
  deferredTell,
  tellPriority,
} from './deferred.js';
export {
  OVERHEARD_FACTOR,
  type KnowledgeListener,
  type ListenerRole,
  type PropagationResult,
  type SkippedLearning,
  type TransmitInput,
  type WitnessInput,
  beliefFor,
  receivedConfidence,
  transmit,
  trustFactor,
  witness,
} from './transmit.js';
export * from '../agent/context.js';
export * from '../agent/context-render.js';

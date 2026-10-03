export type { EmbeddingPort } from '../ports/embedding.js';
export {
  DEFAULT_MEMORY_CONFIG,
  type DecayedMemory,
  type MemoryConfig,
  type MemoryDraft,
  type MemoryHit,
  type MemoryKind,
  type MemoryRecord,
  type MemoryRepository,
} from './types.js';
export { applyDecay, clamp01, decay, recalled } from './decay.js';
export { type MemoriesFromEventsOptions, memoriesFromEvents, salienceOf } from './from-events.js';
export { type RankedMemory, type RecallQuery, cosine, rankForRecall } from './recall.js';
export { type MemoryService, type RecallRequest, createMemoryService } from './service.js';

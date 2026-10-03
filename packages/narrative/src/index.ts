/** Moteur de narration (M10) : sélection des moments, arcs, script, confessionnal, validation, fiches Scene. */
export type {
  CharacterBrief,
  EpisodeSummary,
  EpochDigest,
  IssueCode,
  Moment,
  NarrativeArc,
  SelectOptions,
  StateDiffEntry,
  ValidationIssue,
} from './types.js';
export {
  ClaimSchema,
  EpisodeScriptSchema,
  LINE_KINDS,
  SHOT_KINDS,
  ScriptLineSchema,
  ScriptSceneSchema,
  ShotSchema,
  type Claim,
  type EpisodeLine,
  type EpisodeScript,
  type ScriptLine,
  type ScriptScene,
  type Shot,
} from './script.js';
export type {
  EpisodeLineRecord,
  EpisodeRecord,
  EpisodeSceneRecord,
  EpisodeStatus,
  EpisodeStore,
  NarrativeStoragePort,
  SimulationReader,
} from './ports.js';
export { episodeId, rowsOfScript, scriptOfRecord } from './episode-rows.js';
export { memoryEpisodeStore, memoryNarrativeStorage } from './storage/memory.js';
export { simulationReader } from './storage/reader.js';
export { type SqlClient, type SqlRunner, sqlEpisodeStore } from './storage/sql.js';
export { collectDigest, stateDiffOf } from './collect.js';
export { ancestorsOf, candidatesOf, selectMoments } from './select.js';
export { arcIdOf, buildArcsFrom } from './arcs.js';
export {
  type EpisodeValidator,
  type RecordedConfessional,
  type ValidateOptions,
  type ValidationResult,
  createEpisodeValidator,
} from './validator.js';
export {
  WRITER_SYSTEM,
  type WriterAgent,
  type WriterDeps,
  type WriterInput,
  type WriterWorld,
  createWriterAgent,
  writerPrompt,
} from './writer.js';
export {
  type ConfessionalDeps,
  type ConfessionalService,
  confessionalQuestion,
  createConfessionalService,
} from './confessional.js';
export { relationshipsBefore, storageContextProvider } from './context.js';
export { type CharacterVisualInfo, type SceneSheet, type SheetWorld, sceneSheetsOf, visualAt } from './sheets.js';
export { personaProvider } from './persona.js';
export {
  type Episode,
  type NarrativeEngine,
  type NarrativeEngineDeps,
  type NarrativeOptions,
  createNarrativeEngine,
} from './engine.js';

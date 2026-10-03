/**
 * Stockage de la narration. La simulation n'est exposée que par `SimulationReader` (méthodes de lecture, rien
 * d'autre) ; l'écriture se limite à `EpisodeStore` (tables `episode*` et `narrative_arc`). Côté SQL, le rôle
 * `ai_reality_narrative` applique la même frontière (voir la migration `narrative`).
 */
import type { CharacterRecord, EpochJournal, EpochRecord, EventRecord, Id, LocationRecord } from '@ai-reality/engine';
import type { ScriptLine, Shot, Claim } from './script.js';
import type { NarrativeArc, ValidationIssue } from './types.js';

export interface SimulationReader {
  epoch(epochId: Id): Promise<EpochRecord | undefined>;
  journal(epochId: Id): Promise<EpochJournal>;
  /** Tous les events du monde, triés par `seq`. */
  eventsOfWorld(worldId: Id): Promise<EventRecord[]>;
  characters(worldId: Id): Promise<CharacterRecord[]>;
  locations(worldId: Id): Promise<LocationRecord[]>;
}

export type EpisodeStatus = 'draft' | 'validated' | 'rejected';

export interface EpisodeSceneRecord {
  readonly id: Id;
  readonly episodeId: Id;
  readonly seq: number;
  readonly locationId: Id;
  readonly tone: string;
  readonly summary: string;
  readonly seconds: number;
  readonly characterIds: readonly Id[];
  readonly sourceEventIds: readonly Id[];
  readonly shots: readonly Shot[];
  readonly claims: readonly Claim[];
}

export interface EpisodeLineRecord extends ScriptLine {
  readonly id: Id;
  readonly episodeId: Id;
  readonly sceneId: Id;
  readonly seq: number;
  readonly llmCallId: Id | null;
}

export interface EpisodeRecord {
  readonly id: Id;
  readonly worldId: Id;
  readonly epochId: Id;
  /** Numéro de l'épisode = numéro de l'époque. */
  readonly number: number;
  /** Une nouvelle version remplace un épisode rejeté (pas de suppression). */
  readonly version: number;
  readonly title: string;
  readonly synopsis: string;
  readonly status: EpisodeStatus;
  readonly targetSeconds: number;
  readonly durationSeconds: number;
  readonly cliffhanger: string | null;
  readonly issues: readonly ValidationIssue[];
  readonly arcIds: readonly Id[];
  readonly scenes: readonly EpisodeSceneRecord[];
  readonly lines: readonly EpisodeLineRecord[];
}

export interface EpisodeStore {
  /** Écrit l'épisode, ses scènes, ses lignes et ses liens aux arcs, atomiquement. `DUPLICATE` si (époque, version) existe. */
  saveEpisode(episode: EpisodeRecord): Promise<void>;
  /** Statut de validation et problèmes relevés. `NOT_FOUND` si l'épisode n'existe pas. */
  setStatus(
    episodeId: Id,
    status: EpisodeStatus,
    issues: readonly ValidationIssue[],
    durationSeconds: number,
  ): Promise<void>;
  /** Crée ou met à jour des arcs (par identifiant). */
  upsertArcs(arcs: readonly NarrativeArc[]): Promise<void>;
  openArcs(worldId: Id): Promise<NarrativeArc[]>;
  /** Épisodes du monde, triés par numéro puis version. */
  episodes(worldId: Id): Promise<EpisodeRecord[]>;
}

export interface NarrativeStoragePort {
  readonly sim: SimulationReader;
  readonly episodes: EpisodeStore;
}

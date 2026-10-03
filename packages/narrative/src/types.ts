/** Types du moteur de narration : moments, arcs, condensé d'époque, issues de validation. */
import type {
  EffectRecord,
  EventRecord,
  Id,
  InteractionRecord,
  PresenceRecord,
  SceneRecord,
  UtteranceRecord,
} from '@ai-reality/engine';

/** Un event du journal retenu pour l'épisode. */
export interface Moment {
  readonly eventId: Id;
  readonly epochId: Id;
  readonly tick: number;
  readonly seq: number;
  readonly type: string;
  readonly importance: number;
  readonly sceneId: Id | null;
  readonly locationId: Id | null;
  readonly participantIds: readonly Id[];
  readonly causedByEventId: Id | null;
  /** Ancêtres causaux dans tout le journal du monde, du plus proche au plus lointain. */
  readonly ancestors: readonly Id[];
  /** Arc ouvert que ce moment prolonge (un de ses ancêtres y figure déjà). */
  readonly continuesArcId: Id | null;
  /** Temps d'écran estimé, en secondes. */
  readonly seconds: number;
  readonly summary: string;
  readonly utteranceIds: readonly Id[];
}

export type ArcStatus = 'open' | 'closed';

/** Chaîne causale de moments (`caused_by_event_id`), éventuellement étalée sur plusieurs épisodes. */
export interface NarrativeArc {
  readonly id: Id;
  readonly worldId: Id;
  readonly title: string;
  readonly status: ArcStatus;
  readonly rootEventId: Id;
  readonly firstEpochId: Id;
  readonly lastEpochId: Id;
  readonly characterIds: readonly Id[];
  /** Tous les events de l'arc, y compris ceux des épisodes précédents, dans l'ordre du journal. */
  readonly eventIds: readonly Id[];
  readonly importance: number;
}

/** Variation nette d'une dimension d'état sur l'époque (somme des effets). */
export interface StateDiffEntry {
  readonly targetKind: EffectRecord['targetKind'];
  readonly characterId: Id;
  readonly otherCharacterId: Id | null;
  readonly dimension: string;
  readonly delta: number;
  readonly valueAfter: number | null;
}

export interface CharacterBrief {
  readonly id: Id;
  readonly firstName: string;
  readonly autonomy: string;
}

/** Tout ce que la narration lit d'une époque terminée. */
export interface EpochDigest {
  readonly worldId: Id;
  readonly epochId: Id;
  readonly epochNumber: number;
  readonly events: readonly EventRecord[];
  readonly effects: readonly EffectRecord[];
  readonly stateDiff: readonly StateDiffEntry[];
  readonly scenes: readonly SceneRecord[];
  readonly presences: readonly PresenceRecord[];
  readonly interactions: readonly InteractionRecord[];
  readonly utterances: readonly UtteranceRecord[];
  readonly characters: readonly CharacterBrief[];
  /** Personnages pilotés par un joueur (autonomie `guided` ou `directive`). */
  readonly playerCharacterIds: readonly Id[];
  readonly openArcs: readonly NarrativeArc[];
  /** Cause de chaque event du monde (`null` pour une racine) : sert à remonter les chaînes entre époques. */
  readonly causes: Readonly<Record<Id, Id | null>>;
}

export interface SelectOptions {
  readonly targetSeconds: number;
  /** Temps d'écran minimal garanti à chaque personnage joueur (s'il a de quoi être montré). */
  readonly minScreenTimePerPlayer: number;
  /** Surcharge `digest.playerCharacterIds`. */
  readonly playerCharacterIds?: readonly Id[];
  /** Importance minimale pour le remplissage libre (le quota des joueurs l'ignore). Défaut 0.3. */
  readonly minImportance?: number;
}

export type IssueCode =
  | 'unknown_event'
  | 'unknown_location'
  | 'unknown_character'
  | 'character_absent'
  | 'source_location_mismatch'
  | 'speaker_not_in_scene'
  | 'unknown_utterance'
  | 'utterance_mismatch'
  | 'utterance_not_in_sources'
  | 'claim_not_in_sources'
  | 'claim_contradiction'
  | 'confessional_unrecorded'
  | 'duration_exceeded';

export interface ValidationIssue {
  readonly code: IssueCode;
  readonly message: string;
  readonly sceneIndex: number | null;
  readonly eventId: Id | null;
  readonly characterId: Id | null;
}

export interface EpisodeSummary {
  readonly number: number;
  readonly title: string;
  readonly synopsis: string;
  readonly cliffhanger: string | null;
}

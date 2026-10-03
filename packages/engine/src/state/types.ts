/**
 * Types du domaine partagés par tout le moteur. Le `SimState` est un objet sérialisable
 * (enregistrements simples, pas de Map) : il se clone avec `structuredClone` et se compare avec `toEqual`.
 * Les règles pures prennent un `SimState` et ne font aucun accès à la base ni au LLM.
 */
import type { CharacterAutonomy, CharacterStatus } from '../ports/storage.js';

export type Id = string;

// ───── Dimensions bornées ─────

export const BASE_AXES = ['trust', 'affection', 'rivalry', 'respect', 'fear', 'attraction', 'alliance'] as const;
export type Axis = (typeof BASE_AXES)[number];

/** Bornes des axes de base. `affection` est bipolaire. Les axes de saison (`extraAxes`) sont en 0..100. */
export const AXIS_BOUNDS: Readonly<Record<Axis, readonly [number, number]>> = {
  trust: [0, 100],
  affection: [-100, 100],
  rivalry: [0, 100],
  respect: [0, 100],
  fear: [0, 100],
  attraction: [0, 100],
  alliance: [0, 100],
};

export const AXIS_DEFAULTS: Readonly<Record<Axis, number>> = {
  trust: 30,
  affection: 0,
  rivalry: 0,
  respect: 50,
  fear: 0,
  attraction: 0,
  alliance: 0,
};

export const STAT_KEYS = ['energy', 'morale', 'popularity', 'influence', 'reputation'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export const SCORE_NAMES = ['social', 'drama', 'popularity', 'survival', 'influence'] as const;
export type ScoreName = (typeof SCORE_NAMES)[number];

export type Acquaintance = 'known_of' | 'met' | 'acquainted' | 'close';
export type Volume = 'whisper' | 'normal' | 'loud';
export type KnowledgeSource = 'seeded' | 'public' | 'witnessed' | 'overheard' | 'told' | 'inferred';
export type Belief = 'believes' | 'doubts' | 'disbelieves';
export type EffectTarget = 'stat' | 'mood' | 'relationship' | 'score' | 'credit' | 'goal' | 'item' | 'mission' | 'team';

// ───── Configuration ─────

export interface WorldConfig {
  readonly ticksPerEpoch: number;
  readonly tickMinutes: number;
  readonly maxConversationTurns: number;
  /** Nombre maximal d'interactions par scène et par tick. */
  readonly maxInteractionsPerScene: number;
  /** Instant (ms Unix) du tick 0 de l'époque 0 : sert à horodater les identifiants. */
  readonly startMs: number;
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  ticksPerEpoch: 32,
  tickMinutes: 30,
  maxConversationTurns: 8,
  maxInteractionsPerScene: 2,
  startMs: Date.UTC(2026, 0, 1, 8, 0, 0),
};

export interface EconomyRules {
  readonly enabled: boolean;
  readonly startingCredits: number;
  readonly dailyUpkeep: number;
  /** En dessous de ce solde, le personnage passe en `restricted`. */
  readonly restrictedThreshold: number;
  /** Nombre d'époques en `restricted` avant `elimination_pending`. */
  readonly graceEpochs: number;
}

export interface SeasonRules {
  readonly economy: EconomyRules;
  /** Axes de relation propres à la saison, stockés dans `extraAxes`. */
  readonly relationshipAxes: readonly string[];
  /** Pondération des scores : S = Σ poids × impact. */
  readonly scoreWeights: Readonly<Record<ScoreName, number>>;
  /** Actions activées en plus du catalogue de base (objets, votes…). */
  readonly enabledActions: readonly string[];
}

export const DEFAULT_SEASON_RULES: SeasonRules = {
  economy: { enabled: true, startingCredits: 100, dailyUpkeep: 10, restrictedThreshold: 20, graceEpochs: 2 },
  relationshipAxes: [],
  scoreWeights: { social: 1, drama: 1, popularity: 1, survival: 1, influence: 1 },
  enabledActions: [],
};

// ───── Nœuds et arêtes ─────

export interface Goal {
  readonly id: Id;
  readonly kind: 'main' | 'secondary' | 'social' | 'private';
  readonly description: string;
  readonly origin: 'player' | 'ai' | 'season';
  readonly targetCharacterId: Id | null;
  readonly status: 'open' | 'achieved' | 'abandoned';
}

/** Bonus structurés issus d'une directive du joueur (action-catalog.md §7). */
export interface DirectiveBiases {
  readonly actions: Readonly<Record<string, number>>;
  readonly targets: Readonly<Record<Id, number>>;
  readonly prefer: readonly string[];
  readonly forbid: readonly string[];
}

/** Intention d'agenda (engine-architecture.md §6, phase 2). Les intentions différées viennent de la propagation. */
export interface Intention {
  readonly kind: 'talk_to' | 'avoid' | 'attend' | 'tell' | 'go_to';
  readonly targetId: Id | null;
  readonly goal: string | null;
  readonly factId: Id | null;
  readonly locationId: Id | null;
  readonly priority: number;
}

export interface CharacterNode {
  readonly id: Id;
  readonly slug: string;
  readonly firstName: string;
  readonly autonomy: CharacterAutonomy;
  status: CharacterStatus;
  readonly traits: Readonly<Record<string, number>>;
  stats: Record<StatKey, number>;
  credits: number;
  /** Humeur volatile, 0..100 par émotion. */
  mood: Record<string, number>;
  scores: Record<ScoreName, number>;
  goals: Goal[];
  directive: DirectiveBiases | null;
  agenda: Intention[];
  /** Époque à laquelle le personnage est passé en `restricted` (null sinon). */
  restrictedSinceEpoch: number | null;
}

export interface RelationshipEdge {
  readonly sourceId: Id;
  readonly targetId: Id;
  trust: number;
  affection: number;
  rivalry: number;
  respect: number;
  fear: number;
  attraction: number;
  alliance: number;
  extraAxes: Record<string, number>;
  acquaintance: Acquaintance;
  interactionCount: number;
  labels: string[];
  firstMetEventId: Id | null;
  lastInteractionEventId: Id | null;
}

export interface ZoneNode {
  readonly id: Id;
  readonly slug: string;
  /** `location` : on entend depuis tout le lieu. `zone` : seulement dans la zone. */
  readonly hearingRange: 'zone' | 'location';
}

export interface LocationNode {
  readonly id: Id;
  readonly slug: string;
  readonly name: string;
  readonly kind: string;
  readonly capacity: number | null;
  readonly isPrivate: boolean;
  readonly zones: readonly ZoneNode[];
}

export interface RouteEdge {
  readonly fromLocationId: Id;
  readonly toLocationId: Id;
  readonly travelTicks: number;
}

export interface FactNode {
  readonly id: Id;
  readonly subjectId: Id | null;
  readonly predicate: string;
  readonly objectId: Id | null;
  readonly objectText: string | null;
  readonly isTrue: boolean;
  /** 0 public … 3 secret. */
  readonly sensitivity: number;
  readonly originEventId: Id | null;
  readonly inventedById: Id | null;
}

export interface KnowledgeEdge {
  readonly id: Id;
  readonly characterId: Id;
  readonly factId: Id;
  readonly sourceType: KnowledgeSource;
  readonly toldById: Id | null;
  readonly viaEventId: Id | null;
  readonly parentKnowledgeId: Id | null;
  readonly learnedEpoch: number;
  readonly learnedTick: number;
  readonly confidence: number;
  readonly belief: Belief;
}

/** Où se trouve un personnage à l'instant courant. */
export type Position =
  | { readonly kind: 'at'; readonly locationId: Id; readonly zoneId: Id | null }
  | { readonly kind: 'transit'; readonly fromLocationId: Id; readonly toLocationId: Id; readonly arrivalTick: number }
  | { readonly kind: 'offstage'; readonly reason: string; readonly lastLocationId: Id | null };

// ───── État de simulation ─────

export interface SimState {
  readonly world: { readonly id: Id; readonly seed: string; readonly config: WorldConfig };
  readonly season: {
    readonly id: Id;
    readonly number: number;
    readonly rulesVersion: number;
    readonly rules: SeasonRules;
  };
  epoch: { readonly id: Id; readonly number: number } | null;
  tick: number;
  /** Prochain numéro de séquence d'event (ordre total dans le monde). */
  nextEventSeq: number;
  characters: Record<Id, CharacterNode>;
  /** Clé : `relKey(source, target)`. */
  relationships: Record<string, RelationshipEdge>;
  locations: Record<Id, LocationNode>;
  routes: RouteEdge[];
  facts: Record<Id, FactNode>;
  knowledge: Record<Id, KnowledgeEdge>;
  positions: Record<Id, Position>;
  /** Compteurs d'habituation du jour : clé `actorId|action|targetId`. Remis à zéro à chaque époque. */
  dailyCounts: Record<string, number>;
  /** Extensions des formats de jeu (objets, équipes, missions, votes) : ajoutées en M7. */
  ext: Record<string, unknown>;
}

export const relKey = (sourceId: Id, targetId: Id): string => `${sourceId}>${targetId}`;

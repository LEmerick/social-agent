import {
  type CharacterRecord,
  type CharacterVisualRecord,
  type CharacterStateRecord,
  type DecisionRecord,
  type DirectiveRecord,
  type EffectRecord,
  type EpochRecord,
  type EventRecord,
  type FactNode,
  type GoalRecord,
  type InteractionRecord,
  type KnowledgeEdge,
  type LedgerRecord,
  type LocationRecord,
  type MemoryRecord,
  type PresenceRecord,
  type RelationshipEdge,
  type RouteEdge,
  type SceneRecord,
  type ScoreEntryRecord,
  type SeasonRecord,
  type UtteranceRecord,
  type WorldRecord,
  type ZoneRecord,
  DomainError,
} from '@ai-reality/engine';
import type { LlmCallRecord } from '@ai-reality/engine/llm';
import { type FormatTables, emptyFormatTables } from './repos-formats.js';

/** Contenu complet du stockage en mémoire : copié au début de chaque transaction. */
export interface Db {
  worlds: Map<string, WorldRecord>;
  seasons: Map<string, SeasonRecord>;
  locations: Map<string, LocationRecord>;
  zones: Map<string, ZoneRecord>;
  routes: RouteEdge[];
  characters: Map<string, CharacterRecord>;
  goals: Map<string, GoalRecord>;
  directives: Map<string, DirectiveRecord>;
  /** Clé : `source>target`. */
  relationships: Map<string, { worldId: string; edge: RelationshipEdge }>;
  facts: Map<string, { worldId: string; fact: FactNode }>;
  knowledge: Map<string, KnowledgeEdge>;
  epochs: Map<string, EpochRecord>;
  scenes: Map<string, SceneRecord>;
  presences: Map<string, PresenceRecord>;
  interactions: Map<string, InteractionRecord>;
  utterances: Map<string, UtteranceRecord>;
  decisions: Map<string, DecisionRecord>;
  events: Map<string, EventRecord>;
  effects: EffectRecord[];
  ledger: Map<string, LedgerRecord>;
  scoreEntries: Map<string, ScoreEntryRecord>;
  /** Clé : `characterId|epochId`. */
  characterStates: Map<string, CharacterStateRecord>;
  /** Clé : epochId. */
  snapshots: Map<string, RelationshipEdge[]>;
  llmCalls: Map<string, LlmCallRecord>;
  memories: Map<string, MemoryRecord>;
  /** Clé : `characterId|version`. */
  characterVisuals: Map<string, CharacterVisualRecord>;
  /** Formats de jeu (objets, missions, équipes, votes, calendrier) : voir `repos-formats.ts`. */
  formats: FormatTables;
}

export const emptyDb = (): Db => ({
  worlds: new Map(),
  seasons: new Map(),
  locations: new Map(),
  zones: new Map(),
  routes: [],
  characters: new Map(),
  goals: new Map(),
  directives: new Map(),
  relationships: new Map(),
  facts: new Map(),
  knowledge: new Map(),
  epochs: new Map(),
  scenes: new Map(),
  presences: new Map(),
  interactions: new Map(),
  utterances: new Map(),
  decisions: new Map(),
  events: new Map(),
  effects: [],
  ledger: new Map(),
  scoreEntries: new Map(),
  characterStates: new Map(),
  snapshots: new Map(),
  llmCalls: new Map(),
  memories: new Map(),
  characterVisuals: new Map(),
  formats: emptyFormatTables(),
});

const shallow = <T extends object>(table: T): T => {
  const copied: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(table)) {
    copied[key] = value instanceof Map ? new Map(value) : Array.isArray(value) ? [...(value as unknown[])] : value;
  }
  return copied as T;
};

/**
 * Copie de travail d'une transaction : chaque table est dupliquée (références des enregistrements partagées). Les
 * enregistrements ne sont jamais modifiés en place, seulement remplacés (`set`) ou insérés par copie profonde, et les
 * lectures renvoient des copies : annuler une transaction revient donc à jeter ces tables.
 */
export const cloneDb = (db: Db): Db => ({ ...shallow(db), formats: shallow(db.formats) });

/** Copie profonde : aucune référence interne ne s'échappe du stockage. */
export const copy = <T>(value: T): T => structuredClone(value);

/** Exécute une opération synchrone et renvoie une promesse ; une exception devient un rejet. */
export const later = <T>(op: () => T): Promise<T> =>
  new Promise<T>((resolve) => {
    resolve(op());
  });

export const duplicate = (what: string): DomainError => new DomainError('DUPLICATE', `${what} déjà présent`);
export const notFound = (what: string): DomainError => new DomainError('NOT_FOUND', `${what} introuvable`);

export function require_(present: boolean, what: string): void {
  if (!present) throw notFound(what);
}

/** Comparaison de chaînes indépendante de la locale (même ordre que les index binaires). */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const AXES_0_100 = ['trust', 'rivalry', 'respect', 'fear', 'attraction', 'alliance'] as const;

/** Les `CHECK` de la table `relationship` : axes bornés (l'affection va de -100 à 100), jamais de relation à soi-même. */
export function checkEdge(edge: RelationshipEdge): void {
  const outOfRange =
    AXES_0_100.some((axis) => edge[axis] < 0 || edge[axis] > 100) || edge.affection < -100 || edge.affection > 100;
  if (outOfRange || edge.sourceId === edge.targetId) {
    throw new DomainError(
      'CONSTRAINT_VIOLATION',
      'Contrainte CHECK violée (relationship_axes_range ou relationship_not_self)',
    );
  }
}

/** Intervalle semi-ouvert `[start, end)` ; `end` nul = sans fin (comme `int4range(tick_start, tick_end)`). */
export const overlaps = (a: PresenceRecord, b: PresenceRecord): boolean =>
  a.tickStart < (b.tickEnd ?? Infinity) && b.tickStart < (a.tickEnd ?? Infinity);

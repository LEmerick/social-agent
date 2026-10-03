/**
 * Enregistrements append-only produits par la simulation, et lot écrit à chaque tick.
 * Un tick = une transaction de stockage = un `TickBatch`.
 */
import type { EffectTarget, FactNode, Goal, Id, KnowledgeEdge, RelationshipEdge, ScoreName, Volume } from './types.js';
import type { CharacterStatus, GoalRecord } from '../ports/storage.js';

export interface EventParticipant {
  readonly characterId: Id;
  readonly role: 'actor' | 'target' | 'witness' | 'subject';
}

export interface EventRecord {
  readonly id: Id;
  readonly epochId: Id;
  readonly tick: number;
  /** Ordre total dans le monde, attribué par le moteur (déterministe). */
  readonly seq: number;
  readonly type: string;
  readonly sceneId: Id | null;
  readonly interactionId: Id | null;
  readonly locationId: Id | null;
  readonly payload: Readonly<Record<string, unknown>>;
  /** 0..1, signal pour la narration. */
  readonly importance: number;
  readonly causedByEventId: Id | null;
  readonly participants: readonly EventParticipant[];
}

/** Effet à appliquer, tel que le produit une règle pure. */
export interface EffectInput {
  readonly targetKind: EffectTarget;
  readonly characterId: Id;
  readonly otherCharacterId: Id | null;
  readonly dimension: string;
  readonly delta: number;
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly reason: string | null;
}

/** Effet appliqué et journalisé. `valueAfter` est la valeur après clamp. */
export interface EffectRecord extends EffectInput {
  readonly id: Id;
  readonly eventId: Id;
  readonly epochId: Id;
  readonly tick: number;
  readonly valueAfter: number | null;
}

export interface SceneRecord {
  readonly id: Id;
  readonly epochId: Id;
  readonly locationId: Id;
  readonly zoneId: Id | null;
  readonly kind: 'free' | 'activity' | 'meal' | 'ceremony' | 'confessional';
  readonly tickStart: number;
  tickEnd: number | null;
}

export interface PresenceRecord {
  readonly id: Id;
  readonly epochId: Id;
  readonly characterId: Id;
  readonly tickStart: number;
  tickEnd: number | null;
  readonly kind: 'scene' | 'transit' | 'offstage';
  readonly sceneId: Id | null;
  readonly fromLocationId: Id | null;
  readonly toLocationId: Id | null;
  readonly offstageReason: string | null;
  readonly role: 'participant' | 'observer' | 'hidden' | null;
}

export interface InteractionRecord {
  readonly id: Id;
  readonly epochId: Id;
  readonly sceneId: Id;
  readonly type: 'social' | 'relational' | 'strategic' | 'competitive' | 'informational' | 'collective';
  readonly initiatorId: Id | null;
  readonly tickStart: number;
  readonly tickEnd: number | null;
  readonly action: string;
  readonly outcome: string | null;
  readonly mode: 'dialogue' | 'summarized';
  readonly classification: Readonly<Record<string, unknown>> | null;
  readonly participants: readonly {
    readonly characterId: Id;
    readonly role: 'speaker' | 'addressee' | 'bystander' | 'eavesdropper';
  }[];
}

export interface UtteranceRecord {
  readonly id: Id;
  readonly interactionId: Id;
  readonly seq: number;
  readonly tick: number;
  readonly speakerId: Id;
  readonly addresseeIds: readonly Id[];
  readonly text: string;
  readonly intent: string | null;
  readonly tone: string | null;
  readonly emotion: string | null;
  readonly volume: Volume;
  readonly revealedFactIds: readonly Id[];
  readonly llmCallId: Id | null;
}

export interface DecisionRecord {
  readonly id: Id;
  readonly epochId: Id;
  readonly tick: number;
  readonly characterId: Id;
  readonly kind: 'action' | 'outcome';
  readonly options: unknown;
  readonly chosen: unknown;
  /** `scripted@1`, `llm@1`, `utility@1`, `montecarlo@1`, `player`… */
  readonly policy: string;
  readonly rngDraw: number | null;
  readonly interactionId: Id | null;
  readonly llmCallId: Id | null;
}

export interface LedgerRecord {
  readonly id: Id;
  readonly characterId: Id;
  readonly epochId: Id | null;
  readonly eventId: Id | null;
  /** Négatif = débit. */
  readonly amount: number;
  readonly category: 'upkeep' | 'activity' | 'special_action' | 'player_intervention' | 'reward';
  readonly source: 'purchased' | 'earned' | 'system';
}

export interface ScoreEntryRecord {
  readonly id: Id;
  readonly characterId: Id;
  readonly epochId: Id;
  readonly eventId: Id;
  readonly score: ScoreName;
  readonly weight: number;
  readonly impact: number;
  readonly ruleId: string;
}

/** Ligne d'état courant d'un personnage (projection), écrite à chaque tick et en fin d'époque. */
export interface CharacterStateRecord {
  readonly characterId: Id;
  readonly epochId: Id;
  readonly stats: Readonly<Record<string, number>>;
  readonly credits: number;
  readonly status: CharacterStatus;
  readonly mood: Readonly<Record<string, number>>;
  readonly scores: Readonly<Record<string, number>>;
  /** Données de reprise : agenda, position, compteurs. Opaque pour le stockage. */
  readonly runtime: Readonly<Record<string, unknown>>;
}

/** Tout ce qu'un tick écrit. Les adaptateurs l'appliquent dans une seule transaction. */
export interface TickBatch {
  readonly epochId: Id;
  readonly tick: number;
  readonly scenesOpened: readonly SceneRecord[];
  readonly scenesClosed: readonly { readonly id: Id; readonly tickEnd: number }[];
  readonly presencesOpened: readonly PresenceRecord[];
  readonly presencesClosed: readonly { readonly id: Id; readonly tickEnd: number }[];
  readonly interactions: readonly InteractionRecord[];
  readonly utterances: readonly UtteranceRecord[];
  readonly decisions: readonly DecisionRecord[];
  readonly events: readonly EventRecord[];
  readonly effects: readonly EffectRecord[];
  readonly facts: readonly FactNode[];
  readonly knowledge: readonly KnowledgeEdge[];
  readonly ledger: readonly LedgerRecord[];
  readonly scoreEntries: readonly ScoreEntryRecord[];
  /** Projections mises à jour (upsert). */
  readonly relationships: readonly RelationshipEdge[];
  readonly characterStates: readonly CharacterStateRecord[];
  /**
   * Objectifs créés ou modifiés pendant le tick (réflexion, missions) : insérés, ou mis à jour par identifiant
   * (`GoalRepository.upsert`). Relus par `loadSimState`.
   */
  readonly goals: readonly GoalRecord[];
  /** Extensions des formats (objets, votes…) : M7. */
  readonly ext: Readonly<Record<string, readonly unknown[]>>;
}

export const emptyTickBatch = (epochId: Id, tick: number): TickBatch => ({
  epochId,
  tick,
  scenesOpened: [],
  scenesClosed: [],
  presencesOpened: [],
  presencesClosed: [],
  interactions: [],
  utterances: [],
  decisions: [],
  events: [],
  effects: [],
  facts: [],
  knowledge: [],
  ledger: [],
  scoreEntries: [],
  relationships: [],
  characterStates: [],
  goals: [],
  ext: {},
});

/**
 * Ligne `GoalRecord` d'un objectif de `SimState` à écrire dans `TickBatch.goals`. `createdEpoch` n'est connu que
 * pour une création (`null` pour une mise à jour : la valeur en base est conservée) ; `closedEpoch` est posé dès que
 * l'objectif n'est plus ouvert.
 */
export const goalRecordOf = (characterId: Id, goal: Goal, epochNumber: number, created: boolean): GoalRecord => ({
  ...goal,
  characterId,
  createdEpoch: created ? epochNumber : null,
  closedEpoch: goal.status === 'open' ? null : epochNumber,
});

/**
 * Port de stockage. Le moteur ne connaît que ces interfaces ; les adaptateurs
 * (`storage-memory`, `storage-prisma`) les implémentent et doivent passer la même suite de contrat.
 *
 * Erreurs attendues par les adaptateurs :
 * - `DomainError('DUPLICATE', …)` : identifiant ou slug déjà pris ;
 * - `DomainError('NOT_FOUND', …)` : rattachement à un enregistrement inexistant.
 *
 * Les lectures de listes renvoient un ordre stable : celui précisé sur chaque méthode.
 */
import type { LlmCallRecord } from '../llm/record.js';
import type {
  CharacterStateRecord,
  DecisionRecord,
  EffectRecord,
  EventRecord,
  InteractionRecord,
  LedgerRecord,
  PresenceRecord,
  SceneRecord,
  ScoreEntryRecord,
  TickBatch,
  UtteranceRecord,
} from '../state/journal.js';
import type {
  ActionRecordNode,
  ItemDefNode,
  ItemNode,
  MissionAssignmentNode,
  MissionDefNode,
  ScheduledEventNode,
  TeamMembershipNode,
  TeamNode,
  VoteNode,
  VoteSessionNode,
} from '../state/format-state.js';
import type {
  DirectiveBiases,
  FactNode,
  Goal,
  KnowledgeEdge,
  RelationshipEdge,
  RouteEdge,
  ScoreName,
  ZoneNode,
} from '../state/types.js';

export type CharacterAutonomy = 'autonomous' | 'guided' | 'directive';
export type CharacterStatus = 'active' | 'restricted' | 'elimination_pending' | 'eliminated' | 'paused';
export type EpochStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface WorldRecord {
  readonly id: string;
  readonly name: string;
  readonly seed: string;
  readonly config: Readonly<Record<string, unknown>>;
}

export interface SeasonRecord {
  readonly id: string;
  readonly worldId: string;
  readonly number: number;
  readonly rules: Readonly<Record<string, unknown>>;
  readonly rulesVersion: number;
  readonly format: Readonly<Record<string, unknown>>;
}

export interface LocationRecord {
  readonly id: string;
  readonly worldId: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: string;
  readonly capacity: number | null;
  readonly isPrivate: boolean;
  readonly visualRef: string | null;
}

export interface ZoneRecord extends ZoneNode {
  readonly locationId: string;
}

export interface CharacterRecord {
  readonly id: string;
  readonly worldId: string;
  readonly slug: string;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly age: number | null;
  readonly gender: string | null;
  readonly origin: string | null;
  readonly backstory: string | null;
  readonly speechStyle: string | null;
  readonly autonomy: CharacterAutonomy;
  readonly status: CharacterStatus;
  readonly traits: Readonly<Record<string, number>>;
}

export interface GoalRecord extends Goal {
  readonly characterId: string;
  readonly createdEpoch: number | null;
  readonly closedEpoch: number | null;
}

export interface DirectiveRecord {
  readonly id: string;
  readonly characterId: string;
  readonly text: string;
  readonly fromEpoch: number;
  readonly toEpoch: number | null;
  readonly biases: DirectiveBiases | null;
}

export interface EpochRecord {
  readonly id: string;
  readonly worldId: string;
  readonly seasonId: string;
  readonly number: number;
  readonly status: EpochStatus;
  readonly rngSeed: string;
  readonly rulesVersion: number;
  readonly lastCommittedTick: number;
}

/** Tout le journal d'une époque, dans l'ordre d'écriture. */
export interface EpochJournal {
  /** Triés par `tickStart`, puis `id`. */
  readonly scenes: SceneRecord[];
  /** Triés par `characterId`, puis `tickStart`. */
  readonly presences: PresenceRecord[];
  /** Triées par `tickStart`, puis `id`. */
  readonly interactions: InteractionRecord[];
  /** Triées par `interactionId`, puis `seq`. */
  readonly utterances: UtteranceRecord[];
  /** Triées par `tick`, puis `id`. */
  readonly decisions: DecisionRecord[];
  /** Triés par `seq`. */
  readonly events: EventRecord[];
  /** Triés par event (`seq`), puis ordre d'insertion. */
  readonly effects: EffectRecord[];
  readonly ledger: LedgerRecord[];
  readonly scoreEntries: ScoreEntryRecord[];
}

export interface WorldRepository {
  insert(world: WorldRecord): Promise<void>;
  findById(id: string): Promise<WorldRecord | undefined>;
}

export interface SeasonRepository {
  insert(season: SeasonRecord): Promise<void>;
  findByNumber(worldId: string, number: number): Promise<SeasonRecord | undefined>;
  findById(id: string): Promise<SeasonRecord | undefined>;
  /** Met à jour les règles (recalcul des scores après changement de règles). */
  updateRules(id: string, rules: Readonly<Record<string, unknown>>, rulesVersion: number): Promise<void>;
}

export interface LocationRepository {
  insert(location: LocationRecord): Promise<void>;
  /** Triés par `slug`. */
  listByWorld(worldId: string): Promise<LocationRecord[]>;
}

export interface ZoneRepository {
  insert(zone: ZoneRecord): Promise<void>;
  /** Triées par `locationId`, puis `slug`. */
  listByWorld(worldId: string): Promise<ZoneRecord[]>;
}

export interface RouteRepository {
  insert(route: RouteEdge): Promise<void>;
  /** Triées par `fromLocationId`, puis `toLocationId`. */
  listByWorld(worldId: string): Promise<RouteEdge[]>;
}

export interface CharacterRepository {
  insert(character: CharacterRecord): Promise<void>;
  findById(id: string): Promise<CharacterRecord | undefined>;
  /** Triés par `slug`. */
  listByWorld(worldId: string): Promise<CharacterRecord[]>;
  updateStatus(id: string, status: CharacterStatus): Promise<void>;
}

export interface GoalRepository {
  insert(goal: GoalRecord): Promise<void>;
  /**
   * Insère l'objectif, ou met à jour celui de même identifiant (description, statut, cible, `closedEpoch`).
   * `createdEpoch` n'est écrit qu'à la création : une mise à jour le conserve.
   */
  upsert(goal: GoalRecord): Promise<void>;
  /** Triés par `characterId`, puis `id`. */
  listByWorld(worldId: string): Promise<GoalRecord[]>;
}

export interface DirectiveRepository {
  insert(directive: DirectiveRecord): Promise<void>;
  /** Directive en vigueur à cette époque (la plus récente), si elle existe. */
  current(characterId: string, epochNumber: number): Promise<DirectiveRecord | undefined>;
}

export interface RelationshipRepository {
  upsert(worldId: string, edges: readonly RelationshipEdge[]): Promise<void>;
  /** Triées par `sourceId`, puis `targetId`. */
  listByWorld(worldId: string): Promise<RelationshipEdge[]>;
}

export interface FactRepository {
  insert(worldId: string, facts: readonly FactNode[]): Promise<void>;
  /** Triés par `id`. */
  listByWorld(worldId: string): Promise<FactNode[]>;
}

export interface KnowledgeRepository {
  insert(edges: readonly KnowledgeEdge[]): Promise<void>;
  /** Triées par `characterId`, puis `id`. */
  listByWorld(worldId: string): Promise<KnowledgeEdge[]>;
  /** Chaîne de provenance, de l'origine (profondeur max) jusqu'au personnage. */
  provenance(characterId: string, factId: string): Promise<KnowledgeEdge[]>;
}

export interface EpochRepository {
  insert(epoch: EpochRecord): Promise<void>;
  findByNumber(worldId: string, number: number): Promise<EpochRecord | undefined>;
  findById(id: string): Promise<EpochRecord | undefined>;
  setStatus(id: string, status: EpochStatus): Promise<void>;
}

export interface JournalRepository {
  /**
   * Écrit tout ce qu'un tick a produit et positionne `epoch.lastCommittedTick = batch.tick`.
   * Doit être appelé dans la transaction du tick.
   */
  commitTick(batch: TickBatch): Promise<void>;
  read(epochId: string): Promise<EpochJournal>;
  /** Tous les events du monde, triés par `seq` (rejeu). */
  eventsOfWorld(worldId: string): Promise<EventRecord[]>;
  /**
   * Remplace le poids de chaque entrée de score de l'époque par `weights[entry.score]` (changement de pondération
   * de la saison). Les `impact` ne changent jamais. Époque inconnue ⇒ `NOT_FOUND`.
   */
  reweighScoreEntries(epochId: string, weights: Readonly<Record<ScoreName, number>>): Promise<void>;
}

export interface CharacterStateRepository {
  /** Dernière ligne connue de chaque personnage du monde (reprise, chargement). */
  latest(worldId: string): Promise<CharacterStateRecord[]>;
  /** Lignes d'une époque, triées par `characterId`. */
  listByEpoch(epochId: string): Promise<CharacterStateRecord[]>;
  /**
   * Fusionne `scores[characterId]` dans les scores de la ligne `(personnage, époque)` ; les personnages absents de
   * `scores` ne changent pas. Ligne inconnue ⇒ `NOT_FOUND`.
   */
  updateScores(epochId: string, scores: Readonly<Record<string, Readonly<Record<string, number>>>>): Promise<void>;
}

export interface SnapshotRepository {
  /** Fige les relations à la fin d'une époque (relationship_snapshot). */
  saveRelationships(epochId: string, edges: readonly RelationshipEdge[]): Promise<void>;
  /** Triées par `sourceId`, puis `targetId`. */
  relationships(epochId: string): Promise<RelationshipEdge[]>;
}

export interface LlmCallRepository {
  /** `DomainError('DUPLICATE', …)` si l'identifiant existe déjà. */
  insert(record: LlmCallRecord): Promise<void>;
  /** Appels de même `prompt_hash`, triés par date de création puis identifiant. */
  findByPromptHash(promptHash: string): Promise<LlmCallRecord[]>;
  /** Appels d'une époque, triés par date de création puis identifiant. */
  listByEpoch(epochId: string): Promise<LlmCallRecord[]>;
}

export type MemoryKind = 'episodic' | 'reflection';

/**
 * Souvenir subjectif à la première personne (table `memory`). Défini ici, avec les autres enregistrements
 * du port, pour que les adaptateurs l'importent depuis `@ai-reality/engine` ; `memory/types.ts` le ré-exporte.
 * `salience` est la saillance **à l'époque de référence** (`lastRecalledEpoch`, sinon l'époque de création) ;
 * la décroissance se calcule à la lecture (voir `memory/decay.ts`).
 */
export interface MemoryRecord {
  readonly id: string;
  readonly characterId: string;
  readonly eventId: string | null;
  readonly epochId: string;
  readonly kind: MemoryKind;
  readonly summary: string;
  readonly emotion: string | null;
  /** 0..1. */
  readonly salience: number;
  readonly aboutCharacterIds: readonly string[];
  /** Vecteur de dimension 1024, ou `null` tant qu'il n'est pas calculé. */
  readonly embedding: readonly number[] | null;
  readonly lastRecalledEpoch: number | null;
}

/** Résultat d'une recherche vectorielle : similarité cosinus dans [-1, 1]. */
export interface MemoryHit {
  readonly record: MemoryRecord;
  readonly similarity: number;
}

export interface MemoryRepository {
  /** `DUPLICATE` si l'identifiant existe ; `NOT_FOUND` si le personnage ou l'event n'existe pas. */
  insert(records: readonly MemoryRecord[]): Promise<void>;
  /** Tous les souvenirs du personnage, triés par `id`. */
  listByCharacter(characterId: string): Promise<MemoryRecord[]>;
  /**
   * Les `k` souvenirs **du personnage** les plus proches (distance cosinus), du plus proche au plus lointain
   * (égalités : `id`). Les souvenirs sans embedding sont ignorés.
   */
  search(characterId: string, embedding: readonly number[], k: number): Promise<MemoryHit[]>;
  /** Met à jour la saillance et la date du dernier rappel. `NOT_FOUND` si le souvenir n'existe pas. */
  updateRecall(id: string, update: { salience: number; lastRecalledEpoch: number }): Promise<void>;
}

// ───── Formats de jeu (M7) ─────
// Les types de nœuds sont réexportés ici : les adaptateurs ne voient le moteur que par le point d'entrée du paquet.
export type {
  ActionRecordNode,
  FormatState,
  ItemDefNode,
  ItemNode,
  MissionAssignmentNode,
  MissionDefNode,
  MissionReward,
  PlayedItem,
  ScheduledEventNode,
  TeamMembershipNode,
  TeamNode,
  VoteNode,
  VoteResult,
  VoteRules,
  VoteSessionNode,
} from '../state/format-state.js';

/** Suivi des formats sans table dédiée : historique d'actions et présences communes (lus par le DSL). */
export interface FormatRuntime {
  readonly actionLog: readonly ActionRecordNode[];
  readonly presence: Readonly<Record<string, number>>;
}

/**
 * Les `upsert*` insèrent ou mettent à jour par clé primaire ; une référence inexistante (saison, lieu, personnage,
 * définition, événement, époque) lève `NOT_FOUND`, un `(saison, slug)` déjà pris par un autre id `DUPLICATE`.
 * Les `list*` renvoient tout ce qui dépend de la saison, triés par identifiant (adhésions : équipe, personnage, époque).
 */
export interface ItemRepository {
  upsertDefs(seasonId: string, defs: readonly ItemDefNode[]): Promise<void>;
  listDefs(seasonId: string): Promise<ItemDefNode[]>;
  upsertItems(items: readonly ItemNode[]): Promise<void>;
  listItems(seasonId: string): Promise<ItemNode[]>;
}

export interface MissionRepository {
  upsertDefs(seasonId: string, defs: readonly MissionDefNode[]): Promise<void>;
  listDefs(seasonId: string): Promise<MissionDefNode[]>;
  upsertAssignments(assignments: readonly MissionAssignmentNode[]): Promise<void>;
  listAssignments(seasonId: string): Promise<MissionAssignmentNode[]>;
}

export interface TeamRepository {
  upsertTeams(seasonId: string, teams: readonly TeamNode[]): Promise<void>;
  listTeams(seasonId: string): Promise<TeamNode[]>;
  upsertMemberships(memberships: readonly TeamMembershipNode[]): Promise<void>;
  listMemberships(seasonId: string): Promise<TeamMembershipNode[]>;
}

export interface VoteRepository {
  upsertSessions(sessions: readonly VoteSessionNode[]): Promise<void>;
  listSessions(seasonId: string): Promise<VoteSessionNode[]>;
  /** Un bulletin par votant et par session : un second bulletin remplace le premier. */
  upsertVotes(votes: readonly VoteNode[]): Promise<void>;
  listVotes(seasonId: string): Promise<VoteNode[]>;
}

export interface ScheduleRepository {
  upsert(seasonId: string, events: readonly ScheduledEventNode[]): Promise<void>;
  list(seasonId: string): Promise<ScheduledEventNode[]>;
}

export interface FormatRuntimeRepository {
  save(seasonId: string, runtime: FormatRuntime): Promise<void>;
  /** Vide si rien n'a été sauvegardé. */
  load(seasonId: string): Promise<FormatRuntime>;
}

export interface StorageTx {
  readonly worlds: WorldRepository;
  readonly seasons: SeasonRepository;
  readonly locations: LocationRepository;
  readonly zones: ZoneRepository;
  readonly routes: RouteRepository;
  readonly characters: CharacterRepository;
  readonly goals: GoalRepository;
  readonly directives: DirectiveRepository;
  readonly relationships: RelationshipRepository;
  readonly facts: FactRepository;
  readonly knowledge: KnowledgeRepository;
  readonly epochs: EpochRepository;
  readonly journal: JournalRepository;
  readonly characterStates: CharacterStateRepository;
  readonly snapshots: SnapshotRepository;
  readonly llmCalls: LlmCallRepository;
  readonly memories: MemoryRepository;
  readonly items: ItemRepository;
  readonly missions: MissionRepository;
  readonly teams: TeamRepository;
  readonly votes: VoteRepository;
  readonly schedule: ScheduleRepository;
  readonly formatRuntime: FormatRuntimeRepository;
}

export interface StoragePort {
  /** Exécute `fn` dans une transaction : toute exception annule tout ce qui a été écrit. */
  tx<T>(fn: (s: StorageTx) => Promise<T>): Promise<T>;
}

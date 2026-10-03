/**
 * État des formats de jeu (game-formats.md) rangé dans `SimState.ext` : objets, équipes, missions, votes,
 * événements planifiés, plus deux projections de suivi (historique d'actions, présences communes) lues par le DSL.
 * Sérialisable comme le reste du `SimState` (enregistrements simples, pas de Map).
 */
import type { Condition } from '../formats/conditions/schema.js';
import type { Id, SimState } from './types.js';

export const FORMAT_EXT_KEY = 'format';

export type ItemKind = 'power' | 'resource' | 'clue' | 'cosmetic';
export type ItemStateName = 'active' | 'used' | 'expired' | 'destroyed';
export type MissionScope = 'individual' | 'team' | 'all';
export type MissionSecrecy = 'public' | 'private' | 'secret';
export type MissionStatus = 'active' | 'succeeded' | 'failed' | 'expired' | 'abandoned';
export type VoteKind = 'elimination' | 'designation' | 'public';
export type ScheduledKind =
  | 'challenge'
  | 'council'
  | 'meal'
  | 'announcement'
  | 'item_drop'
  | 'mission_assign'
  | 'team_shuffle'
  | 'merge'
  | 'final';

export interface ItemDefNode {
  readonly id: Id;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly kind: ItemKind;
  /** Libre : `nullify_votes_against_holder`, `expires: 'after_use'`, `points_to` (slug de l'objet qu'un indice désigne)… */
  readonly effects: Readonly<Record<string, unknown>>;
  readonly transferable: boolean;
  readonly expiresAfterEpoch: number | null;
  readonly visualRef: string | null;
}

/** Exemplaire d'objet. Invariant : au plus un emplacement (porteur OU lieu), jamais les deux. */
export interface ItemNode {
  readonly id: Id;
  readonly itemDefId: Id;
  holderId: Id | null;
  locationId: Id | null;
  hidden: boolean;
  searchDifficulty: number | null;
  readonly isFake: boolean;
  readonly fakeOfItemDefId: Id | null;
  state: ItemStateName;
}

export interface TeamNode {
  readonly id: Id;
  readonly slug: string;
  readonly name: string;
  readonly color: string | null;
  readonly campLocationId: Id | null;
  readonly createdEpoch: number;
  dissolvedEpoch: number | null;
}

/** Appartenance : active à l'époque `e` si `fromEpoch ≤ e` et (`toEpoch` nul ou `e ≤ toEpoch`). */
export interface TeamMembershipNode {
  readonly teamId: Id;
  readonly characterId: Id;
  readonly fromEpoch: number;
  toEpoch: number | null;
  readonly joinedEventId: Id | null;
}

export interface MissionReward {
  readonly credits?: number;
  readonly stats?: Readonly<Record<string, number>>;
  readonly scores?: Readonly<Record<string, number>>;
}

export interface MissionDefNode {
  readonly id: Id;
  readonly slug: string;
  readonly title: string;
  readonly briefing: string;
  readonly scope: MissionScope;
  readonly secrecy: MissionSecrecy;
  readonly objective: Condition;
  readonly failure: Condition | null;
  readonly reward: MissionReward;
  readonly penalty: MissionReward | null;
  readonly deadlineEpochOffset: number | null;
}

export interface MissionAssignmentNode {
  readonly id: Id;
  readonly missionDefId: Id;
  readonly characterId: Id | null;
  readonly teamId: Id | null;
  readonly assignedEventId: Id;
  readonly deadlineEpoch: number | null;
  status: MissionStatus;
  progress: Record<string, unknown>;
  resolvedEventId: Id | null;
}

export interface VoteRules {
  /** Égalité en tête : `revote` (jusqu'à `maxRounds`), `random` (tirage), `none` (personne). */
  readonly tie: 'revote' | 'random' | 'none';
  readonly maxRounds: number;
  /** Candidats éligibles ; par défaut, tous les personnages en jeu. */
  readonly candidates?: readonly Id[];
  readonly allowSelfVote: boolean;
  /** Les bulletins sont révélés au décompte (effets « il a voté contre moi »). */
  readonly revealVotes: boolean;
  /** Les objets joués qui annulent les votes contre leur porteur sont pris en compte. */
  readonly immunityItems: boolean;
  /** Tour courant (1 = premier tour) et session du tour précédent, pour les révotes. */
  readonly round: number;
  readonly previousSessionId?: Id;
}

export interface PlayedItem {
  readonly itemId: Id;
  readonly holderId: Id;
}

export interface VoteResult {
  readonly status: 'decided' | 'tie' | 'no_votes';
  /** Voix valides par candidat (après annulation par les objets). */
  readonly counts: Readonly<Record<Id, number>>;
  /** Candidats dont les votes ont été annulés par un objet joué. */
  readonly nullified: readonly Id[];
  readonly eliminated: Id | null;
  /** Candidats à égalité en tête. */
  readonly tied: readonly Id[];
  readonly needsRevote: boolean;
  readonly round: number;
}

export interface VoteSessionNode {
  readonly id: Id;
  readonly epochId: Id;
  readonly tick: number;
  readonly sceneId: Id | null;
  readonly kind: VoteKind;
  readonly electorate: readonly Id[];
  readonly rules: VoteRules;
  played: PlayedItem[];
  result: VoteResult | null;
  eventId: Id | null;
}

export interface VoteNode {
  readonly voteSessionId: Id;
  readonly voterId: Id;
  readonly targetId: Id;
  readonly decisionId: Id | null;
  revealed: boolean;
}

export interface ScheduledEventNode {
  readonly id: Id;
  readonly kind: ScheduledKind;
  readonly epoch: number | null;
  readonly tickStart: number | null;
  readonly tickEnd: number | null;
  readonly trigger: Condition | null;
  readonly locationId: Id | null;
  readonly participants: Readonly<Record<string, unknown>>;
  readonly mandatory: boolean;
  readonly announced: boolean;
  readonly params: Readonly<Record<string, unknown>>;
  firedEventId: Id | null;
}

/** Historique des actions réalisées (lu par `action_done`). */
export interface ActionRecordNode {
  readonly actorId: Id;
  readonly action: string;
  readonly targetId: Id | null;
  /** Lieu visé pour `search`, `hide`… */
  readonly locationId: Id | null;
  readonly epoch: number;
  readonly tick: number;
}

export interface FormatState {
  itemDefs: Record<Id, ItemDefNode>;
  items: Record<Id, ItemNode>;
  teams: Record<Id, TeamNode>;
  memberships: TeamMembershipNode[];
  missionDefs: Record<Id, MissionDefNode>;
  assignments: Record<Id, MissionAssignmentNode>;
  voteSessions: Record<Id, VoteSessionNode>;
  votes: VoteNode[];
  scheduled: Record<Id, ScheduledEventNode>;
  actionLog: ActionRecordNode[];
  /** Ticks passés en scène ensemble, par paire (`pairKey`). */
  presence: Record<string, number>;
}

export const emptyFormatState = (): FormatState => ({
  itemDefs: {},
  items: {},
  teams: {},
  memberships: [],
  missionDefs: {},
  assignments: {},
  voteSessions: {},
  votes: [],
  scheduled: {},
  actionLog: [],
  presence: {},
});

/** Le `FormatState` d'un `SimState` (créé vide au premier accès). */
export function formatOf(state: SimState): FormatState {
  const existing = state.ext[FORMAT_EXT_KEY] as FormatState | undefined;
  if (existing) return existing;
  const created = emptyFormatState();
  state.ext[FORMAT_EXT_KEY] = created;
  return created;
}

/** Lecture seule : un état sans format se lit comme un état vide, sans rien créer. */
export const peekFormat = (state: Readonly<SimState>): Readonly<FormatState> =>
  (state.ext[FORMAT_EXT_KEY] as FormatState | undefined) ?? emptyFormatState();

export function setFormatState(state: SimState, format: FormatState): void {
  state.ext[FORMAT_EXT_KEY] = format;
}

/** Clé d'une paire non ordonnée de personnages. */
export const pairKey = (a: Id, b: Id): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const defBySlug = (fs: Readonly<FormatState>, slug: string): ItemDefNode | undefined =>
  Object.values(fs.itemDefs).find((d) => d.slug === slug);

export const itemsHeldBy = (fs: Readonly<FormatState>, characterId: Id): ItemNode[] =>
  Object.values(fs.items)
    .filter((i) => i.holderId === characterId)
    .sort((a, b) => cmp(a.id, b.id));

export const itemsAt = (fs: Readonly<FormatState>, locationId: Id): ItemNode[] =>
  Object.values(fs.items)
    .filter((i) => i.locationId === locationId)
    .sort((a, b) => cmp(a.id, b.id));

export const isMemberAt = (m: TeamMembershipNode, epoch: number): boolean =>
  m.fromEpoch <= epoch && (m.toEpoch === null || epoch <= m.toEpoch);

/** Membres d'une équipe à une époque (triés). */
export const membersOf = (fs: Readonly<FormatState>, teamId: Id, epoch: number): Id[] =>
  fs.memberships
    .filter((m) => m.teamId === teamId && isMemberAt(m, epoch))
    .map((m) => m.characterId)
    .sort(cmp);

/** Équipe d'un personnage à une époque (la plus récemment rejointe si plusieurs). */
export function teamOf(fs: Readonly<FormatState>, characterId: Id, epoch: number): Id | null {
  const current = fs.memberships
    .filter((m) => m.characterId === characterId && isMemberAt(m, epoch))
    .sort((a, b) => b.fromEpoch - a.fromEpoch || cmp(a.teamId, b.teamId))[0];
  return current?.teamId ?? null;
}

/** Types publics de la session de jeu : demandes au joueur, événements perçus, introspection. */
import type { CharacterStatus, Id } from '@ai-reality/engine';

export interface PlayOption {
  /** Numéro à répondre, à partir de 1. */
  readonly n: number;
  readonly label: string;
  /** Titre de regroupement à l’affichage (« Avec Sarah », « Seul »…). */
  readonly group?: string;
}

export type PlayRequestKind = 'destination' | 'action' | 'outcome';

export interface PlayRequestContext {
  readonly place: string;
  readonly zone: string | null;
  /** Prénoms des personnes visibles dans la scène du joueur. */
  readonly present: readonly string[];
}

/** Une question posée au joueur ; la partie est suspendue jusqu’à `session.answer(id, n)`. */
export interface PlayRequest {
  readonly id: string;
  readonly kind: PlayRequestKind;
  readonly epoch: number;
  readonly tick: number;
  readonly time: string;
  readonly prompt: string;
  readonly options: readonly PlayOption[];
  readonly context: PlayRequestContext;
}

export type PlayEventKind = 'heard' | 'seen' | 'arrived' | 'left' | 'learned' | 'relation' | 'credits' | 'status';

/** Ce que le personnage perçoit. Aucun champ ne porte d’information hors de sa perception. */
export interface PlayEvent {
  readonly seq: number;
  readonly epoch: number;
  readonly tick: number;
  readonly time: string;
  readonly kind: PlayEventKind;
  readonly text: string;
  readonly interactionId?: Id;
  readonly speakerId?: Id;
  readonly otherId?: Id;
  readonly factId?: Id;
}

export interface PlayerStatus {
  readonly id: Id;
  readonly name: string;
  readonly status: CharacterStatus;
  readonly stats: Readonly<Record<string, number>>;
  readonly credits: number;
  readonly place: string | null;
  /** Identifiant du lieu courant (pour la carte). */
  readonly placeId: Id | null;
  readonly zone: string | null;
  readonly moving: boolean;
  readonly present: readonly string[];
}

export interface PlayerRelation {
  readonly otherId: Id;
  readonly name: string;
  readonly acquaintance: string;
  readonly axes: Readonly<Record<string, number>>;
  readonly labels: readonly string[];
}

export interface PlayerKnowledge {
  readonly factId: Id;
  readonly text: string;
  readonly source: string;
  readonly belief: string;
  readonly confidence: number;
}

export interface RelationChange {
  readonly otherId: Id;
  readonly name: string;
  readonly deltas: Readonly<Record<string, number>>;
  /** Somme des variations absolues. */
  readonly magnitude: number;
}

export interface EpochSummary {
  readonly epoch: number;
  readonly creditsBefore: number;
  readonly creditsAfter: number;
  readonly statusBefore: CharacterStatus;
  readonly statusAfter: CharacterStatus;
  /** Du plus grand changement au plus petit (les arêtes sortantes du joueur). */
  readonly relationChanges: readonly RelationChange[];
  readonly interactions: number;
  readonly learned: number;
}

export type PlaySignal =
  | { readonly kind: 'request'; readonly request: PlayRequest }
  | { readonly kind: 'epoch_end'; readonly summary: EpochSummary; readonly hasNext: boolean };

export interface PlayClock {
  readonly epoch: number;
  readonly tick: number;
  readonly ticksPerEpoch: number;
  readonly time: string;
}

export interface PlayMap {
  readonly locations: readonly { readonly id: Id; readonly name: string; readonly zones: readonly string[] }[];
  readonly routes: readonly { readonly from: Id; readonly to: Id; readonly minutes: number }[];
}

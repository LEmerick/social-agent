/**
 * Types du catalogue d'actions (action-catalog.md §2-3). Tout est pur : aucune règle ne touche au stockage ni au LLM.
 */
import type { ActionOption } from '../decision/ports.js';
import type { Id, SimState } from '../state/types.js';

export const ACTION_IDS = [
  'small_talk',
  'compliment',
  'confide',
  'comfort',
  'probe',
  'flirt',
  'express_feelings',
  'apologize',
  'provoke',
  'insult',
  'propose_alliance',
  'break_alliance',
  'request_favor',
  'negotiate_vote',
  'share_secret',
  'spread_rumor',
  'lie',
  'deflect',
  'confront',
  'accuse',
  'threaten',
  'challenge',
  'sabotage',
  'move_to',
  'avoid',
  'eavesdrop',
  'join_activity',
  'rest',
  'search',
  'pick_up',
  'give',
  'trade',
  'steal',
  'hide',
  'show_item',
  'use_item',
  'fake_item',
  'cast_vote',
  'spy_camp',
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export const OUTCOME_IDS = [
  'accepted',
  'accepted_conditional',
  'deflected',
  'refused',
  'backfired',
  'escalated',
  'believed',
  'doubted',
  'disbelieved',
  'won',
  'lost',
  'draw',
  'detected',
  'undetected',
  'found',
  'not_found',
  'found_clue',
] as const;
export type OutcomeId = (typeof OUTCOME_IDS)[number];

export type ActionCategory =
  | 'social'
  | 'relational'
  | 'strategic'
  | 'informational'
  | 'competitive'
  | 'collective'
  | 'movement'
  | 'solo'
  | 'special'
  | 'observation'
  | 'object';

export type ActionTarget = 'none' | 'character' | 'characters' | 'location' | 'slot';
export type ActionVolume = 'whisper' | 'normal' | 'loud' | 'hidden';

/** Un participant de la scène de l'acteur, avec sa position. */
export interface SceneMember {
  readonly characterId: Id;
  readonly locationId: Id;
  readonly zoneId: Id | null;
}

/**
 * Ce que le scheduler fournit aux règles pures pour une scène donnée.
 * Les champs optionnels viennent des extensions de format (objets, votes, équipes : M7).
 */
export interface SceneContext {
  /** Membres de la scène de l'acteur, acteur compris. */
  readonly members: readonly SceneMember[];
  /** Un créneau de vote est à venir (`negotiate_vote`). */
  readonly voteUpcoming?: boolean;
  /** Une `vote_session` est ouverte (`cast_vote`) et, si fourni, la liste des candidats. */
  readonly voteOpen?: boolean;
  readonly voteCandidates?: readonly Id[];
  /** Une activité est disponible pour un défi (`challenge`). */
  readonly activityAvailable?: boolean;
  /** Créneaux ouverts à l'inscription (`join_activity`) : l'identifiant du créneau est `option.targetId`. */
  readonly openSlots?: readonly Id[];
  /** Objets visibles et ramassables sur le lieu de l'acteur. */
  readonly itemsHere?: readonly Id[];
  /** Inventaires par personnage. */
  readonly inventory?: Readonly<Record<Id, readonly Id[]>>;
  /** Objets non transférables. */
  readonly untransferable?: readonly Id[];
  /** Lieux appartenant au camp d'une autre équipe (`spy_camp`). */
  readonly enemyCamps?: readonly Id[];
}

export type Precondition = (state: Readonly<SimState>, actorId: Id, option: ActionOption, ctx: SceneContext) => boolean;

export interface ActionDef {
  readonly id: ActionId;
  readonly category: ActionCategory;
  readonly target: ActionTarget;
  readonly preconditions: Precondition;
  /** `energy` négatif : l'action en régénère (`rest`). */
  readonly cost: { readonly energy?: number; readonly credits?: number };
  readonly defaultVolume: ActionVolume;
  /** Issues autorisées, de la plus favorable à l'acteur à la moins favorable. */
  readonly outcomes: readonly OutcomeId[];
  readonly version: number;
  /** Vrai si l'action n'existe que si `season.rules.enabledActions` l'active (objets, votes, espionnage). */
  readonly gated: boolean;
}

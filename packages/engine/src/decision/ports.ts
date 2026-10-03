/**
 * Points d'injection de la décision (action-catalog.md §4-5).
 * Pipeline d'une interaction : DecisionPolicy.choose → OutcomeModel.resolve → dialogue → vérification → résolution.
 */
import type { Rng } from '../core/rng.js';
import type { Id, SimState } from '../state/types.js';

/** Une action concrète : identifiant du catalogue + paramètres. */
export interface ActionOption {
  readonly action: string;
  readonly targetId: Id | null;
  /** `share_secret`, `confront`… : fait concerné. */
  readonly factId: Id | null;
  readonly itemId: Id | null;
  readonly locationId: Id | null;
}

export const optionKey = (o: ActionOption): string =>
  [o.action, o.targetId ?? '', o.factId ?? '', o.itemId ?? '', o.locationId ?? ''].join('|');

export interface DecisionResult {
  readonly chosen: ActionOption | null;
  /** Distribution sur les options, si la politique en produit une (traçabilité, joueur). */
  readonly distribution?: readonly { readonly option: ActionOption; readonly p: number }[];
  /** Valeur tirée pour le choix (null si choix LLM ou joueur). */
  readonly rngDraw: number | null;
  /** `scripted@1`, `utility@1`, `llm@1`… */
  readonly policy: string;
  readonly llmCallId?: Id | null;
}

export interface DecisionPolicy {
  /**
   * Choisit une action parmi `options` (déjà filtrées par les préconditions), ou `null` pour ne rien faire.
   * Ne modifie jamais `state`.
   */
  choose(input: {
    readonly actorId: Id;
    readonly state: Readonly<SimState>;
    readonly options: readonly ActionOption[];
    readonly rng: Rng;
  }): Promise<DecisionResult>;

  /**
   * Destination souhaitée à ce tick : un lieu, `stay` pour rester, ou `offstage` (sommeil…).
   * Calculée sans LLM en production (fonction de score), scriptée en test.
   */
  chooseDestination(input: {
    readonly actorId: Id;
    readonly state: Readonly<SimState>;
    readonly rng: Rng;
  }): Promise<DestinationChoice>;
}

export type DestinationChoice =
  | { readonly kind: 'stay' }
  | { readonly kind: 'go'; readonly locationId: Id; readonly zoneId: Id | null }
  | { readonly kind: 'offstage'; readonly reason: string };

export interface OutcomeResult {
  readonly outcome: string;
  readonly distribution?: Readonly<Record<string, number>>;
  readonly rngDraw: number | null;
  readonly policy: string;
  readonly llmCallId?: Id | null;
}

export interface OutcomeModel {
  resolve(input: {
    readonly option: ActionOption;
    readonly actorId: Id;
    readonly state: Readonly<SimState>;
    readonly rng: Rng;
  }): Promise<OutcomeResult>;
}

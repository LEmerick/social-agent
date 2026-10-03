/**
 * Niveaux de connaissance d'une relation (`acquaintance`), règle `acquaintance@1`.
 *
 * - `known_of` : on connaît le nom, sans avoir échangé ;
 * - `met` : au moins 1 interaction avec conscience mutuelle (posé par `resolveInteraction`) ;
 * - `acquainted` : au moins 3 interactions ;
 * - `close` : au moins 8 interactions, affection ≥ 20 et confiance ≥ 50 (le regard de la source sur la cible).
 *
 * Le niveau ne redescend jamais : une relation qui se dégrade reste une relation connue.
 * Les arêtes sont orientées : chaque sens est évalué avec ses propres axes, le compteur d'interactions étant commun.
 */
import type { Acquaintance, RelationshipEdge } from '../state/types.js';

export const ACQUAINTANCE_RULE = { id: 'acquaintance', version: 1 } as const;
export const ACQUAINTED_MIN_INTERACTIONS = 3;
export const CLOSE_MIN_INTERACTIONS = 8;
export const CLOSE_MIN_AFFECTION = 20;
export const CLOSE_MIN_TRUST = 50;

const RANK: Readonly<Record<Acquaintance, number>> = { known_of: 0, met: 1, acquainted: 2, close: 3 };

/** Niveau atteint d'après les compteurs et les axes de l'arête (sans tenir compte du niveau actuel). */
export function acquaintanceFor(e: Readonly<RelationshipEdge>): Acquaintance {
  if (
    e.interactionCount >= CLOSE_MIN_INTERACTIONS &&
    e.affection >= CLOSE_MIN_AFFECTION &&
    e.trust >= CLOSE_MIN_TRUST
  ) {
    return 'close';
  }
  if (e.interactionCount >= ACQUAINTED_MIN_INTERACTIONS) return 'acquainted';
  return e.interactionCount >= 1 ? 'met' : 'known_of';
}

/** Monte le niveau de l'arête si les compteurs le justifient ; ne le baisse jamais. */
export function promoteAcquaintance(e: RelationshipEdge): void {
  const reached = acquaintanceFor(e);
  if (RANK[reached] > RANK[e.acquaintance]) e.acquaintance = reached;
}

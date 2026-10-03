/**
 * Lecture des connaissances. C'est LE point d'accès aux faits côté personnage : on ne lit `state.facts`
 * qu'à travers une connaissance (`of`), jamais directement.
 */
import type { FactNode, Id, KnowledgeEdge, SimState } from '../state/types.js';

/** Un fait tel qu'un personnage le connaît : le fait, sa meilleure connaissance, et toutes ses connaissances. */
export interface KnownFact {
  readonly fact: FactNode;
  /** Connaissance retenue : la plus confiante (à égalité, la plus ancienne). */
  readonly knowledge: KnowledgeEdge;
  readonly all: readonly KnowledgeEdge[];
}

export interface KnowledgeFilter {
  /** Ne garde que les faits portant sur ce personnage (sujet ou objet). */
  readonly about?: Id;
  readonly minConfidence?: number;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byAge = (a: KnowledgeEdge, b: KnowledgeEdge): number =>
  a.learnedEpoch - b.learnedEpoch || a.learnedTick - b.learnedTick || cmp(a.id, b.id);

/** Connaissances d'un personnage, par fait (ordre déterministe : fait le plus ancien appris d'abord). */
export function edgesOf(state: Readonly<SimState>, characterId: Id, factId?: Id): KnowledgeEdge[] {
  return Object.values(state.knowledge)
    .filter((k) => k.characterId === characterId && (factId === undefined || k.factId === factId))
    .sort(byAge);
}

/** Meilleure connaissance d'un fait pour un personnage (`undefined` s'il ne le connaît pas). */
export function bestEdge(state: Readonly<SimState>, characterId: Id, factId: Id): KnowledgeEdge | undefined {
  return [...edgesOf(state, characterId, factId)].sort((a, b) => b.confidence - a.confidence || byAge(a, b))[0];
}

/** Le personnage connaît-il ce fait (quelle que soit sa croyance) ? */
export function knows(state: Readonly<SimState>, characterId: Id, factId: Id): boolean {
  return edgesOf(state, characterId, factId).length > 0;
}

/** Faits connus du personnage, avec leur meilleure connaissance. Seule voie d'accès aux faits pour un agent. */
export function of(state: Readonly<SimState>, characterId: Id, filter: KnowledgeFilter = {}): KnownFact[] {
  const byFact = new Map<Id, KnowledgeEdge[]>();
  for (const k of edgesOf(state, characterId)) byFact.set(k.factId, [...(byFact.get(k.factId) ?? []), k]);
  const known: KnownFact[] = [];
  for (const [factId, all] of byFact) {
    const fact = state.facts[factId];
    const best = [...all].sort((a, b) => b.confidence - a.confidence || byAge(a, b))[0];
    if (!fact || !best) continue;
    if (filter.minConfidence !== undefined && best.confidence < filter.minConfidence) continue;
    if (filter.about !== undefined && fact.subjectId !== filter.about && fact.objectId !== filter.about) continue;
    known.push({ fact, knowledge: best, all });
  }
  return known;
}

/**
 * Chaîne de provenance, de l'origine jusqu'au personnage : même ordre et même point de départ que
 * `KnowledgeRepository.provenance` (départ = la plus ancienne connaissance du fait par ce personnage).
 */
export function provenance(state: Readonly<SimState>, characterId: Id, factId: Id): KnowledgeEdge[] {
  const chain: KnowledgeEdge[] = [];
  const seen = new Set<Id>();
  let current = edgesOf(state, characterId, factId)[0];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentKnowledgeId ? state.knowledge[current.parentKnowledgeId] : undefined;
  }
  return chain.reverse();
}

/** Création de faits : vérités (`createFact`) et rumeurs inventées (`createRumor`). Mutent `state.facts` / `state.knowledge`. */
import { DomainError } from '../core/errors.js';
import type { IdFactory } from '../core/id.js';
import type { FactNode, Id, KnowledgeEdge, SimState } from '../state/types.js';

export interface FactInput {
  readonly subjectId?: Id | null;
  readonly predicate: string;
  readonly objectId?: Id | null;
  readonly objectText?: string | null;
  /** 0 public … 3 secret. */
  readonly sensitivity: number;
  readonly originEventId?: Id | null;
}

export interface RumorInput extends FactInput {
  readonly inventorId: Id;
  readonly epoch: number;
  readonly tick: number;
}

export interface RumorResult {
  readonly fact: FactNode;
  /** Connaissance de l'inventeur : il sait que c'est faux (`belief = disbelieves`, source `inferred`). */
  readonly knowledge: KnowledgeEdge;
}

function requireCharacter(state: Readonly<SimState>, id: Id | null | undefined, what: string): void {
  if (id !== null && id !== undefined && !state.characters[id]) {
    throw new DomainError('NOT_FOUND', `${what} ${id} absent du SimState`);
  }
}

function buildFact(state: Readonly<SimState>, input: FactInput, ids: IdFactory, extra: Partial<FactNode>): FactNode {
  if (!Number.isInteger(input.sensitivity) || input.sensitivity < 0 || input.sensitivity > 3) {
    throw new DomainError('INVALID_FACT', `Sensibilité ${String(input.sensitivity)} hors 0..3`);
  }
  if (input.predicate.trim() === '') throw new DomainError('INVALID_FACT', 'Prédicat vide');
  requireCharacter(state, input.subjectId, 'Sujet');
  requireCharacter(state, input.objectId, 'Objet');
  return {
    id: ids.next(),
    subjectId: input.subjectId ?? null,
    predicate: input.predicate,
    objectId: input.objectId ?? null,
    objectText: input.objectText ?? null,
    isTrue: true,
    sensitivity: input.sensitivity,
    originEventId: input.originEventId ?? null,
    inventedById: null,
    ...extra,
  };
}

/** Crée un fait vrai. Personne ne le connaît encore : `witness` / `transmit` créent les connaissances. */
export function createFact(state: SimState, input: FactInput, ids: IdFactory): FactNode {
  const fact = buildFact(state, input, ids, {});
  state.facts[fact.id] = fact;
  return fact;
}

/** Crée une rumeur : fait faux (`isTrue = false`) attribué à son inventeur (`invented_by`), que celui-ci connaît. */
export function createRumor(state: SimState, input: RumorInput, ids: IdFactory): RumorResult {
  requireCharacter(state, input.inventorId, 'Inventeur');
  const fact = buildFact(state, input, ids, { isTrue: false, inventedById: input.inventorId });
  state.facts[fact.id] = fact;
  const knowledge: KnowledgeEdge = {
    id: ids.next(),
    characterId: input.inventorId,
    factId: fact.id,
    sourceType: 'inferred',
    toldById: null,
    viaEventId: input.originEventId ?? null,
    parentKnowledgeId: null,
    learnedEpoch: input.epoch,
    learnedTick: input.tick,
    confidence: 1,
    belief: 'disbelieves',
  };
  state.knowledge[knowledge.id] = knowledge;
  return { fact, knowledge };
}

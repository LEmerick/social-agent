/**
 * La possession est une connaissance (game-formats.md §2.3) : chaque changement de main crée (ou retrouve) le fait
 * `holds(porteur, item:<id>)` et le fait connaître à ceux qui y assistent.
 */
import { createFact, createRumor } from '../knowledge/facts.js';
import { witness } from '../knowledge/transmit.js';
import type { Listener } from '../scene/audience.js';
import type { FactNode, Id, SimState } from '../state/types.js';
import type { FormatContext, FormatOutput } from './output.js';

export const itemRef = (itemId: Id): string => `item:${itemId}`;
export const itemDefRef = (slug: string): string => `item_def:${slug}`;
export const itemAtRef = (itemId: Id, locationId: Id): string => `item:${itemId}@${locationId}`;

export const HOLDS = 'holds';
export const ITEM_AT = 'item_at';
/** Sensibilité des faits de possession : secrets (game-formats.md §2.3). */
export const HOLDS_SENSITIVITY = 3;

/** Le fait vrai `predicate(subject, objectText)` s'il existe déjà, sinon il est créé et ajouté à la sortie. */
export function ensureFact(
  state: SimState,
  fc: FormatContext,
  out: FormatOutput,
  input: { subjectId: Id | null; predicate: string; objectText: string; sensitivity: number; originEventId: Id | null },
): FactNode {
  const existing = Object.values(state.facts).find(
    (f) =>
      f.isTrue &&
      f.subjectId === input.subjectId &&
      f.predicate === input.predicate &&
      f.objectText === input.objectText,
  );
  if (existing) return existing;
  const fact = createFact(state, input, fc.ids);
  out.facts.push(fact);
  return fact;
}

/** Les témoins directs qui entendent (le porteur est toujours du nombre) apprennent le fait. */
export function witnessFact(
  state: SimState,
  fc: FormatContext,
  out: FormatOutput,
  fact: FactNode,
  people: readonly Id[],
  extra: readonly Listener[],
  viaEventId: Id,
): void {
  const seen = new Set<Id>();
  const witnesses: Listener[] = [];
  for (const l of [...people.map((characterId): Listener => ({ characterId, perception: 'hears' })), ...extra]) {
    if (seen.has(l.characterId)) continue;
    seen.add(l.characterId);
    witnesses.push(l);
  }
  const result = witness(state, { factIds: [fact.id], witnesses, viaEventId, epoch: fc.epoch, tick: fc.tick }, fc.ids);
  out.knowledge.push(...result.knowledge);
}

/** Fait vrai `holds(porteur, item)`, connu du porteur et des témoins. */
export function learnHolds(
  state: SimState,
  fc: FormatContext,
  out: FormatOutput,
  input: { holderId: Id; itemId: Id; witnesses: readonly Listener[]; eventId: Id },
): FactNode {
  const fact = ensureFact(state, fc, out, {
    subjectId: input.holderId,
    predicate: HOLDS,
    objectText: itemRef(input.itemId),
    sensitivity: HOLDS_SENSITIVITY,
    originEventId: input.eventId,
  });
  witnessFact(state, fc, out, fact, [input.holderId], input.witnesses, input.eventId);
  return fact;
}

/** Fait faux `holds(inventeur, item_def:<slug>)` inventé par le porteur d'un faux objet ; il sait que c'est faux. */
export function inventHolds(
  state: SimState,
  fc: FormatContext,
  out: FormatOutput,
  input: { inventorId: Id; slug: string; eventId: Id },
): FactNode {
  const { fact, knowledge } = createRumor(
    state,
    {
      subjectId: input.inventorId,
      predicate: HOLDS,
      objectText: itemDefRef(input.slug),
      sensitivity: HOLDS_SENSITIVITY,
      originEventId: input.eventId,
      inventorId: input.inventorId,
      epoch: fc.epoch,
      tick: fc.tick,
    },
    fc.ids,
  );
  out.facts.push(fact);
  out.knowledge.push(knowledge);
  return fact;
}

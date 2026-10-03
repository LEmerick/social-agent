import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IDS, aSimState } from '@ai-reality/testkit';
import { DomainError } from '../../src/core/errors.js';
import { simIdFactory } from '../../src/core/sim-ids.js';
import {
  OVERHEARD_FACTOR,
  beliefFor,
  bestEdge,
  createFact,
  createRumor,
  deferredTell,
  knows,
  of,
  provenance,
  receivedConfidence,
  tellPriority,
  transmit,
  trustFactor,
  witness,
} from '../../src/knowledge/index.js';
import type { SimState } from '../../src/state/types.js';
import { defaultEdge } from '../../src/state/apply-effect.js';
import { relKey } from '../../src/state/types.js';
import { eventId } from '../helpers/chain-scenario.js';

const { alexandre: A, sarah: S, lea: L, thomas: T } = IDS.characters;
const mkIds = (state: SimState, stream = 'k') => simIdFactory(state.world.seed, state.world.config, 0, 3, stream);
const when = (n = 1) => ({ viaEventId: eventId(n), epoch: 0, tick: 3 });
const hear = (characterId: string) => ({ characterId, perception: 'hears' as const });
const setTrust = (state: SimState, from: string, to: string, trust: number) => {
  state.relationships[relKey(from, to)] = { ...defaultEdge(from, to), trust };
};

function withSecret(sensitivity = 1) {
  const state = aSimState();
  const ids = mkIds(state);
  const fact = createFact(state, { subjectId: S, predicate: 'cache', objectText: 'un secret', sensitivity }, ids);
  witness(state, { factIds: [fact.id], witnesses: [hear(S)], ...when(1) }, ids);
  return { state, ids, fact };
}

describe('création de faits', () => {
  it('createFact crée un fait vrai que personne ne connaît encore', () => {
    const state = aSimState();
    const fact = createFact(state, { subjectId: S, predicate: 'aime', objectId: L, sensitivity: 1 }, mkIds(state));
    expect(fact).toMatchObject({ isTrue: true, inventedById: null, subjectId: S, objectId: L });
    expect(state.facts[fact.id]).toBe(fact);
    expect(knows(state, S, fact.id)).toBe(false);
  });

  it('refuse une sensibilité hors 0..3 et un sujet inconnu', () => {
    const state = aSimState();
    expect(() => createFact(state, { predicate: 'x', sensitivity: 4 }, mkIds(state))).toThrow(DomainError);
    expect(() => createFact(state, { subjectId: 'inconnu', predicate: 'x', sensitivity: 1 }, mkIds(state))).toThrow(
      DomainError,
    );
  });

  it('une rumeur est un fait faux attribué à son inventeur, qui la connaît', () => {
    const state = aSimState();
    const { fact, knowledge } = createRumor(
      state,
      { inventorId: T, subjectId: A, predicate: 'a triché', sensitivity: 2, epoch: 0, tick: 3 },
      mkIds(state),
    );
    expect(fact).toMatchObject({ isTrue: false, inventedById: T, subjectId: A });
    expect(knowledge).toMatchObject({ characterId: T, factId: fact.id, sourceType: 'inferred', confidence: 1 });
    expect(of(state, T).map((k) => k.fact.id)).toEqual([fact.id]);
  });
});

describe('transmission', () => {
  it("un agent ne peut pas révéler un fait qu'il ne connaît pas, et rien n'est modifié", () => {
    const { state, ids, fact } = withSecret();
    const before = structuredClone(state);
    const call = () => transmit(state, { factIds: [fact.id], fromId: L, listeners: [hear(T)], ...when(2) }, ids);
    expect(call).toThrow(expect.objectContaining({ code: 'UNKNOWN_FACT' }));
    expect(state).toEqual(before);
  });

  it("est atomique : un seul fait inconnu annule tout l'envoi", () => {
    const { state, ids, fact } = withSecret();
    const other = createFact(state, { predicate: 'autre', sensitivity: 0 }, ids);
    const before = Object.keys(state.knowledge).length;
    expect(() =>
      transmit(state, { factIds: [fact.id, other.id], fromId: S, listeners: [hear(L)], ...when(2) }, ids),
    ).toThrow(DomainError);
    expect(Object.keys(state.knowledge)).toHaveLength(before);
  });

  it('formule de confiance : conf reçue = conf émetteur × (0,5 + trust/200)', () => {
    expect(trustFactor(0)).toBe(0.5);
    expect(trustFactor(100)).toBe(1);
    expect(receivedConfidence(0.8, 60)).toBeCloseTo(0.8 * 0.8, 10);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.integer({ min: 0, max: 100 }), (c, t) => {
        const r = receivedConfidence(c, t);
        expect(r).toBeCloseTo(c * (0.5 + t / 200), 10);
        expect(r).toBeLessThanOrEqual(c + 1e-12);
        expect(receivedConfidence(c, t, true)).toBeCloseTo(r * OVERHEARD_FACTOR, 10);
      }),
    );
  });

  it('applique la formule à la connaissance créée, avec parent et source', () => {
    const { state, ids, fact } = withSecret();
    setTrust(state, L, S, 60);
    const { knowledge } = transmit(state, { factIds: [fact.id], fromId: S, listeners: [hear(L)], ...when(2) }, ids);
    const parent = bestEdge(state, S, fact.id);
    expect(knowledge).toHaveLength(1);
    expect(knowledge[0]).toMatchObject({
      characterId: L,
      sourceType: 'told',
      toldById: S,
      parentKnowledgeId: parent?.id,
      belief: 'believes',
    });
    expect(knowledge[0]?.confidence).toBeCloseTo(0.8, 10);
  });

  it('la croyance dépend de la confiance envers l’émetteur', () => {
    expect(beliefFor(80, 0.9)).toBe('believes');
    expect(beliefFor(20, 0.6)).toBe('doubts');
    expect(beliefFor(5, 0.5)).toBe('disbelieves');
    expect(beliefFor(80, 0.2)).toBe('doubts');
    const { state, ids, fact } = withSecret();
    setTrust(state, L, S, 5);
    const r = transmit(state, { factIds: [fact.id], fromId: S, listeners: [hear(L)], ...when(2) }, ids);
    expect(r.knowledge[0]?.belief).toBe('disbelieves');
  });

  it('pas de doublon pour le même personnage, fait et event', () => {
    const { state, ids, fact } = withSecret();
    const send = () => transmit(state, { factIds: [fact.id], fromId: S, listeners: [hear(L)], ...when(2) }, ids);
    expect(send().knowledge).toHaveLength(1);
    const again = send();
    expect(again.knowledge).toHaveLength(0);
    expect(again.skipped).toEqual([{ characterId: L, factId: fact.id, reason: 'duplicate' }]);
    // Un autre event est une nouvelle preuve.
    const other = transmit(state, { factIds: [fact.id], fromId: S, listeners: [hear(L)], ...when(3) }, ids);
    expect(other.knowledge).toHaveLength(1);
    expect(of(state, L)).toHaveLength(1);
  });

  it('un indiscret apprend en `overheard`, un voyant n’apprend rien, l’émetteur est ignoré', () => {
    const { state, ids, fact } = withSecret();
    const r = transmit(
      state,
      {
        factIds: [fact.id],
        fromId: S,
        listeners: [
          { ...hear(L), role: 'addressee' },
          { ...hear(T), role: 'eavesdropper' },
          { characterId: A, perception: 'sees' },
          hear(S),
        ],
        ...when(2),
      },
      ids,
    );
    expect(r.knowledge.map((k) => [k.characterId, k.sourceType])).toEqual([
      [L, 'told'],
      [T, 'overheard'],
    ]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['sees_only', 'is_sender']);
    expect(knows(state, A, fact.id)).toBe(false);
  });

  it('`witness` : `witnessed` à confiance 1 pour qui entend ; qui ne fait que voir n’apprend pas le contenu', () => {
    const state = aSimState();
    const ids = mkIds(state);
    const fact = createFact(state, { subjectId: A, predicate: 'murmure', sensitivity: 1 }, ids);
    const r = witness(
      state,
      { factIds: [fact.id], witnesses: [hear(A), hear(S), { characterId: L, perception: 'sees' }], ...when(1) },
      ids,
    );
    expect(r.knowledge.map((k) => [k.characterId, k.sourceType, k.confidence, k.belief, k.parentKnowledgeId])).toEqual([
      [A, 'witnessed', 1, 'believes', null],
      [S, 'witnessed', 1, 'believes', null],
    ]);
    expect(knows(state, L, fact.id)).toBe(false);
    expect(provenance(state, S, fact.id)).toHaveLength(1);
  });
});

describe('intentions différées', () => {
  it('un fait sensible crée une intention `tell` vers un allié probable, pas vers l’émetteur ni le sujet', () => {
    const state = aSimState();
    const ids = mkIds(state);
    setTrust(state, T, A, 90);
    state.relationships[relKey(T, L)] = { ...defaultEdge(T, L), alliance: 60 };
    const fact = createFact(state, { subjectId: A, predicate: 'a menti', sensitivity: 3 }, ids);
    witness(state, { factIds: [fact.id], witnesses: [hear(A), hear(S)], ...when(1) }, ids);
    const r = transmit(state, { factIds: [fact.id], fromId: S, listeners: [hear(T)], ...when(2) }, ids);
    // T ne fait confiance qu'au sujet (A) et à l'émetteur éventuel : seul L est un allié valable.
    expect(r.agenda).toEqual([
      { characterId: T, intention: expect.objectContaining({ kind: 'tell', targetId: L, factId: fact.id }) },
    ]);
    expect(state.characters[T]?.agenda).toHaveLength(1);
  });

  it('pas d’intention pour un fait peu sensible, ni pour le sujet du fait', () => {
    const { state, fact } = withSecret(1);
    expect(deferredTell(state, S, fact, null)).toBeNull();
    const s3 = withSecret(3);
    expect(deferredTell(s3.state, S, s3.fact, null)).toBeNull(); // S est le sujet
  });

  it('la priorité croît avec la sensibilité et la sociabilité, décroît avec la loyauté, et reste dans [0,05 ; 1]', () => {
    const { state } = withSecret();
    state.relationships[relKey(S, L)] = { ...defaultEdge(S, L), alliance: 80, trust: 70 };
    const p = (sens: number) => tellPriority(state, S, L, sens);
    expect(p(3)).toBeGreaterThan(p(2));
    const base = p(2);
    Object.assign(state.characters[S]?.traits ?? {}, { sociability: 100 });
    expect(p(2)).toBeGreaterThan(base);
    const sociable = p(2);
    Object.assign(state.characters[S]?.traits ?? {}, { loyalty: 100 });
    expect(p(2)).toBeLessThan(sociable);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 100 }), (sens, soc) => {
        Object.assign(state.characters[S]?.traits ?? {}, { sociability: soc });
        const v = p(sens);
        return v >= 0.05 && v <= 1;
      }),
    );
  });
});

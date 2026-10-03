import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IDS, aSimState } from '@ai-reality/testkit';
import { buildAgentContext, renderAgentContext } from '../../src/knowledge/index.js';
import { defaultEdge } from '../../src/state/apply-effect.js';
import { relKey, type FactNode, type Id, type KnowledgeEdge, type SimState } from '../../src/state/types.js';
import { runChain } from '../helpers/chain-scenario.js';

const { alexandre: A, sarah: S, lea: L, thomas: T } = IDS.characters;
const situation = { locationId: IDS.locations.salon, sceneMemberIds: [A, S, L, T], previousTurns: [] };

describe('constructeur de contexte d’agent', () => {
  it('ne montre que les faits connus, avec confiance et provenance résumée', () => {
    const { state, fact } = runChain();
    const secret = state.facts[IDS.facts.sarahSecret];
    expect(secret).toBeDefined();
    const ctx = buildAgentContext(state, T, situation);
    expect(ctx.knowledge.map((k) => k.factId)).toEqual([fact.id]);
    expect(ctx.knowledge[0]).toMatchObject({ provenance: { source: 'told', toldByName: 'Léa' }, belief: 'believes' });
    expect(ctx.knowledge[0]?.confidence).toBeCloseTo(0.85 * 0.65, 10);
    const text = renderAgentContext(ctx);
    expect(text).toContain(fact.id);
    expect(text).not.toContain(IDS.facts.sarahSecret);
    expect(text).not.toContain('autre émission');
    // Le secret de Sarah est connu d'elle seule.
    expect(renderAgentContext(buildAgentContext(state, S, situation))).toContain('autre émission');
  });

  it('les relations sont les arêtes sortantes du personnage, pas celles des autres envers lui', () => {
    const state = aSimState((s) => {
      s.relationships[relKey(S, A)] = { ...defaultEdge(S, A), trust: 11, labels: ['mon-ressenti'] };
      s.relationships[relKey(A, S)] = { ...defaultEdge(A, S), trust: 99, labels: ['ressenti-dautrui'] };
    });
    const ctx = buildAgentContext(state, S, situation);
    expect(ctx.relationships.map((r) => [r.targetId, r.axes.trust])).toContainEqual([A, 11]);
    const text = renderAgentContext(ctx);
    expect(text).toContain('mon-ressenti');
    expect(text).not.toContain('ressenti-dautrui');
  });

  it('rend en français la situation, sans soi-même parmi les présents', () => {
    const { state } = runChain();
    const text = renderAgentContext(
      buildAgentContext(state, S, { ...situation, previousTurns: [{ speakerId: A, text: 'Salut Sarah.' }] }),
    );
    expect(text).toContain('Vous êtes Sarah');
    expect(text).toContain('Lieu : Salon.');
    expect(text).toContain('Présents : Alexandre, Léa, Thomas.');
    expect(text).toContain('Alexandre : Salut Sarah.');
    expect(text).toContain('Ce que vous savez (et rien de plus)');
  });
});

// ───── Étanchéité : propriété sur des états aléatoires ─────

const pad = (n: number): string => String(n).padStart(4, '0');
const factId = (i: number): Id => `fact-${pad(i)}-end`;

interface World {
  readonly state: SimState;
}

const worldArb: fc.Arbitrary<World> = fc
  .record({
    nChars: fc.integer({ min: 2, max: 5 }),
    nFacts: fc.integer({ min: 0, max: 8 }),
    seed: fc.integer(),
  })
  .chain(({ nChars, nFacts }) =>
    fc.record({
      known: fc.array(
        fc.tuple(fc.nat(nChars - 1), fc.nat(Math.max(0, nFacts - 1)), fc.double({ min: 0, max: 1, noNaN: true })),
        {
          maxLength: 20,
        },
      ),
      rels: fc.array(fc.tuple(fc.nat(nChars - 1), fc.nat(nChars - 1), fc.integer({ min: 0, max: 100 })), {
        maxLength: 15,
      }),
      tells: fc.array(fc.tuple(fc.nat(nChars - 1), fc.nat(nFacts + 2)), { maxLength: 6 }),
      nChars: fc.constant(nChars),
      nFacts: fc.constant(nFacts),
    }),
  )
  .map(({ known, rels, tells, nChars, nFacts }) => {
    const state = aSimState();
    const ids = Array.from({ length: nChars }, (_, i) => `perso-${pad(i)}`);
    state.characters = {};
    for (const [i, id] of ids.entries()) {
      const base = Object.values(aSimState().characters)[0];
      if (!base) throw new Error('fixture vide');
      state.characters[id] = {
        ...structuredClone(base),
        id,
        slug: `p${pad(i)}`,
        firstName: `Perso${pad(i)}`,
        agenda: [],
        goals: [],
      };
    }
    state.relationships = {};
    state.facts = {};
    state.knowledge = {};
    for (let i = 0; i < nFacts; i++) {
      const fact: FactNode = {
        id: factId(i),
        subjectId: ids[i % nChars] ?? null,
        predicate: `prédicat-${pad(i)}-fin`,
        objectId: ids[(i + 1) % nChars] ?? null,
        objectText: `texte-secret-${pad(i)}-fin`,
        isTrue: i % 2 === 0,
        sensitivity: i % 4,
        originEventId: null,
        inventedById: null,
      };
      state.facts[fact.id] = fact;
    }
    known.forEach(([c, f, conf], n) => {
      const edge: KnowledgeEdge = {
        id: `knowledge-${pad(n)}`,
        characterId: ids[c] ?? '',
        factId: factId(f),
        sourceType: 'told',
        toldById: ids[(c + 1) % nChars] ?? null,
        viaEventId: null,
        parentKnowledgeId: null,
        learnedEpoch: 0,
        learnedTick: n,
        confidence: conf,
        belief: 'believes',
      };
      if (state.facts[edge.factId]) state.knowledge[edge.id] = edge;
    });
    for (const [a, b, trust] of rels) {
      const s = ids[a];
      const t = ids[b];
      if (s && t && s !== t) state.relationships[relKey(s, t)] = { ...defaultEdge(s, t), trust };
    }
    // Intentions qui citent parfois un fait que le personnage ne connaît pas (voire inexistant).
    for (const [c, f] of tells) {
      state.characters[ids[c] ?? '']?.agenda.push({
        kind: 'tell',
        targetId: ids[(c + 1) % nChars] ?? null,
        goal: null,
        factId: factId(f),
        locationId: null,
        priority: 0.5,
      });
    }
    return { state };
  });

describe('étanchéité du contexte (propriété)', () => {
  it('aucun identifiant ni texte de fait absent des connaissances du personnage ne fuit', () => {
    fc.assert(
      fc.property(worldArb, ({ state }) => {
        for (const characterId of Object.keys(state.characters)) {
          const knownIds = new Set(
            Object.values(state.knowledge)
              .filter((k) => k.characterId === characterId)
              .map((k) => k.factId),
          );
          const ctx = buildAgentContext(state, characterId, {
            locationId: null,
            sceneMemberIds: Object.keys(state.characters),
            previousTurns: [],
          });
          const haystacks = [JSON.stringify(ctx), renderAgentContext(ctx)];
          for (let i = 0; i < 12; i++) {
            const fact = state.facts[factId(i)];
            const leaks = (needle: string) => haystacks.some((h) => h.includes(needle));
            if (fact && knownIds.has(fact.id)) {
              expect(leaks(fact.id)).toBe(true);
              continue;
            }
            expect(leaks(factId(i))).toBe(false);
            expect(leaks(`prédicat-${pad(i)}-fin`)).toBe(false);
            expect(leaks(`texte-secret-${pad(i)}-fin`)).toBe(false);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

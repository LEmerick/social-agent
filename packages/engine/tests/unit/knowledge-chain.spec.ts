import { describe, expect, it } from 'vitest';
import { IDS, aWorld, seedWorld } from '@ai-reality/testkit';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { provenance } from '../../src/knowledge/index.js';
import { runChain } from '../helpers/chain-scenario.js';

const { alexandre, sarah, lea, thomas } = IDS.characters;

describe('scénario chain (Palmiers)', () => {
  it('provenance(Thomas, F1) donne la chaîne de l’origine à Thomas, dans l’ordre', () => {
    const { state, fact } = runChain();
    const chain = provenance(state, thomas, fact.id);
    expect(chain.map((k) => [k.characterId, k.sourceType, k.toldById])).toEqual([
      [sarah, 'witnessed', null],
      [lea, 'told', sarah],
      [thomas, 'told', lea],
    ]);
    // Les témoins directs ont chacun leur chaîne à un maillon.
    expect(provenance(state, alexandre, fact.id).map((k) => k.characterId)).toEqual([alexandre]);
    expect(chain[1]?.confidence).toBeCloseTo(0.85, 10); // trust(Léa→Sarah) = 70
    expect(chain[2]?.confidence).toBeCloseTo(0.85 * 0.65, 10); // trust(Thomas→Léa) = 30 (défaut)
  });

  it('Sarah forme une intention différée de raconter à Léa', () => {
    const { state, fact, agendaOfSarah } = runChain();
    expect(agendaOfSarah).toEqual([expect.objectContaining({ kind: 'tell', targetId: lea, factId: fact.id })]);
    expect(agendaOfSarah[0]?.priority).toBeGreaterThan(0.5);
    // Léa, Thomas et Alexandre (sujet) n'ont pas d'allié valable à qui raconter.
    expect(state.characters[alexandre]?.agenda).toEqual([]);
    expect(state.characters[thomas]?.agenda).toEqual([]);
  });

  it('persisté via knowledge.insert (storage-memory), la provenance relue est identique', async () => {
    const { fact, edges, state } = runChain();
    const storage = createMemoryStorage();
    const fx = await seedWorld(storage, aWorld().build());
    await storage.tx(async (s) => {
      await s.facts.insert(fx.world.id, [fact]);
      await s.knowledge.insert(edges);
    });
    const stored = await storage.tx((s) => s.knowledge.provenance(thomas, fact.id));
    expect(stored).toEqual(provenance(state, thomas, fact.id));
  });
});

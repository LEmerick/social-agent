import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { countingStorage, playScriptedEpoch, seeded12 } from '../helpers/bench-kit.js';

describe('performance : époque scriptée de 12 personnages (storage-memory)', () => {
  it('tient en moins de 2 s et ne consomme qu’un nombre borné de requêtes par tick', async () => {
    const memory = createMemoryStorage();
    const fixture = await seeded12(memory);
    const { storage, counts, reset } = countingStorage(memory);
    reset();

    const start = performance.now();
    const result = await playScriptedEpoch(storage, fixture);
    const elapsed = performance.now() - start;

    expect(fixture.characters.length).toBe(12);
    // Le meilleur de trois essais : une machine chargée ne doit pas faire échouer une borne de performance.
    const best = [elapsed];
    for (let i = 0; i < 2 && Math.min(...best) >= 2000; i++) {
      const again = createMemoryStorage();
      const f = await seeded12(again, `bench-retry-${String(i)}`);
      const t = performance.now();
      await playScriptedEpoch(again, f);
      best.push(performance.now() - t);
    }
    expect(Math.min(...best)).toBeLessThan(2000);

    // Dépôts touchés pendant l'époque : le chargement initial, un commit par tick, la clôture. Pas un appel par personnage.
    const perTick = counts.calls / (result.ticksPerEpoch + 1);
    expect(counts.tx / (result.ticksPerEpoch + 1)).toBeLessThanOrEqual(1.5);
    expect(perTick).toBeLessThan(10);
    // Plus aucun chargement des events du monde pour numéroter les events.
    expect(counts.byMethod['journal.eventsOfWorld'] ?? 0).toBe(0);
    expect(counts.byMethod['journal.maxSeq']).toBe(1);
  });
});

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
    expect(elapsed).toBeLessThan(2000);

    // Dépôts touchés pendant l'époque : le chargement initial, un commit par tick, la clôture. Pas un appel par personnage.
    const perTick = counts.calls / (result.ticksPerEpoch + 1);
    expect(counts.tx / (result.ticksPerEpoch + 1)).toBeLessThanOrEqual(1.5);
    expect(perTick).toBeLessThan(10);
    // Plus aucun chargement des events du monde pour numéroter les events.
    expect(counts.byMethod['journal.eventsOfWorld'] ?? 0).toBe(0);
    expect(counts.byMethod['journal.maxSeq']).toBe(1);
  });
});

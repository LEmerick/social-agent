import fc from 'fast-check';
import { describe, it } from 'vitest';
import { HeuristicOutcomeModel } from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { UniformRandomPolicy, adventureWorld, seedWorld } from '@ai-reality/testkit';
import { expectInventoryReplayed, expectPresenceCovers } from '../helpers/format-invariants.js';
import { formatScheduler, runNumber } from '../helpers/format-run-kit.js';

describe('formats dans l’époque : propriétés', () => {
  it('sur des époques aléatoires, l’inventaire projeté égale l’inventaire rejoué ; aucun objet ne disparaît ni ne se duplique', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.double({ min: 0.05, max: 0.6, noNaN: true }),
        async (seed, moveProbability) => {
          const storage = createMemoryStorage();
          const fixture = await seedWorld(storage, adventureWorld({ seed, characters: 8 }));
          for (let number = 0; number < 2; number += 1) {
            await formatScheduler(storage, new UniformRandomPolicy({ moveProbability }), {
              outcome: new HeuristicOutcomeModel(),
              seasonEpochs: 3,
            }).run(runNumber(fixture, number)).done;
            // Après chaque époque, pas seulement à la fin.
            await expectInventoryReplayed(storage, fixture);
          }
          await expectPresenceCovers(storage, fixture, [0, 1]);
        },
      ),
      { numRuns: 6 },
    );
  }, 120_000);
});

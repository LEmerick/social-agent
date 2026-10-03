import { createMemoryStorage } from '@ai-reality/storage-memory';
import { memoryNarrativeStorage } from '../src/index.js';
import { chainEpisodeSuite } from './helpers/chain-episode.js';

chainEpisodeSuite('storage-memory', () => {
  const sim = createMemoryStorage();
  const narrative = memoryNarrativeStorage(sim);
  return Promise.resolve({
    sim,
    narrative,
    reset: () => {
      sim.reset();
      narrative.reset();
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  });
});

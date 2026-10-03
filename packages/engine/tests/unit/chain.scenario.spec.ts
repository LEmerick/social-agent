import { createMemoryStorage } from '@ai-reality/storage-memory';
import { chainScenarioSuite } from '../helpers/chain-suite.js';

chainScenarioSuite('storage-memory', () => {
  const storage = createMemoryStorage();
  return Promise.resolve({
    storage,
    reset: () => {
      storage.reset();
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  });
});

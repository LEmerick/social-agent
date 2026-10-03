import { createMemoryStorage } from '@ai-reality/storage-memory';
import { formatSeasonSuite } from '../helpers/format-season-suite.js';

formatSeasonSuite('storage-memory', () => {
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

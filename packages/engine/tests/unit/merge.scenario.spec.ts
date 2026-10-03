import { createMemoryStorage } from '@ai-reality/storage-memory';
import { mergeSuite } from '../helpers/merge-suite.js';

mergeSuite('storage-memory', () => {
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

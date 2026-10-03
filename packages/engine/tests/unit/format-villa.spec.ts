import { createMemoryStorage } from '@ai-reality/storage-memory';
import { villaSuite } from '../helpers/villa-suite.js';

villaSuite('storage-memory', () => {
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

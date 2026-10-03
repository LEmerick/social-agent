import { createMemoryStorage } from '@ai-reality/storage-memory';
import { necklaceSuite } from '../helpers/necklace-suite.js';

necklaceSuite('storage-memory', () => {
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

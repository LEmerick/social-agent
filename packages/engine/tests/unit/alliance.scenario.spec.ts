import { createMemoryStorage } from '@ai-reality/storage-memory';
import { allianceSuite } from '../helpers/alliance-suite.js';

allianceSuite('storage-memory', () => {
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

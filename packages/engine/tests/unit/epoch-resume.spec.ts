import { createMemoryStorage } from '@ai-reality/storage-memory';
import { resumeSuite } from '../helpers/resume-suite.js';

resumeSuite('storage-memory', () => {
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

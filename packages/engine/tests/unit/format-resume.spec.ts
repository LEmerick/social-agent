import { createMemoryStorage } from '@ai-reality/storage-memory';
import { formatResumeSuite } from '../helpers/format-resume-suite.js';

formatResumeSuite('storage-memory', () => {
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

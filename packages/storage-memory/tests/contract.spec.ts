import { createMemoryStorage } from '../src/index.js';
import { storageContract } from '@ai-reality/testkit';

storageContract('storage-memory', async () => {
  const storage = createMemoryStorage();
  return {
    storage,
    reset: async () => storage.reset(),
    close: async () => undefined,
  };
});

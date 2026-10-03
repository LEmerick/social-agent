import { createMemoryStorage } from '../src/index.js';
import { storageContract, worldRoundTripContract } from '@ai-reality/testkit';

const factory = async () => {
  const storage = createMemoryStorage();
  return {
    storage,
    reset: async () => storage.reset(),
    close: async () => undefined,
  };
};

storageContract('storage-memory', factory);
worldRoundTripContract('storage-memory', factory);

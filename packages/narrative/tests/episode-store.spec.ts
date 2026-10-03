import { memoryEpisodeStore } from '../src/index.js';
import { episodeStoreContract } from './helpers/store-contract.js';

episodeStoreContract('mémoire', () => {
  const store = memoryEpisodeStore();
  return Promise.resolve({ store, reset: () => Promise.resolve(store.reset()) });
});

import { createMemoryStorage } from '@ai-reality/storage-memory';
import { replaySeasonSuite } from '../helpers/replay-season-suite.js';

replaySeasonSuite('storage-memory', () =>
  Promise.resolve({ storage: createMemoryStorage(), reset: () => Promise.resolve() }),
);

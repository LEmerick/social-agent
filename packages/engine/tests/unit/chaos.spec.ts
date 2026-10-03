import { createMemoryStorage } from '@ai-reality/storage-memory';
import { chaosSuite } from '../helpers/chaos-suite.js';

chaosSuite('storage-memory', () => Promise.resolve({ storage: createMemoryStorage(), reset: () => Promise.resolve() }));

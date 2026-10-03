import { type StoragePort, type StorageTx } from '@ai-reality/engine';
import { type Db, cloneDb, emptyDb } from './db.js';
import { formatRepos } from './repos-formats.js';
import { llmRepos } from './repos-llm.js';
import { memoryRepos } from './repos-memory.js';
import { refRepos } from './repos-ref.js';
import { simRepos } from './repos-sim.js';

/**
 * Adaptateur en mémoire. Les transactions sont sérialisées (une à la fois) et atomiques :
 * si `fn` lève une exception, l'état précédent est restauré.
 */
export function createMemoryStorage(): StoragePort & { reset(): void } {
  let committed: Db = emptyDb();
  let queue: Promise<unknown> = Promise.resolve();

  return {
    reset() {
      committed = emptyDb();
    },

    tx<T>(fn: (s: StorageTx) => Promise<T>): Promise<T> {
      const run = async (): Promise<T> => {
        const working = cloneDb(committed);
        const result = await fn({
          ...refRepos(working),
          ...simRepos(working),
          ...llmRepos(working),
          ...memoryRepos(working),
          ...formatRepos(working),
        });
        committed = working;
        return result;
      };

      // Sérialisation : chaque transaction attend la précédente, même si elle échoue.
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next;
    },
  };
}

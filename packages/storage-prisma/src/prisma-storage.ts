import type { PrismaClient } from '@prisma/client';
import type { StoragePort } from '@ai-reality/engine';
import { formatRepos } from './repos-formats.js';
import { visualRepos } from './repos-visuals.js';
import { llmRepos } from './repos-llm.js';
import { memoryRepos } from './repos-memory.js';
import { refRepos } from './repos-ref.js';
import { simRepos } from './repos-sim.js';

/**
 * Adaptateur StoragePort sur Prisma. Le `PrismaClient` est fourni par l'application ;
 * cette fonction ne crée aucune connexion. Une transaction du port = une transaction SQL.
 */
export function prismaStorage(prisma: PrismaClient): StoragePort {
  return {
    tx: (fn) =>
      prisma.$transaction(
        (db) =>
          fn({
            ...refRepos(db),
            ...simRepos(db),
            ...llmRepos(db),
            ...memoryRepos(db),
            ...formatRepos(db),
            ...visualRepos(db),
          }),
        {
          maxWait: 10_000,
          timeout: 60_000,
        },
      ),
  };
}

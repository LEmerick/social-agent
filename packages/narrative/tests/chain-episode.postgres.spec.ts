import { PrismaClient } from '@prisma/client';
import { afterAll } from 'vitest';
import { prismaStorage } from '@ai-reality/storage-prisma';
import { simulationReader, sqlEpisodeStore } from '../src/index.js';
import { chainEpisodeSuite } from './helpers/chain-episode.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ai_reality:ai_reality_dev@localhost:5434/ai_reality_test';
const databaseName = new URL(url).pathname.replace(/^\//, '');
if (!databaseName.endsWith('_test')) {
  throw new Error(`Refus de lancer les tests sur « ${databaseName} » : le nom doit finir par _test.`);
}
const prisma = new PrismaClient({ datasourceUrl: url });
const sim = prismaStorage(prisma);

afterAll(async () => {
  await prisma.$disconnect();
});

chainEpisodeSuite('storage-prisma', () =>
  Promise.resolve({
    sim,
    narrative: { sim: simulationReader(sim), episodes: sqlEpisodeStore(prisma) },
    reset: async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "world", "llm_call", "episode_line", "episode_scene", "episode_arc", "episode", "narrative_arc" CASCADE',
      );
    },
    close: () => Promise.resolve(),
  }),
);

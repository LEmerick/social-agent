import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { IDS, aWorld, seedWorld } from '@ai-reality/testkit';
import { prismaStorage } from '@ai-reality/storage-prisma';
import { provenance } from '../../src/knowledge/index.js';
import { runChain } from '../helpers/chain-scenario.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ai_reality:ai_reality_dev@localhost:5434/ai_reality_test';
const databaseName = new URL(url).pathname.replace(/^\//, '');
if (!/_test(_[a-z0-9]+)?$/.test(databaseName)) {
  throw new Error(
    `Refus de lancer les tests sur « ${databaseName} » : le nom doit finir par _test ou _test_<suffixe>.`,
  );
}

type PrismaClientLike = Parameters<typeof prismaStorage>[0];
const requireFromAdapter = createRequire(
  fileURLToPath(new URL('../../../storage-prisma/package.json', import.meta.url)),
);
const { PrismaClient } = requireFromAdapter('@prisma/client') as {
  PrismaClient: new (options: { datasourceUrl: string }) => PrismaClientLike & {
    $executeRawUnsafe(sql: string): Promise<unknown>;
    $disconnect(): Promise<void>;
  };
};
const prisma = new PrismaClient({ datasourceUrl: url });

describe('scénario chain persisté (storage-prisma)', () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "world", "llm_call" CASCADE');
  });

  it('knowledge.provenance relit la même chaîne que le moteur', async () => {
    const { fact, edges, state } = runChain();
    const storage = prismaStorage(prisma);
    const fx = await seedWorld(storage, aWorld().build());
    await storage.tx(async (s) => {
      await s.facts.insert(fx.world.id, [fact]);
      await s.knowledge.insert(edges);
    });
    const stored = await storage.tx((s) => s.knowledge.provenance(IDS.characters.thomas, fact.id));
    expect(stored).toEqual(provenance(state, IDS.characters.thomas, fact.id));
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

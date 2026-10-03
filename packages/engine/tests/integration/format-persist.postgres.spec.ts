import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { prismaStorage } from '@ai-reality/storage-prisma';
import { formatPersistenceSuite } from '../helpers/format-persist-suite.js';

// Même garde-fou que les autres tests Postgres : jamais une base qui ne soit pas dédiée aux tests.
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ai_reality:ai_reality_dev@localhost:5434/ai_reality_test';
const databaseName = new URL(url).pathname.replace(/^\//, '');
if (!/_test(_[a-z0-9]+)?$/.test(databaseName)) {
  throw new Error(
    `Refus de lancer les tests sur « ${databaseName} » : le nom doit finir par _test ou _test_<suffixe>.`,
  );
}

// `@prisma/client` n'est pas une dépendance du moteur : on le charge depuis le paquet storage-prisma.
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

formatPersistenceSuite('storage-prisma', () =>
  Promise.resolve({
    storage: prismaStorage(prisma),
    reset: async () => {
      await prisma.$executeRawUnsafe('TRUNCATE TABLE "world", "llm_call" CASCADE');
    },
    close: () => Promise.resolve(),
  }),
);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('garde-fou base de test', () => {
  it('la base utilisée est dédiée aux tests', () => {
    expect(/_test(_[a-z0-9]+)?$/.test(databaseName)).toBe(true);
  });
});

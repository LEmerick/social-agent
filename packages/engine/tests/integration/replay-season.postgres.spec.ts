import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { prismaStorage } from '@ai-reality/storage-prisma';
import { replaySeason } from '../../src/index.js';
import { replaySeasonSuite } from '../helpers/replay-season-suite.js';
import { playSeason } from '../helpers/season-kit.js';

// Même garde-fou que les tests de storage-prisma : jamais une base qui ne soit pas dédiée aux tests.
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
const storage = prismaStorage(prisma);
const reset = async (): Promise<void> => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "world", "llm_call" CASCADE');
};

replaySeasonSuite('storage-prisma', () => Promise.resolve({ storage, reset }));

describe('rejeu : mêmes graines, mêmes hachages sur les deux adaptateurs', () => {
  it('l’état rejoué depuis le journal est identique sur storage-memory et storage-prisma', async () => {
    await reset();
    const onMemory = createMemoryStorage();
    const memory = await playSeason(onMemory, 5, 'rejeu-croise');
    const pg = await playSeason(storage, 5, 'rejeu-croise');
    const a = await replaySeason(onMemory, memory.worldId, memory.seasonNumber);
    const b = await replaySeason(storage, pg.worldId, pg.seasonNumber);
    expect(a.diffs).toEqual([]);
    expect(b.diffs).toEqual([]);
    expect(b.stateHash).toBe(a.stateHash);
    expect(b.journalHash).toBe(a.journalHash);
  }, 180_000);
});

afterAll(async () => {
  await prisma.$disconnect();
});

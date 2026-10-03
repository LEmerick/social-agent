import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { storageContract, worldRoundTripContract } from '@ai-reality/testkit';
import { prismaStorage } from '../src/index.js';

// Base de test dédiée. Les tests la vident entre chaque cas : refus explicite de toute autre base.
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ai_reality:ai_reality_dev@localhost:5434/ai_reality_test';
const databaseName = new URL(url).pathname.replace(/^\//, '');
if (!databaseName.endsWith('_test')) {
  throw new Error(`Refus de lancer les tests sur « ${databaseName} » : le nom doit finir par _test.`);
}

const prisma = new PrismaClient({ datasourceUrl: url });

const factory = async () => ({
  storage: prismaStorage(prisma),
  // TRUNCATE ... CASCADE suit les clés étrangères : tout ce qui dépend d'un monde disparaît.
  reset: async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "world", "llm_call" CASCADE');
  },
  close: async () => undefined,
});

storageContract('storage-prisma', factory);
worldRoundTripContract('storage-prisma', factory);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('garde-fou base de test', () => {
  it('la base utilisée se termine par _test', () => {
    expect(databaseName.endsWith('_test')).toBe(true);
  });
});

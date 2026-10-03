import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { storageContract } from '@ai-reality/testkit';
import { prismaStorage } from '../src/index.js';

// Base de test dédiée. Les tests la vident entre chaque cas : refus explicite de toute autre base.
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ai_reality:ai_reality_dev@localhost:5434/ai_reality_test';
const databaseName = new URL(url).pathname.replace(/^\//, '');
if (!databaseName.endsWith('_test')) {
  throw new Error(`Refus de lancer les tests sur « ${databaseName} » : le nom doit finir par _test.`);
}

const prisma = new PrismaClient({ datasourceUrl: url });

storageContract('storage-prisma', async () => ({
  storage: prismaStorage(prisma),
  reset: async () => {
    // Ordre imposé par les clés étrangères.
    await prisma.characterTrait.deleteMany();
    await prisma.character.deleteMany();
    await prisma.location.deleteMany();
    await prisma.world.deleteMany();
  },
  close: async () => undefined,
}));

afterAll(async () => {
  await prisma.$disconnect();
});

describe('garde-fou base de test', () => {
  it('la base utilisée se termine par _test', () => {
    expect(databaseName.endsWith('_test')).toBe(true);
  });
});

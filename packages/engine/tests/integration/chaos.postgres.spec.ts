import { afterAll } from 'vitest';
import { chaosSuite } from '../helpers/chaos-suite.js';
import { prisma, prismaHarness } from '../helpers/postgres-kit.js';

chaosSuite('storage-prisma', prismaHarness);

afterAll(async () => {
  await prisma.$disconnect();
});

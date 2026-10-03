import { afterAll, describe, expect, it } from 'vitest';
import { formatResumeSuite } from '../helpers/format-resume-suite.js';
import { formatSeasonSuite } from '../helpers/format-season-suite.js';
import { mergeSuite } from '../helpers/merge-suite.js';
import { necklaceSuite } from '../helpers/necklace-suite.js';
import { databaseName, prisma, prismaHarness } from '../helpers/postgres-kit.js';
import { villaSuite } from '../helpers/villa-suite.js';

necklaceSuite('storage-prisma', prismaHarness);
mergeSuite('storage-prisma', prismaHarness);
villaSuite('storage-prisma', prismaHarness);
formatSeasonSuite('storage-prisma', prismaHarness);
formatResumeSuite('storage-prisma', prismaHarness);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('garde-fou base de test', () => {
  it('la base utilisée est dédiée aux tests', () => {
    expect(/_test(_[a-z0-9]+)?$/.test(databaseName)).toBe(true);
  });
});

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaStorage } from '@ai-reality/storage-prisma';
import { aWorld, seedWorld } from '@ai-reality/testkit';
import { cli, cliJson } from './helpers.js';

// Même garde-fou que les tests de storage-prisma : jamais une base qui ne soit pas dédiée aux tests.
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ai_reality:ai_reality_dev@localhost:5434/ai_reality_test';
const databaseName = new URL(url).pathname.replace(/^\//, '');
if (!/_test(_[a-z0-9]+)?$/.test(databaseName)) {
  throw new Error(
    `Refus de lancer les tests sur « ${databaseName} » : le nom doit finir par _test ou _test_<suffixe>.`,
  );
}

const prisma = new PrismaClient({ datasourceUrl: url });

beforeAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "world", "llm_call" CASCADE');
  await seedWorld(prismaStorage(prisma), aWorld().withSeed('cli-pg').build());
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('CLI ai-reality sur Postgres (--db / DATABASE_URL)', () => {
  it('run-epoch, replay, inspect puis doctor détecte une corruption introduite en base', async () => {
    const db = ['--db', url, '--world', 'palmiers'];
    for (const epoch of ['0', '1']) {
      const played = await cli(['run-epoch', ...db, '--epoch', epoch]);
      expect(played.err).toBe('');
      expect(played.code).toBe(0);
    }
    // Une époque terminée ne se rejoue pas ; la variable d’environnement remplace --db.
    const again = await cli(['run-epoch', '--epoch', '1'], { DATABASE_URL: url });
    expect(again.code).toBe(2);
    expect(again.err).toContain('déjà terminée');

    const replay = await cliJson<{ ok: boolean; epochs: number }>(['replay', ...db]);
    expect(replay.code).toBe(0);
    expect(replay.data).toMatchObject({ ok: true, epochs: 2 });
    expect((await cli(['doctor'], { DATABASE_URL: url })).code).toBe(0);

    const thomas = await cli(['inspect', 'character', 'thomas', '--epoch', '1', ...db]);
    expect(thomas.code).toBe(0);
    expect(thomas.out).toContain('fin de l’époque 1');

    // Corruption : un effet de relation disparaît de la base.
    const deleted = await prisma.$executeRawUnsafe(
      `DELETE FROM "effect" WHERE id = (SELECT id FROM "effect" WHERE target_kind = 'relationship' ORDER BY ord DESC LIMIT 1)`,
    );
    expect(deleted).toBe(1);

    const broken = await cli(['replay', ...db]);
    expect(broken.code).toBe(1);
    expect(broken.out).toContain('ÉCART');
    const audit = await cliJson<{ ok: boolean; issues: { kind: string }[] }>(['doctor', ...db]);
    expect(audit.code).toBe(1);
    expect(audit.data.ok).toBe(false);
    expect(audit.data.issues.length).toBeGreaterThan(0);
  }, 180_000);

  it('monde inconnu ou base absente : code 2', async () => {
    expect((await cli(['replay', '--db', url, '--world', 'inconnu'])).err).toContain('introuvable');
    expect((await cli(['replay'])).err).toContain('Aucune base');
  }, 30_000);
});

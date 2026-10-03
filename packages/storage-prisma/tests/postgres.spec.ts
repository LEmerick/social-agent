import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultEdge, emptyTickBatch } from '@ai-reality/engine';
import { IDS, aWorld, fixedId, seedWorld } from '@ai-reality/testkit';
import { prismaStorage } from '../src/index.js';

// Intégration Postgres : contraintes SQL, droits du rôle applicatif, absence de dérive des migrations.
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ai_reality:ai_reality_dev@localhost:5434/ai_reality_test';
const databaseName = new URL(url).pathname.replace(/^\//, '');
if (!databaseName.endsWith('_test')) {
  throw new Error(`Refus de lancer les tests sur « ${databaseName} » : le nom doit finir par _test.`);
}

const prisma = new PrismaClient({ datasourceUrl: url });
const storage = prismaStorage(prisma);
const packageDir = fileURLToPath(new URL('..', import.meta.url));
const C = IDS.characters;
const EPOCH = fixedId(0, 3);

const presence = (id: string, tickStart: number, tickEnd: number | null) => ({
  id,
  epochId: EPOCH,
  characterId: C.alexandre,
  tickStart,
  tickEnd,
  kind: 'offstage' as const,
  sceneId: null,
  fromLocationId: null,
  toLocationId: null,
  offstageReason: 'test',
  role: null,
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "world", "llm_call" CASCADE');
  await seedWorld(storage, aWorld().build());
  await storage.tx((s) =>
    s.epochs.insert({
      id: EPOCH,
      worldId: IDS.world,
      seasonId: IDS.season,
      number: 0,
      status: 'running',
      rngSeed: 'x',
      rulesVersion: 1,
      lastCommittedTick: -1,
    }),
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('contraintes Postgres', () => {
  it('deux segments de présence qui se chevauchent pour un même personnage sont rejetés', async () => {
    const batch = {
      ...emptyTickBatch(EPOCH, 0),
      presencesOpened: [presence(fixedId(0x72, 1), 0, 5), presence(fixedId(0x72, 2), 3, null)],
    };
    await expect(storage.tx((s) => s.journal.commitTick(batch))).rejects.toThrow(/presence_no_overlap|exclusion/i);
  });

  it('des segments contigus ou de personnages différents sont acceptés', async () => {
    const other = { ...presence(fixedId(0x72, 3), 3, null), characterId: C.sarah };
    const batch = {
      ...emptyTickBatch(EPOCH, 0),
      presencesOpened: [presence(fixedId(0x72, 1), 0, 5), presence(fixedId(0x72, 2), 5, null), other],
    };
    await storage.tx((s) => s.journal.commitTick(batch));
    expect((await storage.tx((s) => s.journal.read(EPOCH))).presences).toHaveLength(3);
  });

  it('trust = 120 est rejeté par le CHECK', async () => {
    const edge = { ...defaultEdge(C.sarah, C.alexandre), trust: 120 };
    await expect(storage.tx((s) => s.relationships.upsert(IDS.world, [edge]))).rejects.toThrow(
      /relationship_axes_range|check/i,
    );
  });

  it('une relation d’un personnage avec lui-même est rejetée', async () => {
    await expect(storage.tx((s) => s.relationships.upsert(IDS.world, [defaultEdge(C.sarah, C.sarah)]))).rejects.toThrow(
      /relationship_not_self|check/i,
    );
  });
});

describe('append-only sous le rôle applicatif', () => {
  const asApp = (sql: string) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE ai_reality_app');
      return tx.$executeRawUnsafe(sql);
    });

  beforeEach(async () => {
    await storage.tx(async (s) => {
      await s.journal.commitTick({
        ...emptyTickBatch(EPOCH, 0),
        events: [
          {
            id: fixedId(0x76, 1),
            epochId: EPOCH,
            tick: 0,
            seq: 1,
            type: 'test',
            sceneId: null,
            interactionId: null,
            locationId: null,
            payload: {},
            importance: 0.5,
            causedByEventId: null,
            participants: [],
          },
        ],
      });
    });
  });

  it('UPDATE sur event est refusé', async () => {
    await expect(asApp(`UPDATE "event" SET type = 'falsifie'`)).rejects.toThrow(/permission denied/i);
  });

  it('DELETE sur event est refusé', async () => {
    await expect(asApp(`DELETE FROM "event"`)).rejects.toThrow(/permission denied/i);
  });

  it('le rôle applicatif peut insérer dans event et modifier une projection', async () => {
    await asApp(`UPDATE "character" SET status = 'paused'`);
    await asApp(
      `INSERT INTO "event" (id, world_id, epoch_id, tick, seq, type, payload) VALUES ('${fixedId(0x76, 2)}', '${IDS.world}', '${EPOCH}', 0, 2, 'ok', '{}')`,
    );
    expect((await storage.tx((s) => s.journal.eventsOfWorld(IDS.world))).map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe('migrations', () => {
  it('migrate diff entre les migrations et le schéma ne signale que l’index HNSW (inexprimable en Prisma)', async () => {
    const shadow = `${databaseName}_shadow_${String(process.pid)}`;
    const shadowUrl = new URL(url);
    shadowUrl.pathname = `/${shadow}`;
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${shadow}"`);
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${shadow}"`);
    try {
      const script = execFileSync(
        'node_modules/.bin/prisma',
        [
          'migrate',
          'diff',
          '--from-migrations',
          'prisma/schema/migrations',
          '--to-schema-datamodel',
          'prisma/schema',
          '--shadow-database-url',
          shadowUrl.toString(),
          '--script',
        ],
        { cwd: packageDir, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url } },
      );
      const statements = script
        .split('\n')
        .filter((l) => l.trim() !== '' && !l.startsWith('--'))
        .map((l) => l.trim());
      // Seule dérive acceptée : l'index HNSW (pgvector), créé par la migration `constraints`.
      expect(statements).toEqual(['DROP INDEX "memory_embedding_hnsw";']);
    } finally {
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${shadow}"`);
    }
  }, 60_000);
});

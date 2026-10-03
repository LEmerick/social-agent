import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { IDS, fixedId } from '@ai-reality/testkit';
import { sqlEpisodeStore } from '../src/index.js';
import { anArc, anEpisode, episodeStoreContract } from './helpers/store-contract.js';

// Intégration Postgres : tables episode_*, droits du rôle `ai_reality_narrative`.
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ai_reality:ai_reality_dev@localhost:5434/ai_reality_test';
const databaseName = new URL(url).pathname.replace(/^\//, '');
if (!databaseName.endsWith('_test')) {
  throw new Error(`Refus de lancer les tests sur « ${databaseName} » : le nom doit finir par _test.`);
}
const prisma = new PrismaClient({ datasourceUrl: url });

afterAll(async () => {
  await prisma.$disconnect();
});

episodeStoreContract('PostgreSQL', () =>
  Promise.resolve({
    store: sqlEpisodeStore(prisma),
    reset: async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "episode_line", "episode_scene", "episode_arc", "episode", "narrative_arc"',
      );
    },
  }),
);

describe('lecture seule sur la simulation (rôle ai_reality_narrative)', () => {
  const asNarrative = <T>(
    run: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
  ): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE ai_reality_narrative');
      return run(tx);
    });

  it('peut lire la simulation', async () => {
    await expect(asNarrative((tx) => tx.$queryRawUnsafe('SELECT count(*) FROM "event"'))).resolves.toBeDefined();
    await expect(asNarrative((tx) => tx.$queryRawUnsafe('SELECT count(*) FROM "relationship"'))).resolves.toBeDefined();
  });

  it('refuse toute écriture dans event', async () => {
    const insert = `INSERT INTO "event" (id, world_id, epoch_id, tick, seq, type, payload) VALUES ('${fixedId(0x76, 1)}', '${IDS.world}', '${IDS.epoch}', 0, 1, 'x', '{}')`;
    await expect(asNarrative((tx) => tx.$executeRawUnsafe(insert))).rejects.toThrow(/permission denied/i);
    await expect(asNarrative((tx) => tx.$executeRawUnsafe(`UPDATE "event" SET importance = 1`))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(asNarrative((tx) => tx.$executeRawUnsafe(`DELETE FROM "event"`))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('refuse toute écriture dans relationship, character et epoch', async () => {
    await expect(asNarrative((tx) => tx.$executeRawUnsafe(`UPDATE "relationship" SET trust = 0`))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(asNarrative((tx) => tx.$executeRawUnsafe(`DELETE FROM "relationship"`))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(asNarrative((tx) => tx.$executeRawUnsafe(`UPDATE "character" SET status = 'paused'`))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(asNarrative((tx) => tx.$executeRawUnsafe(`UPDATE "epoch" SET status = 'failed'`))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('accepte l’écriture d’un épisode, de ses scènes et de ses arcs, mais pas leur suppression', async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "episode_line", "episode_scene", "episode_arc", "episode", "narrative_arc"',
    );
    const episode = anEpisode();
    await asNarrative(async (tx) => {
      const store = sqlEpisodeStore(tx);
      await store.upsertArcs([anArc()]);
      await store.saveEpisode(episode);
      await store.setStatus(episode.id, 'validated', [], 125);
    });
    const [read] = await sqlEpisodeStore(prisma).episodes(IDS.world);
    expect(read).toMatchObject({ id: episode.id, status: 'validated', durationSeconds: 125 });
    await expect(asNarrative((tx) => tx.$executeRawUnsafe(`DELETE FROM "episode"`))).rejects.toThrow(
      /permission denied/i,
    );
  });
});

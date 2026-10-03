/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MEMORY_SEARCH_SQL, prismaStorage, vectorLiteral } from '@ai-reality/storage-prisma';
import { FakeEmbedding, fixedId } from '@ai-reality/testkit';
import { createMemoryService } from '../../src/memory/index.js';
import type { MemoryRecord } from '../../src/ports/storage.js';
import { C, epochId, seedEpochs } from '../helpers/memory-kit.js';

// Même garde-fou que les autres tests Postgres : jamais une base qui ne soit pas dédiée aux tests.
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ai_reality:ai_reality_dev@localhost:5434/ai_reality_test';
const databaseName = new URL(url).pathname.replace(/^\//, '');
if (!/_test(_[a-z0-9]+)?$/.test(databaseName)) {
  throw new Error(
    `Refus de lancer les tests sur « ${databaseName} » : le nom doit finir par _test ou _test_<suffixe>.`,
  );
}

type PrismaClientLike = Parameters<typeof prismaStorage>[0] & {
  $executeRawUnsafe(sql: string): Promise<unknown>;
  $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T>;
  $transaction<T>(fn: (tx: PrismaClientLike) => Promise<T>): Promise<T>;
  $disconnect(): Promise<void>;
};
const requireFromAdapter = createRequire(
  fileURLToPath(new URL('../../../storage-prisma/package.json', import.meta.url)),
);
const { PrismaClient } = requireFromAdapter('@prisma/client') as {
  PrismaClient: new (options: { datasourceUrl: string }) => PrismaClientLike;
};
const prisma = new PrismaClient({ datasourceUrl: url });
const storage = prismaStorage(prisma);
const fake = new FakeEmbedding();

const draft = (n: number, characterId: string, summary: string, about: string[] = []) => ({
  id: fixedId(0x70, n),
  characterId,
  eventId: null,
  epochId: epochId(1),
  kind: 'episodic' as const,
  summary,
  emotion: null,
  salience: 0.5,
  aboutCharacterIds: about,
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "world", "llm_call" CASCADE');
  await seedEpochs(storage, 20);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('mémoire sur Postgres + pgvector', () => {
  it('la recherche vectorielle renvoie l’ordre attendu avec des embeddings factices', async () => {
    const service = createMemoryService(storage, fake);
    await service.record(C.sarah, [
      draft(1, C.sarah, 'Alexandre m’a proposé une alliance dans le jardin', [C.alexandre]),
      draft(2, C.sarah, 'Thomas a cuisiné des pâtes pour tout le monde', [C.thomas]),
      draft(3, C.sarah, 'Alexandre a gagné le défi de la piscine', [C.alexandre]),
    ]);
    await service.record(C.thomas, [draft(4, C.thomas, 'Alexandre m’a proposé une alliance dans le jardin')]);

    const [query] = await fake.embed(['alliance proposée dans le jardin']);
    const hits = await storage.tx((s) => s.memories.search(C.sarah, query!, 3));
    expect(hits).toHaveLength(3);
    expect(hits[0]!.record.id).toBe(fixedId(0x70, 1));
    expect(hits[0]!.similarity).toBeGreaterThan(hits[1]!.similarity);
    expect(hits.every((h) => h.record.characterId === C.sarah)).toBe(true);

    // Le service bout en bout (recherche + classement + renforcement).
    const recalled = await service.recall(C.sarah, {
      text: 'alliance proposée dans le jardin',
      about: [C.alexandre],
      k: 2,
      epoch: 5,
    });
    expect(recalled[0]!.record.id).toBe(fixedId(0x70, 1));
    expect(recalled.every((r) => r.record.characterId === C.sarah)).toBe(true);
    const [stored] = (await storage.tx((s) => s.memories.listByCharacter(C.sarah))).filter(
      (m: MemoryRecord) => m.id === fixedId(0x70, 1),
    );
    expect(stored!.lastRecalledEpoch).toBe(5);
    expect(stored!.salience).toBeGreaterThan(0.5);
  });

  it('le filtre par personnage ne prive pas la recherche de résultats (parcours itératif)', async () => {
    // 200 souvenirs d'autres personnages plus proches de la requête que les 3 de Sarah.
    const service = createMemoryService(storage, fake);
    await service.record(
      C.thomas,
      Array.from({ length: 200 }, (_, i) => draft(100 + i, C.thomas, `alliance jardin proposée numéro${String(i)}`)),
    );
    await service.record(C.sarah, [
      draft(1, C.sarah, 'alliance'),
      draft(2, C.sarah, 'jardin'),
      draft(3, C.sarah, 'piscine'),
    ]);
    const [query] = await fake.embed(['alliance jardin proposée']);
    const hits = await storage.tx((s) => s.memories.search(C.sarah, query!, 3));
    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.record.characterId === C.sarah)).toBe(true);
  });

  it('l’index HNSW memory_embedding_hnsw est utilisé par la requête de recherche', async () => {
    const service = createMemoryService(storage, fake);
    await service.record(
      C.sarah,
      Array.from({ length: 60 }, (_, i) => draft(i + 1, C.sarah, `souvenir numéro${String(i)} jardin`)),
    );
    await prisma.$executeRawUnsafe('ANALYZE memory');
    const [query] = await fake.embed(['jardin']);

    const plan = await prisma.$transaction(async (tx) => {
      // Sur une table minuscule, le planificateur préfère balayer l'index (character_id, salience) puis trier :
      // on lui interdit le balayage séquentiel, le bitmap et le tri explicite, pour vérifier que la requête
      // *peut* produire son ordre par l'index vectoriel (seul chemin qui ne demande pas de tri).
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      await tx.$executeRawUnsafe('SET LOCAL enable_bitmapscan = off');
      await tx.$executeRawUnsafe('SET LOCAL enable_sort = off');
      await tx.$executeRawUnsafe(`SET LOCAL hnsw.iterative_scan = 'strict_order'`);
      const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN ${MEMORY_SEARCH_SQL}`,
        C.sarah,
        vectorLiteral(query!),
        5,
      );
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('memory_embedding_hnsw');
  });
});

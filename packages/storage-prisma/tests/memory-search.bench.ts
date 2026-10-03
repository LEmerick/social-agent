/**
 * Recherche mémoire pgvector sur un volume réaliste : 20 000 souvenirs (1024 dimensions) répartis sur 12 personnages,
 * soit ~1 700 par personnage. La requête est celle de production (`MEMORY_SEARCH_SQL`), sans aucun forçage du
 * planificateur : on regarde ce qu'il choisit (`EXPLAIN ANALYZE`), on mesure la latence du dépôt et on vérifie le
 * rappel contre un calcul exact côté client. La base utilisée est celle de `TEST_DATABASE_URL` (jamais une autre).
 */
import { PrismaClient } from '@prisma/client';
import { test } from 'vitest';
import { adventureWorld, seedWorld } from '@ai-reality/testkit';
import { prismaStorage } from '../src/index.js';
import { MEMORY_SEARCH_SQL, vectorLiteral } from '../src/repos-memory.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ai_reality:ai_reality_dev@localhost:5434/ai_reality_test';
const databaseName = new URL(url).pathname.replace(/^\//, '');
if (!/_test(_[a-z0-9]+)?$/.test(databaseName)) {
  throw new Error(
    `Refus de lancer le benchmark sur « ${databaseName} » : le nom doit finir par _test ou _test_<suffixe>.`,
  );
}

const HNSW_DDL = 'CREATE INDEX IF NOT EXISTS memory_embedding_hnsw ON memory USING hnsw (embedding vector_cosine_ops)';
const MEMORIES = 20_000;
const DIMENSIONS = 1024;
const K = 8;

const prisma = new PrismaClient({ datasourceUrl: url });
const storage = prismaStorage(prisma);

function randomVector(seed: number): number[] {
  let state = seed >>> 0 || 1;
  return Array.from({ length: DIMENSIONS }, () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff - 0.5;
  });
}

const cosine = (a: readonly number[], b: readonly number[]): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return dot / Math.sqrt(na * nb);
};

test('recherche mémoire pgvector, 20 000 souvenirs, 12 personnages', async ({ bench }) => {
  try {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "world", "llm_call" CASCADE');
    const fixture = await seedWorld(storage, adventureWorld({ seed: 'bench-pgvector', characters: 12 }));
    const epochId = '01960000-0000-7000-8000-00000000b001';
    await storage.tx((s) =>
      s.epochs.insert({
        id: epochId,
        worldId: fixture.world.id,
        seasonId: fixture.season.id,
        number: 0,
        status: 'completed',
        rngSeed: 'bench',
        rulesVersion: 1,
        lastCommittedTick: 31,
      }),
    );
    const characters = fixture.characters.map((c) => c.id);

    // Chargement en masse : l'index HNSW est reconstruit après coup (même définition que la migration `constraints`),
    // comme on le ferait pour un import ; l'insertion ligne à ligne dans le graphe est bien plus lente.
    await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS memory_embedding_hnsw');
    // Insertion par lots côté serveur : vecteurs pseudo-aléatoires distincts (le sous-select dépend de `i`).
    const insertStart = performance.now();
    for (let from = 1; from <= MEMORIES; from += 2_000) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO memory (id, character_id, event_id, epoch_id, kind, summary, emotion, salience, about_character_ids, embedding, last_recalled_epoch)
         SELECT gen_random_uuid(), ($1::uuid[])[1 + (i % ${String(characters.length)})], NULL, $2::uuid, 'episodic',
                'souvenir ' || i, NULL, random()::real, '{}',
                (SELECT array_agg((random() - 0.5)::real) FROM generate_series(1, ${String(DIMENSIONS)} + i * 0))::vector, NULL
         FROM generate_series($3::int, $4::int) AS i`,
        characters,
        epochId,
        from,
        Math.min(MEMORIES, from + 1_999),
      );
    }
    const insertMs = performance.now() - insertStart;
    const indexStart = performance.now();
    await prisma.$executeRawUnsafe(HNSW_DDL);
    const indexMs = performance.now() - indexStart;
    await prisma.$executeRawUnsafe('ANALYZE memory');

    const [counted] = await prisma.$queryRawUnsafe<{ n: bigint }[]>('SELECT count(*) AS n FROM memory');
    const n = counted?.n ?? 0n;
    const [version] = await prisma.$queryRawUnsafe<{ extversion: string }[]>(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    );
    const extversion = version?.extversion ?? '?';
    const indexes = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'memory' ORDER BY indexname",
    );
    const characterId = characters[3] ?? '';
    const query = randomVector(424242);

    // 1. Le plan choisi par le planificateur, tel quel.
    const plan = await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT set_config('hnsw.iterative_scan', 'strict_order', true)`;
      await db.$queryRaw`SELECT set_config('hnsw.ef_search', '40', true)`;
      const rows = await db.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN (ANALYZE, BUFFERS) ${MEMORY_SEARCH_SQL}`,
        characterId,
        vectorLiteral(query),
        K,
      );
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    });
    const usesHnsw = plan.includes('memory_embedding_hnsw');

    // 2. Rappel du résultat du dépôt contre le calcul exact (cosinus côté client) sur les souvenirs du personnage.
    const own = await storage.tx((s) => s.memories.listByCharacter(characterId));
    const exact = own
      .map((m) => ({ id: m.id, sim: cosine(query, m.embedding ?? []) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, K)
      .map((m) => m.id);
    const hits = await storage.tx((s) => s.memories.search(characterId, query, K));
    const recall = hits.filter((h) => exact.includes(h.record.id)).length / K;

    console.log(
      [
        `[bench] pgvector ${extversion}, ${String(n)} souvenirs (${String(own.length)} pour le personnage interrogé), insertion ${(insertMs / 1000).toFixed(1)} s, construction de l'index HNSW ${(indexMs / 1000).toFixed(1)} s`,
        `[bench] index : ${indexes.map((i) => i.indexname).join(', ')}`,
        `[bench] index HNSW choisi par le planificateur : ${usesHnsw ? 'OUI' : 'NON'} ; rappel@${String(K)} contre le calcul exact : ${(recall * 100).toFixed(0)} %`,
        '[bench] plan retenu :',
        plan.replace(/'\[[^\]]*\]'::vector/g, "'[…]'::vector"),
      ].join('\n'),
    );

    const queries = Array.from({ length: 20 }, (_, i) => randomVector(1_000 + i));
    let turn = 0;
    await bench(`memories.search, k=${String(K)}, ${String(own.length)} souvenirs du personnage`, async () => {
      const q = queries[turn++ % queries.length] ?? query;
      await storage.tx((s) => s.memories.search(characterId, q, K));
    }).run({ iterations: 50, warmupIterations: 5, time: 0 });
  } finally {
    await prisma.$executeRawUnsafe(HNSW_DDL);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "world", "llm_call" CASCADE');
    await prisma.$disconnect();
  }
}, 600_000);

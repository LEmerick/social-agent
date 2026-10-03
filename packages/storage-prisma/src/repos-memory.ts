import { Prisma } from '@prisma/client';
import { DomainError, type MemoryHit, type MemoryRecord, type StorageTx } from '@ai-reality/engine';
import type { Db } from './support.js';

/**
 * Souvenirs (`memory`). La colonne `embedding vector(1024)` est `Unsupported` côté Prisma : tout passe par du SQL
 * brut **paramétré**. Les vecteurs sont transmis en littéral texte `'[x,y,…]'::vector`, jamais concaténés au SQL.
 */

const COLUMNS = `id::text AS id, character_id::text AS character_id, event_id::text AS event_id,
  epoch_id::text AS epoch_id, kind::text AS kind, summary, emotion, salience::float8 AS salience,
  about_character_ids::text[] AS about_character_ids, embedding::text AS embedding, last_recalled_epoch`;

/**
 * Recherche des `$3` souvenirs du personnage `$1` les plus proches du vecteur `$2` (distance cosinus).
 *
 * Filtre par personnage + HNSW : l'index HNSW ne connaît pas le filtre, qui s'applique après le parcours du
 * graphe. Avec `ef_search = 40` seuls ~40 candidats sont examinés, dont la plupart peuvent appartenir à d'autres
 * personnages : on pourrait renvoyer moins de `k` lignes. Choix : `hnsw.iterative_scan = strict_order` (pgvector ≥ 0.8) ;
 * l'index continue de parcourir le graphe jusqu'à obtenir `k` lignes filtrées, en gardant l'ordre exact. Pas de
 * sur-échantillonnage ni de second passage côté application. Si le planificateur juge qu'un balayage du
 * personnage + tri est moins cher (peu de souvenirs), le résultat est identique (exact).
 */
export const MEMORY_SEARCH_SQL = `SELECT ${COLUMNS}, 1 - (embedding <=> $2::vector) AS similarity
FROM memory
WHERE character_id = $1::uuid AND embedding IS NOT NULL
ORDER BY embedding <=> $2::vector
LIMIT $3`;

interface MemoryRow {
  id: string;
  character_id: string;
  event_id: string | null;
  epoch_id: string;
  kind: string;
  summary: string;
  emotion: string | null;
  salience: number;
  about_character_ids: string[];
  embedding: string | null;
  last_recalled_epoch: number | null;
  similarity?: number;
}

/** Littéral pgvector : `[x,y,…]`. Refuse tout ce qui n'est pas un nombre fini (le littéral est ensuite lié, pas concaténé). */
export function vectorLiteral(values: readonly number[]): string {
  if (!values.every((x) => Number.isFinite(x))) throw new DomainError('EMBEDDING_INVALID', 'Embedding non fini');
  return `[${values.join(',')}]`;
}

const parseVector = (text: string | null): number[] | null => (text === null ? null : (JSON.parse(text) as number[]));

function toRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    characterId: row.character_id,
    eventId: row.event_id,
    epochId: row.epoch_id,
    kind: row.kind === 'reflection' ? 'reflection' : 'episodic',
    summary: row.summary,
    emotion: row.emotion,
    salience: row.salience,
    aboutCharacterIds: row.about_character_ids,
    embedding: parseVector(row.embedding),
    lastRecalledEpoch: row.last_recalled_epoch,
  };
}

/** Traduit les violations SQL des requêtes brutes (code Prisma P2010, SQLSTATE dans `meta`). */
async function guardRaw<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010') {
      const state = (error.meta as { code?: string } | undefined)?.code;
      if (state === '23505') throw new DomainError('DUPLICATE', 'Souvenir déjà présent');
      if (state === '23503') throw new DomainError('NOT_FOUND', 'Rattachement à un enregistrement inexistant');
    }
    throw error;
  }
}

export function memoryRepos(db: Db): Pick<StorageTx, 'memories'> {
  return {
    memories: {
      insert: (records) =>
        guardRaw(async () => {
          for (const r of records) {
            await db.$executeRaw`
              INSERT INTO memory (id, character_id, event_id, epoch_id, kind, summary, emotion, salience,
                                  about_character_ids, embedding, last_recalled_epoch)
              VALUES (${r.id}::uuid, ${r.characterId}::uuid, ${r.eventId}::uuid, ${r.epochId}::uuid,
                      ${r.kind}::memory_kind, ${r.summary}, ${r.emotion}, ${r.salience}::real,
                      ${[...r.aboutCharacterIds]}::uuid[],
                      ${r.embedding === null ? null : vectorLiteral(r.embedding)}::vector,
                      ${r.lastRecalledEpoch})`;
          }
        }),

      listByCharacter: async (characterId) => {
        const rows = await db.$queryRawUnsafe<MemoryRow[]>(
          `SELECT ${COLUMNS} FROM memory WHERE character_id = $1::uuid ORDER BY id`,
          characterId,
        );
        return rows.map(toRecord);
      },

      search: async (characterId, embedding, k): Promise<MemoryHit[]> => {
        const vector = vectorLiteral(embedding);
        // Équivalent de SET LOCAL : valable jusqu'à la fin de la transaction du port.
        await db.$queryRaw`SELECT set_config('hnsw.iterative_scan', 'strict_order', true)`;
        await db.$queryRaw`SELECT set_config('hnsw.ef_search', ${String(Math.min(1000, Math.max(40, k)))}, true)`;
        const rows = await db.$queryRawUnsafe<MemoryRow[]>(MEMORY_SEARCH_SQL, characterId, vector, Math.max(0, k));
        // L'index ordonne par distance seule : les égalités sont départagées ici, comme dans l'adaptateur mémoire.
        return rows
          .map((row) => ({ record: toRecord(row), similarity: row.similarity ?? 0 }))
          .sort((a, b) => b.similarity - a.similarity || (a.record.id < b.record.id ? -1 : 1));
      },

      updateRecall: async (id, update) => {
        const count = await db.$executeRaw`
          UPDATE memory SET salience = ${update.salience}::real, last_recalled_epoch = ${update.lastRecalledEpoch}
          WHERE id = ${id}::uuid`;
        if (count === 0) throw new DomainError('NOT_FOUND', `Souvenir ${id} introuvable`);
      },
    },
  };
}

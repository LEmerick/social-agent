import type { MemoryRecord, StorageTx } from '@ai-reality/engine';
import { type Db, cmp, copy, duplicate, later, require_ } from './db.js';

/** Cosinus de deux vecteurs ; 0 si l'un est nul. (Local : l'adaptateur ne dépend que de l'index du moteur.) */
function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Souvenirs (`memory`) : la recherche vectorielle est un cosinus exact en JS. */
export function memoryRepos(db: Db): Pick<StorageTx, 'memories'> {
  const own = (characterId: string): MemoryRecord[] =>
    [...db.memories.values()].filter((m) => m.characterId === characterId);

  return {
    memories: {
      insert: (records) =>
        later(() => {
          for (const r of records) {
            if (db.memories.has(r.id)) throw duplicate(`Souvenir ${r.id}`);
            require_(db.characters.has(r.characterId), `Personnage ${r.characterId}`);
            if (r.eventId !== null) require_(db.events.has(r.eventId), `Event ${r.eventId}`);
            db.memories.set(r.id, copy(r));
          }
        }),
      listByCharacter: (characterId) =>
        later(() =>
          own(characterId)
            .sort((a, b) => cmp(a.id, b.id))
            .map(copy),
        ),
      search: (characterId, embedding, k) =>
        later(() =>
          own(characterId)
            .flatMap((record) =>
              record.embedding ? [{ record, similarity: cosineSimilarity(record.embedding, embedding) }] : [],
            )
            .sort((a, b) => b.similarity - a.similarity || cmp(a.record.id, b.record.id))
            .slice(0, Math.max(0, k))
            .map(copy),
        ),
      updateRecall: (id, update) =>
        later(() => {
          const record = db.memories.get(id);
          require_(record !== undefined, `Souvenir ${id}`);
          if (record) db.memories.set(id, { ...record, ...update });
        }),
    },
  };
}

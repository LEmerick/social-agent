import type { MemoryRecord } from '../ports/storage.js';
import { DEFAULT_MEMORY_CONFIG, type DecayedMemory, type MemoryConfig } from './types.js';

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export interface RecallQuery {
  /** Seuls les souvenirs de ce personnage sont éligibles : jamais de fuite entre agents. */
  readonly characterId: string;
  /** Personnes concernées recherchées. */
  readonly about?: readonly string[];
  readonly queryEmbedding?: readonly number[];
  readonly k: number;
}

export interface RankedMemory {
  readonly record: MemoryRecord;
  /** Saillance décrue utilisée dans le score. */
  readonly salience: number;
  /** Similarité cosinus avec la requête, `null` sans requête vectorielle ou sans embedding. */
  readonly similarity: number | null;
  readonly score: number;
}

/**
 * Classe les souvenirs d'un personnage : `score = (wS·saillance + wA·[concerne `about`] + wV·max(0, similarité)) / Σw`,
 * où seules les composantes actives comptent (pas d'`about` ⇒ wA ignoré ; pas de requête vectorielle ⇒ wV ignoré).
 * Égalités départagées par `id`. Renvoie au plus `k` éléments.
 */
export function rankForRecall(
  items: readonly DecayedMemory[],
  query: RecallQuery,
  config: Pick<MemoryConfig, 'weights'> = DEFAULT_MEMORY_CONFIG,
): RankedMemory[] {
  const { weights } = config;
  const about = new Set(query.about ?? []);
  const useAbout = about.size > 0;
  const queryEmbedding = query.queryEmbedding;
  const total = weights.salience + (useAbout ? weights.about : 0) + (queryEmbedding ? weights.similarity : 0);

  return items
    .filter((item) => item.record.characterId === query.characterId)
    .map((item): RankedMemory => {
      const similarity = queryEmbedding && item.record.embedding ? cosine(item.record.embedding, queryEmbedding) : null;
      const concerned = useAbout && item.record.aboutCharacterIds.some((id) => about.has(id));
      const weighted =
        weights.salience * item.salience +
        (useAbout && concerned ? weights.about : 0) +
        weights.similarity * Math.max(0, similarity ?? 0) * (queryEmbedding ? 1 : 0);
      return { record: item.record, salience: item.salience, similarity, score: total > 0 ? weighted / total : 0 };
    })
    .sort((a, b) => b.score - a.score || (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0))
    .slice(0, Math.max(0, query.k));
}

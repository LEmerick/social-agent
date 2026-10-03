import { DomainError } from '../core/errors.js';
import type { EmbeddingPort } from '../ports/embedding.js';
import type { MemoryRecord, StoragePort, StorageTx } from '../ports/storage.js';
import { applyDecay, recalled } from './decay.js';
import { type RankedMemory, rankForRecall } from './recall.js';
import { DEFAULT_MEMORY_CONFIG, type DecayedMemory, type MemoryConfig, type MemoryDraft } from './types.js';

export interface RecallRequest {
  /** Personnes concernées recherchées (ex. l'interlocuteur). */
  readonly about?: readonly string[];
  /** Texte de la requête : sa similarité avec les souvenirs entre dans le score. */
  readonly text?: string;
  readonly k: number;
  /** Époque courante (numéro) : sert à la décroissance et au marquage du rappel. */
  readonly epoch: number;
}

export interface MemoryService {
  /**
   * Calcule les embeddings des résumés puis enregistre les souvenirs (tous ceux du même personnage).
   * Idempotent : un brouillon dont l'identifiant existe déjà est ignoré (non renvoyé).
   */
  record(characterId: string, drafts: readonly MemoryDraft[]): Promise<MemoryRecord[]>;
  /**
   * Meilleurs souvenirs du personnage, jamais ceux d'un autre. Les souvenirs renvoyés sont renforcés
   * (saillance relevée, `lastRecalledEpoch` = `epoch`) ; les scores renvoyés sont ceux d'avant renforcement.
   */
  recall(characterId: string, request: RecallRequest): Promise<RankedMemory[]>;
  /** Saillance décrue à `epoch` de tous les souvenirs du monde. Lecture seule : la décroissance se calcule, elle ne s'écrit pas. */
  decay(worldId: string, epoch: number): Promise<DecayedMemory[]>;
}

/** Candidats demandés à la recherche vectorielle par souvenir finalement renvoyé (le classement les réordonne). */
const OVERSAMPLE = 4;

async function epochNumbers(tx: StorageTx, records: readonly MemoryRecord[]): Promise<Map<string, number>> {
  const numbers = new Map<string, number>();
  for (const id of new Set(records.map((r) => r.epochId))) {
    const epoch = await tx.epochs.findById(id);
    if (epoch) numbers.set(id, epoch.number);
  }
  return numbers;
}

export function createMemoryService(
  storage: StoragePort,
  embedding: EmbeddingPort,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): MemoryService {
  const embedOne = async (text: string): Promise<number[]> => {
    const [vector] = await embedding.embed([text]);
    if (vector?.length !== embedding.dimensions) {
      throw new DomainError(
        'EMBEDDING_INVALID',
        `Embedding de dimension ${String(vector?.length)} au lieu de ${String(embedding.dimensions)}`,
      );
    }
    return vector;
  };

  return {
    async record(characterId, drafts) {
      for (const draft of drafts) {
        if (draft.characterId !== characterId) {
          throw new DomainError(
            'MEMORY_OWNER',
            `Le souvenir ${draft.id} n'appartient pas au personnage ${characterId}`,
          );
        }
      }
      // Idempotent : les identifiants sont déterministes, un souvenir déjà écrit (reprise après panne) est ignoré.
      const present = new Set((await storage.tx((s) => s.memories.listByCharacter(characterId))).map((m) => m.id));
      const fresh = drafts.filter((d) => !present.has(d.id));
      if (fresh.length === 0) return [];
      const vectors = await embedding.embed(fresh.map((d) => d.summary));
      const records = fresh.map((draft, i): MemoryRecord => {
        const vector = vectors[i];
        if (vector?.length !== embedding.dimensions) {
          throw new DomainError('EMBEDDING_INVALID', `Embedding invalide pour le souvenir ${draft.id}`);
        }
        return { ...draft, embedding: vector, lastRecalledEpoch: null };
      });
      await storage.tx((s) => s.memories.insert(records));
      return records;
    },

    async recall(characterId, request) {
      const queryEmbedding = request.text === undefined ? undefined : await embedOne(request.text);
      return storage.tx(async (s) => {
        const candidates = new Map<string, MemoryRecord>();
        if (queryEmbedding) {
          for (const hit of await s.memories.search(characterId, queryEmbedding, request.k * OVERSAMPLE)) {
            candidates.set(hit.record.id, hit.record);
          }
        }
        // Sans requête vectorielle, ou pour retrouver les souvenirs d'une personne quel que soit leur texte.
        if (!queryEmbedding || (request.about?.length ?? 0) > 0) {
          const about = new Set(request.about ?? []);
          for (const record of await s.memories.listByCharacter(characterId)) {
            if (about.size === 0 || record.aboutCharacterIds.some((id) => about.has(id)))
              candidates.set(record.id, record);
          }
        }
        const records = [...candidates.values()];
        const decayed = applyDecay(records, request.epoch, await epochNumbers(s, records), config.halfLife);
        const ranked = rankForRecall(
          decayed,
          {
            characterId,
            ...(request.about ? { about: request.about } : {}),
            ...(queryEmbedding ? { queryEmbedding } : {}),
            k: request.k,
          },
          config,
        );
        for (const item of ranked) {
          await s.memories.updateRecall(item.record.id, recalled(item, request.epoch, config.recallBoost));
        }
        return ranked;
      });
    },

    decay(worldId, epoch) {
      return storage.tx(async (s) => {
        const records: MemoryRecord[] = [];
        for (const character of await s.characters.listByWorld(worldId)) {
          records.push(...(await s.memories.listByCharacter(character.id)));
        }
        return applyDecay(records, epoch, await epochNumbers(s, records), config.halfLife);
      });
    },
  };
}

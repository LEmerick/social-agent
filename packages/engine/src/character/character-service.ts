import { DomainError } from '../core/errors.js';
import type { IdFactory } from '../core/id.js';
import { type Result, err, ok } from '../core/result.js';
import type { CharacterRecord, StoragePort } from '../ports/storage.js';
import { type CharacterSpec, CharacterSpecSchema } from './character-spec.js';

export interface CharacterService {
  create(worldId: string, input: unknown): Promise<Result<CharacterRecord>>;
  get(id: string): Promise<CharacterRecord | undefined>;
  listByWorld(worldId: string): Promise<CharacterRecord[]>;
}

export function createCharacterService(storage: StoragePort, ids: IdFactory): CharacterService {
  return {
    async create(worldId, input) {
      const parsed = CharacterSpecSchema.safeParse(input);
      if (!parsed.success) {
        const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`).join('; ');
        return err(new DomainError('INVALID_SPEC', `Spécification de personnage invalide — ${detail}`));
      }
      const spec: CharacterSpec = parsed.data;
      try {
        const record = await storage.tx(async (s) => {
          const character: CharacterRecord = {
            id: ids.next(),
            worldId,
            slug: spec.slug,
            firstName: spec.firstName,
            lastName: spec.lastName,
            age: spec.age,
            autonomy: spec.autonomy,
            status: 'active',
            traits: { ...spec.traits },
          };
          await s.characters.insert(character);
          return character;
        });
        return ok(record);
      } catch (error) {
        if (error instanceof DomainError) return err(error);
        throw error;
      }
    },

    get(id) {
      return storage.tx((s) => s.characters.findById(id));
    },

    listByWorld(worldId) {
      return storage.tx((s) => s.characters.listByWorld(worldId));
    },
  };
}

import { describe, expect, it } from 'vitest';
import { createCharacterService } from '../../src/character/character-service.js';
import { ManualClock } from '../../src/core/clock.js';
import { DomainError } from '../../src/core/errors.js';
import { createIdFactory } from '../../src/core/id.js';
import { Rng } from '../../src/core/rng.js';
import type { CharacterRecord, StoragePort } from '../../src/ports/storage.js';

/** Stockage factice : enregistre les insertions et peut simuler une erreur de contrainte. */
function fakeStorage(insertError?: DomainError) {
  const inserted: CharacterRecord[] = [];
  const storage: StoragePort = {
    tx: (fn) =>
      fn({
        worlds: { insert: async () => undefined, findById: async () => undefined },
        locations: { insert: async () => undefined, listByWorld: async () => [] },
        characters: {
          insert: async (c) => {
            if (insertError) throw insertError;
            inserted.push(c);
          },
          findById: async () => undefined,
          listByWorld: async () => [],
        },
      }),
  };
  return { storage, inserted };
}

const validSpec = {
  slug: 'alexandre',
  firstName: 'Alexandre',
  autonomy: 'autonomous',
  traits: { ambition: 90, manipulation: 80, loyalty: 40 },
};

const newService = (storage: StoragePort) =>
  createCharacterService(storage, createIdFactory(new ManualClock(1_700_000_000_000), new Rng(1)));

describe('CharacterService.create', () => {
  it('crée un personnage valide, actif, avec ses traits', async () => {
    const { storage, inserted } = fakeStorage();
    const result = await newService(storage).create('world-1', validSpec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      worldId: 'world-1',
      slug: 'alexandre',
      firstName: 'Alexandre',
      lastName: null,
      age: null,
      autonomy: 'autonomous',
      status: 'active',
      traits: { ambition: 90, manipulation: 80, loyalty: 40 },
    });
    expect(inserted).toEqual([result.value]);
  });

  it('rejette un trait hors 0..100 et nomme le trait fautif', async () => {
    const { storage, inserted } = fakeStorage();
    const result = await newService(storage).create('world-1', {
      ...validSpec,
      traits: { ambition: 120 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_SPEC');
    expect(result.error.message).toContain('traits.ambition');
    expect(inserted).toHaveLength(0);
  });

  it('rejette un trait négatif', async () => {
    const { storage } = fakeStorage();
    const result = await newService(storage).create('world-1', { ...validSpec, traits: { loyalty: -1 } });
    expect(result.ok).toBe(false);
  });

  it('rejette une autonomie inconnue', async () => {
    const { storage } = fakeStorage();
    const result = await newService(storage).create('world-1', { ...validSpec, autonomy: 'chaotic' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_SPEC');
  });

  it('rejette un slug qui ne respecte pas le format', async () => {
    const { storage } = fakeStorage();
    const result = await newService(storage).create('world-1', { ...validSpec, slug: 'Alexandre Le Grand' });
    expect(result.ok).toBe(false);
  });

  it("propage une erreur de stockage (slug en double) sans lever d'exception", async () => {
    const { storage } = fakeStorage(new DomainError('DUPLICATE', 'déjà présent'));
    const result = await newService(storage).create('world-1', validSpec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DUPLICATE');
  });

  it('même graine et même horloge ⇒ même identifiant', async () => {
    const a = await newService(fakeStorage().storage).create('world-1', validSpec);
    const b = await newService(fakeStorage().storage).create('world-1', validSpec);
    expect(a.ok && b.ok && a.value.id === b.value.id).toBe(true);
  });
});

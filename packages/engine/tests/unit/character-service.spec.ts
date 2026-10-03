import { describe, expect, it } from 'vitest';
import { createCharacterService } from '../../src/character/character-service.js';
import { ManualClock } from '../../src/core/clock.js';
import { DomainError } from '../../src/core/errors.js';
import { createIdFactory } from '../../src/core/id.js';
import { Rng } from '../../src/core/rng.js';
import type { CharacterRecord, GoalRecord, StorageTx, StoragePort } from '../../src/ports/storage.js';

/** Stockage factice : enregistre les insertions et peut simuler une erreur de contrainte. */
function fakeStorage(insertError?: DomainError) {
  const inserted: CharacterRecord[] = [];
  const goals: GoalRecord[] = [];
  const tx: Pick<StorageTx, 'characters' | 'goals'> = {
    characters: {
      insert: async (c) => {
        if (insertError) throw insertError;
        inserted.push(c);
      },
      findById: async (id) => inserted.find((c) => c.id === id),
      listByWorld: async () => inserted,
      updateStatus: async () => undefined,
    },
    goals: {
      insert: async (g) => {
        goals.push(g);
      },
      upsert: async (g) => {
        goals.push(g);
      },
      listByWorld: async () => goals,
    },
  };
  const storage: StoragePort = { tx: (fn) => fn(tx as StorageTx) };
  return { storage, inserted, goals };
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
      gender: null,
      origin: null,
      backstory: null,
      speechStyle: null,
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

  it('conserve l’identité facultative et persiste les objectifs', async () => {
    const { storage, goals } = fakeStorage();
    const result = await newService(storage).create('world-1', {
      ...validSpec,
      gender: 'homme',
      speechStyle: 'posé, ironique',
      goals: [{ kind: 'main', description: 'Gagner la saison' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ gender: 'homme', speechStyle: 'posé, ironique', origin: null });
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      characterId: result.value.id,
      kind: 'main',
      origin: 'player',
      status: 'open',
      targetCharacterId: null,
    });
  });

  it('rejette un objectif de type inconnu', async () => {
    const { storage, inserted } = fakeStorage();
    const result = await newService(storage).create('world-1', {
      ...validSpec,
      goals: [{ kind: 'epic', description: 'x' }],
    });
    expect(result.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });
});

describe('CharacterService.compile', () => {
  it('compile un personnage existant avec ses objectifs', async () => {
    const { storage } = fakeStorage();
    const service = newService(storage);
    const created = await service.create('world-1', {
      ...validSpec,
      goals: [{ kind: 'main', description: 'Gagner la saison' }],
    });
    if (!created.ok) throw created.error;
    const profile = await service.compile(created.value.id);
    expect(profile.ok).toBe(true);
    if (!profile.ok) return;
    expect(profile.value.personaPrompt).toContain('Alexandre');
    expect(profile.value.goals.map((g) => g.description)).toEqual(['Gagner la saison']);
  });

  it('renvoie NOT_FOUND pour un personnage inconnu', async () => {
    const result = await newService(fakeStorage().storage).compile('inconnu');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

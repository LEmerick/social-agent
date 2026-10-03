import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DomainError,
  type CharacterRecord,
  type LocationRecord,
  type StoragePort,
  type WorldRecord,
} from '@ai-reality/engine';

export interface StorageHarness {
  storage: StoragePort;
  /** Remet la base dans un état vide entre deux tests. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

const WORLD: WorldRecord = {
  id: '01960000-0000-7000-8000-000000000001',
  name: 'Maison des Palmiers',
  seed: 'palmiers-test',
  config: { ticksPerEpoch: 32, tickMinutes: 30 },
};

const OTHER_WORLD: WorldRecord = { ...WORLD, id: '01960000-0000-7000-8000-000000000009', name: 'Autre monde' };

const JARDIN: LocationRecord = {
  id: '01960000-0000-7000-8000-000000000010',
  worldId: WORLD.id,
  slug: 'jardin',
  name: 'Jardin',
  kind: 'garden',
  capacity: null,
  isPrivate: false,
  visualRef: null,
};

const CONFESSIONNAL: LocationRecord = {
  ...JARDIN,
  id: '01960000-0000-7000-8000-000000000011',
  slug: 'confessionnal',
  name: 'Confessionnal',
  kind: 'confessional',
  capacity: 1,
  isPrivate: true,
  visualRef: 'confessional.png',
};

const ALEXANDRE: CharacterRecord = {
  id: '01960000-0000-7000-8000-000000000020',
  worldId: WORLD.id,
  slug: 'alexandre',
  firstName: 'Alexandre',
  lastName: null,
  age: 34,
  autonomy: 'autonomous',
  status: 'active',
  traits: { ambition: 90, manipulation: 80, loyalty: 40 },
};

/**
 * Suite de contrat : la même exécution doit réussir sur `storage-memory` et sur `storage-prisma`.
 * Les adaptateurs fournissent un `StorageHarness` via `factory`.
 */
export function storageContract(name: string, factory: () => Promise<StorageHarness>): void {
  describe(`contrat de stockage — ${name}`, () => {
    let harness: StorageHarness;

    beforeEach(async () => {
      harness = await factory();
      await harness.reset();
    });

    afterEach(async () => {
      await harness.close();
    });

    it("un monde inséré se relit à l'identique", async () => {
      await harness.storage.tx((s) => s.worlds.insert(WORLD));
      const found = await harness.storage.tx((s) => s.worlds.findById(WORLD.id));
      expect(found).toEqual(WORLD);
    });

    it('un identifiant inconnu renvoie undefined', async () => {
      const found = await harness.storage.tx((s) => s.worlds.findById(WORLD.id));
      expect(found).toBeUndefined();
    });

    it('un lieu conserve ses champs optionnels (null et valeurs)', async () => {
      await harness.storage.tx(async (s) => {
        await s.worlds.insert(WORLD);
        await s.locations.insert(JARDIN);
        await s.locations.insert(CONFESSIONNAL);
      });
      const locations = await harness.storage.tx((s) => s.locations.listByWorld(WORLD.id));
      expect(locations.map((l) => l.slug).sort()).toEqual(['confessionnal', 'jardin']);
      expect(locations.find((l) => l.slug === 'jardin')).toEqual(JARDIN);
      expect(locations.find((l) => l.slug === 'confessionnal')).toEqual(CONFESSIONNAL);
    });

    it('un personnage conserve ses traits et ses champs optionnels', async () => {
      await harness.storage.tx(async (s) => {
        await s.worlds.insert(WORLD);
        await s.characters.insert(ALEXANDRE);
      });
      const found = await harness.storage.tx((s) => s.characters.findById(ALEXANDRE.id));
      expect(found).toEqual(ALEXANDRE);
    });

    it('listByWorld ne renvoie que les personnages du monde demandé', async () => {
      const autre: CharacterRecord = {
        ...ALEXANDRE,
        id: '01960000-0000-7000-8000-000000000021',
        worldId: OTHER_WORLD.id,
        slug: 'sarah',
      };
      await harness.storage.tx(async (s) => {
        await s.worlds.insert(WORLD);
        await s.worlds.insert(OTHER_WORLD);
        await s.characters.insert(ALEXANDRE);
        await s.characters.insert(autre);
      });
      const list = await harness.storage.tx((s) => s.characters.listByWorld(WORLD.id));
      expect(list).toEqual([ALEXANDRE]);
    });

    it('un slug de personnage déjà pris dans le même monde est rejeté (DUPLICATE)', async () => {
      await harness.storage.tx(async (s) => {
        await s.worlds.insert(WORLD);
        await s.characters.insert(ALEXANDRE);
      });
      const doublon = { ...ALEXANDRE, id: '01960000-0000-7000-8000-000000000022' };
      const failure = await harness.storage.tx((s) => s.characters.insert(doublon)).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(DomainError);
      expect((failure as DomainError).code).toBe('DUPLICATE');
    });

    it('le même slug est accepté dans un autre monde', async () => {
      await harness.storage.tx(async (s) => {
        await s.worlds.insert(WORLD);
        await s.worlds.insert(OTHER_WORLD);
        await s.characters.insert(ALEXANDRE);
        await s.characters.insert({
          ...ALEXANDRE,
          id: '01960000-0000-7000-8000-000000000023',
          worldId: OTHER_WORLD.id,
        });
      });
      const list = await harness.storage.tx((s) => s.characters.listByWorld(OTHER_WORLD.id));
      expect(list).toHaveLength(1);
    });

    it('rattacher un personnage à un monde inexistant est rejeté (NOT_FOUND)', async () => {
      const failure = await harness.storage.tx((s) => s.characters.insert(ALEXANDRE)).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(DomainError);
      expect((failure as DomainError).code).toBe('NOT_FOUND');
    });

    it('une exception dans la transaction annule toutes les écritures', async () => {
      await expect(
        harness.storage.tx(async (s) => {
          await s.worlds.insert(WORLD);
          await s.characters.insert(ALEXANDRE);
          throw new Error('échec volontaire');
        }),
      ).rejects.toThrow('échec volontaire');
      const world = await harness.storage.tx((s) => s.worlds.findById(WORLD.id));
      expect(world).toBeUndefined();
    });
  });
}

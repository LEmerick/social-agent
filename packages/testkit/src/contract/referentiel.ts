import { describe, expect, it } from 'vitest';
import type { CharacterRecord, LocationRecord, SeasonRecord, WorldRecord } from '@ai-reality/engine';
import { aWorld, seedWorld } from '../builders.js';
import { fixedId, IDS } from '../fixtures/ids.js';
import { type HarnessRef, expectCode } from './support.js';

const WORLD: WorldRecord = {
  id: IDS.world,
  name: 'Maison des Palmiers',
  seed: 'palmiers-test',
  config: { ticksPerEpoch: 32, tickMinutes: 30, nested: { a: [1, 2] } },
};
const OTHER_WORLD: WorldRecord = { ...WORLD, id: IDS.otherWorld, name: 'Autre monde' };
const SEASON: SeasonRecord = {
  id: IDS.season,
  worldId: WORLD.id,
  number: 1,
  rules: { economy: { startingCredits: 100 }, relationshipAxes: ['loyaute'] },
  rulesVersion: 1,
  format: { kind: 'villa' },
};
const location = (rank: number, slug: string, over: Partial<LocationRecord> = {}): LocationRecord => ({
  id: fixedId(0x10, rank),
  worldId: WORLD.id,
  slug,
  name: slug,
  kind: 'room',
  capacity: null,
  isPrivate: false,
  visualRef: null,
  ...over,
});
const character = (rank: number, slug: string, over: Partial<CharacterRecord> = {}): CharacterRecord => ({
  id: fixedId(0x30, rank),
  worldId: WORLD.id,
  slug,
  firstName: slug,
  lastName: null,
  age: null,
  gender: null,
  origin: null,
  backstory: null,
  speechStyle: null,
  autonomy: 'autonomous',
  status: 'active',
  traits: {},
  ...over,
});

export function referentielContract(h: HarnessRef): void {
  describe('monde et saison', () => {
    it('worlds.list renvoie tous les mondes triés par nom puis identifiant', async () => {
      expect(await h().storage.tx((s) => s.worlds.list())).toEqual([]);
      const mk = (n: number, name: string) => ({ ...WORLD, id: fixedId(0, 90 + n), name });
      const [b2, a1, b1] = [mk(1, 'Beta'), mk(2, 'Alpha'), mk(0, 'Beta')];
      await h().storage.tx(async (s) => {
        for (const w of [b2, a1, b1]) await s.worlds.insert(w);
      });
      expect((await h().storage.tx((s) => s.worlds.list())).map((w) => w.id)).toEqual([a1.id, b1.id, b2.id]);
    });

    it("un monde inséré se relit à l'identique (config imbriquée comprise)", async () => {
      await h().storage.tx((s) => s.worlds.insert(WORLD));
      expect(await h().storage.tx((s) => s.worlds.findById(WORLD.id))).toEqual(WORLD);
    });

    it('un identifiant de monde inconnu renvoie undefined', async () => {
      expect(await h().storage.tx((s) => s.worlds.findById(WORLD.id))).toBeUndefined();
    });

    it('un monde inséré deux fois est rejeté (DUPLICATE)', async () => {
      await h().storage.tx((s) => s.worlds.insert(WORLD));
      await expectCode(
        h().storage.tx((s) => s.worlds.insert(WORLD)),
        'DUPLICATE',
      );
    });

    it('une saison se relit à l’identique par son numéro', async () => {
      await h().storage.tx(async (s) => {
        await s.worlds.insert(WORLD);
        await s.seasons.insert(SEASON);
      });
      expect(await h().storage.tx((s) => s.seasons.findByNumber(WORLD.id, 1))).toEqual(SEASON);
      expect(await h().storage.tx((s) => s.seasons.findByNumber(WORLD.id, 2))).toBeUndefined();
      expect(await h().storage.tx((s) => s.seasons.findById(SEASON.id))).toEqual(SEASON);
      expect(await h().storage.tx((s) => s.seasons.findById(fixedId(0, 99)))).toBeUndefined();
    });

    it('un numéro de saison déjà pris est rejeté (DUPLICATE) ; un monde inconnu aussi (NOT_FOUND)', async () => {
      await h().storage.tx(async (s) => {
        await s.worlds.insert(WORLD);
        await s.seasons.insert(SEASON);
      });
      await expectCode(
        h().storage.tx((s) => s.seasons.insert({ ...SEASON, id: fixedId(0, 20) })),
        'DUPLICATE',
      );
      await expectCode(
        h().storage.tx((s) => s.seasons.insert({ ...SEASON, id: fixedId(0, 21), worldId: IDS.otherWorld })),
        'NOT_FOUND',
      );
    });

    it('updateRules remplace les règles et la version ; saison inconnue ⇒ NOT_FOUND', async () => {
      await h().storage.tx(async (s) => {
        await s.worlds.insert(WORLD);
        await s.seasons.insert(SEASON);
        await s.seasons.updateRules(SEASON.id, { economy: { startingCredits: 50 } }, 2);
      });
      const found = await h().storage.tx((s) => s.seasons.findByNumber(WORLD.id, 1));
      expect(found).toMatchObject({ rules: { economy: { startingCredits: 50 } }, rulesVersion: 2 });
      await expectCode(
        h().storage.tx((s) => s.seasons.updateRules(fixedId(0, 99), {}, 3)),
        'NOT_FOUND',
      );
    });
  });

  describe('lieux, zones et routes', () => {
    it('les lieux sont triés par slug et conservent leurs champs optionnels', async () => {
      const confessionnal = location(2, 'confessionnal', { capacity: 1, isPrivate: true, visualRef: 'c.png' });
      const cuisine = location(1, 'cuisine');
      await h().storage.tx(async (s) => {
        await s.worlds.insert(WORLD);
        await s.locations.insert(cuisine);
        await s.locations.insert(confessionnal);
        await s.locations.insert(location(3, 'chambres'));
      });
      const list = await h().storage.tx((s) => s.locations.listByWorld(WORLD.id));
      expect(list.map((l) => l.slug)).toEqual(['chambres', 'confessionnal', 'cuisine']);
      expect(list[1]).toEqual(confessionnal);
      expect(list[2]).toEqual(cuisine);
    });

    it('un slug de lieu en double est rejeté ; le même slug est accepté dans un autre monde', async () => {
      await h().storage.tx(async (s) => {
        await s.worlds.insert(WORLD);
        await s.worlds.insert(OTHER_WORLD);
        await s.locations.insert(location(1, 'jardin'));
      });
      await expectCode(
        h().storage.tx((s) => s.locations.insert(location(2, 'jardin'))),
        'DUPLICATE',
      );
      await h().storage.tx((s) => s.locations.insert(location(3, 'jardin', { worldId: OTHER_WORLD.id })));
      expect(await h().storage.tx((s) => s.locations.listByWorld(OTHER_WORLD.id))).toHaveLength(1);
    });

    it('un lieu d’un monde inconnu est rejeté (NOT_FOUND)', async () => {
      await expectCode(
        h().storage.tx((s) => s.locations.insert(location(1, 'jardin'))),
        'NOT_FOUND',
      );
    });

    it('les zones sont triées par lieu puis slug ; lieu inconnu ⇒ NOT_FOUND ; slug en double ⇒ DUPLICATE', async () => {
      const fx = await seedWorld(h().storage);
      expect(fx.zones.length).toBeGreaterThan(0);
      const zones = await h().storage.tx((s) => s.zones.listByWorld(IDS.world));
      expect(zones).toEqual([...fx.zones].sort((a, b) => (a.slug < b.slug ? -1 : 1)));
      const jardin = IDS.locations.jardin;
      await expectCode(
        h().storage.tx((s) =>
          s.zones.insert({ id: fixedId(0x20, 9), locationId: jardin, slug: 'banc', hearingRange: 'location' }),
        ),
        'DUPLICATE',
      );
      await expectCode(
        h().storage.tx((s) =>
          s.zones.insert({ id: fixedId(0x20, 8), locationId: fixedId(0x10, 99), slug: 'x', hearingRange: 'zone' }),
        ),
        'NOT_FOUND',
      );
    });

    it('les routes sont dirigées et triées ; doublon ⇒ DUPLICATE ; lieu inconnu ⇒ NOT_FOUND', async () => {
      await h().storage.tx(async (s) => {
        await s.worlds.insert(WORLD);
        await s.locations.insert(location(1, 'cuisine'));
        await s.locations.insert(location(2, 'salon'));
        await s.routes.insert({ fromLocationId: fixedId(0x10, 2), toLocationId: fixedId(0x10, 1), travelTicks: 2 });
        await s.routes.insert({ fromLocationId: fixedId(0x10, 1), toLocationId: fixedId(0x10, 2), travelTicks: 1 });
      });
      expect(await h().storage.tx((s) => s.routes.listByWorld(WORLD.id))).toEqual([
        { fromLocationId: fixedId(0x10, 1), toLocationId: fixedId(0x10, 2), travelTicks: 1 },
        { fromLocationId: fixedId(0x10, 2), toLocationId: fixedId(0x10, 1), travelTicks: 2 },
      ]);
      await expectCode(
        h().storage.tx((s) =>
          s.routes.insert({ fromLocationId: fixedId(0x10, 1), toLocationId: fixedId(0x10, 2), travelTicks: 3 }),
        ),
        'DUPLICATE',
      );
      await expectCode(
        h().storage.tx((s) =>
          s.routes.insert({ fromLocationId: fixedId(0x10, 1), toLocationId: fixedId(0x10, 77), travelTicks: 1 }),
        ),
        'NOT_FOUND',
      );
    });

    it('le monde Palmiers complet se relit à l’identique (lieux, zones, routes)', async () => {
      const fx = await seedWorld(h().storage, aWorld().build());
      const read = await h().storage.tx(async (s) => ({
        locations: await s.locations.listByWorld(IDS.world),
        routes: await s.routes.listByWorld(IDS.world),
      }));
      expect(read.locations).toEqual([...fx.locations].sort((a, b) => (a.slug < b.slug ? -1 : 1)));
      expect(read.routes).toHaveLength(fx.routes.length);
    });
  });

  describe('transactions', () => {
    it('une exception dans la transaction annule toutes les écritures', async () => {
      await expect(
        h().storage.tx(async (s) => {
          await s.worlds.insert(WORLD);
          await s.characters.insert(character(1, 'alexandre'));
          throw new Error('échec volontaire');
        }),
      ).rejects.toThrow('échec volontaire');
      expect(await h().storage.tx((s) => s.worlds.findById(WORLD.id))).toBeUndefined();
    });

    it('une erreur de contrainte au milieu annule aussi les écritures précédentes', async () => {
      await h().storage.tx((s) => s.worlds.insert(WORLD));
      await expectCode(
        h().storage.tx(async (s) => {
          await s.characters.insert(character(1, 'alexandre'));
          await s.characters.insert(character(2, 'alexandre'));
        }),
        'DUPLICATE',
      );
      expect(await h().storage.tx((s) => s.characters.listByWorld(WORLD.id))).toEqual([]);
    });

    it('les écritures d’une transaction sont visibles dans la même transaction', async () => {
      const seen = await h().storage.tx(async (s) => {
        await s.worlds.insert(WORLD);
        return s.worlds.findById(WORLD.id);
      });
      expect(seen).toEqual(WORLD);
    });
  });
}

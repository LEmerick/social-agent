import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  ManualClock,
  Rng,
  createIdFactory,
  createWorldService,
  emptyTickBatch,
  loadSimState,
  shortestRoute,
} from '@ai-reality/engine';
import { aWorld, aCharacter, aSimState, seedWorld, simStateOf } from '../builders.js';
import { IDS } from '../fixtures/ids.js';
import { palmiersSetupInput } from '../fixtures/palmiers.js';
import { EPOCH_0, EPOCH_1, tick3Batch } from './data.js';
import type { StorageHarness } from './support.js';

/**
 * Sortie du jalon M1 : le monde « Maison des Palmiers » créé en base se recharge en `SimState` à l'identique.
 * À exécuter sur chaque adaptateur, avec le même harnais que `storageContract`.
 */
export function worldRoundTripContract(name: string, factory: () => Promise<StorageHarness>): void {
  describe(`aller-retour monde → SimState — ${name}`, () => {
    let harness: StorageHarness;

    beforeEach(async () => {
      harness = await factory();
      await harness.reset();
    });
    afterEach(async () => {
      await harness.close();
    });

    it('le monde Palmiers rechargé est identique à aSimState()', async () => {
      await seedWorld(harness.storage);
      const loaded = await loadSimState(harness.storage, IDS.world, 1);
      expect(loaded).toEqual(aSimState());
    });

    it('un monde sans personnage ni relation se recharge aussi à l’identique', async () => {
      const fixture = aWorld().withCharacters().build();
      await seedWorld(harness.storage, fixture);
      expect(await loadSimState(harness.storage, IDS.world, 1)).toEqual(simStateOf(fixture));
    });

    it('un monde modifié (trait, directive) se recharge à l’identique', async () => {
      const biases = { actions: { flatter: 0.5 }, targets: {}, prefer: [], forbid: ['threaten'] };
      const fixture = aWorld()
        .withCharacters(aCharacter('alexandre').withTrait('loyalty', 10), aCharacter('sarah'))
        .withDirective({
          id: '01960000-0000-7000-8000-000000008001',
          characterId: IDS.characters.alexandre,
          text: 'Sois discret.',
          fromEpoch: 0,
          toEpoch: null,
          biases,
        })
        .build();
      await seedWorld(harness.storage, fixture);
      const loaded = await loadSimState(harness.storage, IDS.world, 1);
      expect(loaded).toEqual(simStateOf(fixture));
      expect(loaded.characters[IDS.characters.alexandre]?.directive).toEqual(biases);
      expect(loaded.characters[IDS.characters.alexandre]?.traits['loyalty']).toBe(10);
    });

    it('un monde ou une saison inconnus lèvent NOT_FOUND', async () => {
      await expect(loadSimState(harness.storage, IDS.world, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await seedWorld(harness.storage);
      await expect(loadSimState(harness.storage, IDS.world, 2)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
    it('WorldService.setup crée le monde Palmiers et loadSimState le retrouve', async () => {
      const ids = createIdFactory(new ManualClock(1_700_000_000_000), new Rng(7));
      const result = await createWorldService(harness.storage, ids).setup(palmiersSetupInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const state = await loadSimState(harness.storage, result.value.world.id, 1);
      expect(state.world.seed).toBe('palmiers-test');
      const bySlug = Object.fromEntries(Object.values(state.locations).map((l) => [l.slug, l]));
      expect(Object.keys(bySlug).sort()).toEqual(['chambres', 'confessionnal', 'cuisine', 'jardin', 'salon']);
      expect(bySlug['jardin']?.zones.map((z) => z.slug)).toEqual(['banc', 'piscine']);
      expect(state.routes).toHaveLength(12);

      const cuisine = bySlug['cuisine']?.id ?? '';
      const chambres = bySlug['chambres']?.id ?? '';
      // cuisine → salon (1) → chambres (1), plus court que tout autre chemin.
      expect(shortestRoute(state, cuisine, chambres)).toMatchObject({ travelTicks: 2 });
      expect(shortestRoute(state, chambres, cuisine)).toMatchObject({ travelTicks: 2 });
    });

    it('WorldService.setup rejette une route vers un lieu inconnu (INVALID_WORLD) sans rien écrire', async () => {
      const ids = createIdFactory(new ManualClock(1_700_000_000_000), new Rng(7));
      const service = createWorldService(harness.storage, ids);
      const invalid = await service.setup({
        ...palmiersSetupInput(),
        routes: [{ from: 'cuisine', to: 'cave', travelTicks: 1 }],
      });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.error.code).toBe('INVALID_WORLD');
      const stored = await harness.storage.tx((s) => s.locations.listByWorld(IDS.world));
      expect(stored).toEqual([]);
    });

    it('loadSimState reprend le dernier character_state, le prochain seq d’event et la directive de l’époque', async () => {
      const biases = { actions: {}, targets: {}, prefer: ['talk_to'], forbid: [] };
      const fixture = aWorld()
        .withDirective({
          id: '01960000-0000-7000-8000-000000008002',
          characterId: IDS.characters.sarah,
          text: 'Observe.',
          fromEpoch: 1,
          toEpoch: null,
          biases,
        })
        .build();
      await seedWorld(harness.storage, fixture);
      await harness.storage.tx(async (s) => {
        await s.epochs.insert(EPOCH_0);
        await s.epochs.insert(EPOCH_1);
        await s.journal.commitTick(tick3Batch());
      });

      // Dernier état connu : époque 0 (crédits 90) ; l'époque à venir est la 1 → la directive de Sarah s'applique.
      const state = await loadSimState(harness.storage, IDS.world, 1);
      const alexandre = state.characters[IDS.characters.alexandre];
      expect(alexandre).toMatchObject({ credits: 90, mood: { hope: 30 }, scores: { social: 5, drama: 0 } });
      expect(alexandre?.stats).toEqual({ energy: 70, morale: 55, popularity: 50, influence: 53, reputation: 50 });
      expect(state.characters[IDS.characters.sarah]?.credits).toBe(100);
      expect(state.nextEventSeq).toBe(3);
      expect(state.characters[IDS.characters.sarah]?.directive).toEqual(biases);
      const forEpoch0 = await loadSimState(harness.storage, IDS.world, 1, { epochNumber: 0 });
      expect(forEpoch0.characters[IDS.characters.sarah]?.directive).toBeNull();
    });

    it('un monde dont aucun event n’a été joué commence à nextEventSeq = 1', async () => {
      await seedWorld(harness.storage);
      await harness.storage.tx((s) => s.epochs.insert(EPOCH_0));
      await harness.storage.tx((s) => s.journal.commitTick(emptyTickBatch(EPOCH_0.id, 0)));
      expect((await loadSimState(harness.storage, IDS.world, 1)).nextEventSeq).toBe(1);
    });
  });
}

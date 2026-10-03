import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { DAY_SCRIPT, C, L, Z, fixtureWith, go, playEpoch, seeded, snapshotOf } from '../helpers/epoch-kit.js';

/** Timeline d'Alexandre : cuisine → transit → jardin → transit → salon (engine-architecture.md §5). */
describe('scénario timeline (Maison des Palmiers)', () => {
  it("la timeline d'Alexandre enchaîne scène, trajet, scène, trajet, scène", async () => {
    const storage = createMemoryStorage();
    const fixture = await seeded(storage, fixtureWith());
    const script = {
      ...DAY_SCRIPT,
      [C.alexandre]: { 0: go(L.cuisine), 4: go(L.jardin, Z.banc), 10: go(L.salon) },
    };
    await playEpoch(storage, fixture, script);
    const { journal } = await snapshotOf(storage, fixture.world.id, 0);

    const sceneById = new Map(journal.scenes.map((s) => [s.id, s]));
    const timeline = journal.presences
      .filter((p) => p.characterId === C.alexandre)
      .map((p) => ({
        kind: p.kind,
        range: [p.tickStart, p.tickEnd],
        place: p.sceneId ? sceneById.get(p.sceneId)?.locationId : p.toLocationId,
      }));
    expect(timeline).toEqual([
      { kind: 'scene', range: [0, 4], place: L.cuisine },
      { kind: 'transit', range: [4, 6], place: L.jardin },
      { kind: 'scene', range: [6, 10], place: L.jardin },
      { kind: 'transit', range: [10, 11], place: L.salon },
      { kind: 'scene', range: [11, 32], place: L.salon },
    ]);
  });

  it('une arrivée en cours ajoute un segment sans fermer la scène ; un autre lieu a sa propre scène', async () => {
    const storage = createMemoryStorage();
    const fixture = await seeded(storage, fixtureWith());
    await playEpoch(storage, fixture, {
      [C.alexandre]: { 0: go(L.cuisine) },
      [C.sarah]: { 0: go(L.cuisine) },
      [C.lea]: { 2: go(L.cuisine) },
      [C.thomas]: { 0: go(L.jardin, Z.piscine), 6: go(L.jardin, Z.banc) },
    });
    const { journal } = await snapshotOf(storage, fixture.world.id, 0);

    const kitchen = journal.scenes.filter((s) => s.locationId === L.cuisine);
    expect(kitchen).toHaveLength(1);
    expect(kitchen[0]).toMatchObject({ tickStart: 0, tickEnd: 32 });
    const lea = journal.presences.filter((p) => p.characterId === C.lea && p.sceneId === kitchen[0]?.id);
    expect(lea.map((p) => [p.tickStart, p.tickEnd])).toEqual([[2, 32]]);

    // Thomas change de zone dans le jardin : nouvelle présence (observateur → participant), même scène.
    const garden = journal.scenes.filter((s) => s.locationId === L.jardin);
    expect(garden).toHaveLength(1);
    expect(garden[0]?.zoneId).toBe(Z.piscine);
    const thomas = journal.presences.filter((p) => p.characterId === C.thomas);
    expect(thomas.map((p) => [p.tickStart, p.tickEnd, p.role])).toEqual([
      [0, 6, 'participant'],
      [6, 32, 'observer'],
    ]);
  });

  it("une époque de 4 personnages scriptés tient en moins d'une seconde", async () => {
    const storage = createMemoryStorage();
    const fixture = await seeded(storage, fixtureWith());
    const started = performance.now();
    await playEpoch(storage, fixture, DAY_SCRIPT);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

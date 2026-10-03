/** Invariants des formats après une ou plusieurs époques : possession unique, inventaire projeté = rejoué, présence. */
import { expect } from 'vitest';
import { type StoragePort, loadFormatState, projectInventory } from '@ai-reality/engine';
import type { WorldFixture } from '@ai-reality/testkit';

export async function expectInventoryReplayed(storage: StoragePort, fixture: WorldFixture): Promise<number> {
  const events = await storage.tx((s) => s.journal.eventsOfWorld(fixture.world.id));
  const replayed = projectInventory(events);
  const fs = await loadFormatState(storage, fixture.season.id);

  // Aucun objet ne disparaît ni n'est dupliqué : mêmes identifiants, une seule ligne chacun.
  expect(Object.keys(fs.items).sort()).toEqual(Object.keys(replayed).sort());
  for (const [id, item] of Object.entries(fs.items)) {
    const slot = replayed[id];
    expect(slot, `objet ${id} rejoué`).toBeDefined();
    // Possession unique : un porteur OU un lieu, jamais les deux.
    expect(item.holderId !== null && item.locationId !== null, `objet ${id} à deux endroits`).toBe(false);
    expect({
      itemDefId: item.itemDefId,
      holderId: item.holderId,
      locationId: item.locationId,
      hidden: item.hidden,
      state: item.state,
      isFake: item.isFake,
    }).toEqual(slot);
  }
  return Object.keys(fs.items).length;
}

/** Chaque personnage a, pour chaque époque, des segments de présence contigus qui couvrent tous les ticks, sans trou. */
export async function expectPresenceCovers(
  storage: StoragePort,
  fixture: WorldFixture,
  epochs: readonly number[],
): Promise<void> {
  for (const number of epochs) {
    const { journal, ticksPerEpoch } = await storage.tx(async (s) => {
      const epoch = await s.epochs.findByNumber(fixture.world.id, number);
      if (!epoch) throw new Error(`époque ${String(number)} absente`);
      return { journal: await s.journal.read(epoch.id), ticksPerEpoch: fixture.world.config.ticksPerEpoch };
    });
    for (const c of fixture.characters) {
      const own = journal.presences.filter((p) => p.characterId === c.id).sort((a, b) => a.tickStart - b.tickStart);
      expect(own[0]?.tickStart, `${c.slug} époque ${String(number)}`).toBe(0);
      for (let i = 1; i < own.length; i += 1) expect(own[i]?.tickStart).toBe(own[i - 1]?.tickEnd);
      expect(own.at(-1)?.tickEnd).toBe(ticksPerEpoch);
    }
  }
}

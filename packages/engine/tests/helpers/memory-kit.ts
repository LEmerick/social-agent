/** Outils des tests de mémoire : monde réel (ids du testkit), époques, events écrits à la main. */
import { type EventRecord, type Id, type StoragePort } from '@ai-reality/engine';
import { IDS, aWorld, fixedId, seedWorld } from '@ai-reality/testkit';

export const C = IDS.characters;
export const epochId = (n: number): Id => fixedId(0x90, n);

/** Monde des Palmiers + époques 0..`last` dans le stockage. */
export async function seedEpochs(storage: StoragePort, last: number): Promise<void> {
  await seedWorld(storage, aWorld().build());
  await storage.tx(async (s) => {
    for (let n = 0; n <= last; n++) {
      await s.epochs.insert({
        id: epochId(n),
        worldId: IDS.world,
        seasonId: IDS.season,
        number: n,
        status: 'completed',
        rngSeed: `epoch-${String(n)}`,
        rulesVersion: 1,
        lastCommittedTick: 0,
      });
    }
  });
}

let seq = 0;

/** Event écrit à la main : `who` = [personnage, rôle]. */
export function anEvent(
  epoch: number,
  type: string,
  participants: readonly (readonly [Id, 'actor' | 'target' | 'witness' | 'subject'])[],
  importance: number,
): EventRecord {
  seq += 1;
  return {
    id: fixedId(0x80, seq),
    epochId: epochId(epoch),
    tick: seq,
    seq,
    type,
    sceneId: null,
    interactionId: null,
    locationId: null,
    payload: {},
    importance,
    causedByEventId: null,
    participants: participants.map(([characterId, role]) => ({ characterId, role })),
  };
}

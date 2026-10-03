import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { emptyTickBatch } from '@ai-reality/engine';
import { FIDS, IDS, sampleFormatState, seedWorld } from '@ai-reality/testkit';
import { formatOf, loadFormatInto, loadFormatState, saveFormat } from '../../src/formats/index.js';
import { loadSimState } from '../../src/state/load.js';
import { formatPersistenceSuite } from '../helpers/format-persist-suite.js';

formatPersistenceSuite('storage-memory', () =>
  Promise.resolve({ storage: createMemoryStorage(), reset: () => undefined, close: () => undefined }),
);

describe('loadFormatState : valeurs par défaut', () => {
  it('une saison sans format se charge vide ; le chargeur range le FormatState dans SimState.ext', async () => {
    const storage = createMemoryStorage();
    await seedWorld(storage);
    expect(await loadFormatState(storage, IDS.season)).toMatchObject({
      items: {},
      memberships: [],
      votes: [],
      actionLog: [],
    });
    const state = await loadSimState(storage, IDS.world, 1);
    expect(state.ext['format']).toBeUndefined();
    const loaded = await loadFormatInto(storage, state);
    expect(state.ext['format']).toBe(loaded);
    expect(formatOf(state)).toBe(loaded);
  });

  it('un FormatState sauvegardé revient à l’identique, rangé dans ext', async () => {
    const storage = createMemoryStorage();
    await seedWorld(storage);
    await storage.tx((s) =>
      s.epochs.insert({
        id: IDS.epoch,
        worldId: IDS.world,
        seasonId: IDS.season,
        number: 0,
        status: 'running',
        rngSeed: 'x',
        rulesVersion: 1,
        lastCommittedTick: -1,
      }),
    );
    const ev = (n: number) => `01960000-0000-7000-8000-${(0x7600 + n).toString(16).padStart(12, '0')}`;
    await storage.tx((s) =>
      s.journal.commitTick({
        ...emptyTickBatch(IDS.epoch, 1),
        events: [1, 2, 3].map((n) => ({
          id: ev(n),
          epochId: IDS.epoch,
          tick: 1,
          seq: n,
          type: 't',
          sceneId: null,
          interactionId: null,
          locationId: null,
          payload: {},
          importance: 0.1,
          causedByEventId: null,
          participants: [],
        })),
      }),
    );
    const fs = sampleFormatState({ e1: ev(1), e2: ev(2), e3: ev(3) }, null as unknown as string);
    for (const session of Object.values(fs.voteSessions)) (session as { sceneId: string | null }).sceneId = null;
    await saveFormat(storage, IDS.season, fs);
    const state = await loadSimState(storage, IDS.world, 1);
    await loadFormatInto(storage, state);
    // Les adhésions reviennent triées (équipe, personnage, époque de début).
    const key = (m: { teamId: string; characterId: string; fromEpoch: number }) =>
      `${m.teamId}|${m.characterId}|${String(m.fromEpoch).padStart(6, '0')}`;
    fs.memberships.sort((a, b) => (key(a) < key(b) ? -1 : 1));
    expect(state.ext['format']).toEqual(fs);
    expect(Object.keys(formatOf(state).items)).toContain(FIDS.itemNecklace);
  });
});

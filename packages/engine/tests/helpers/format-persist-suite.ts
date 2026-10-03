/** Persistance du FormatState de bout en bout (écriture par un hook, rechargement), sur tout adaptateur. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoragePort } from '@ai-reality/engine';
import { IDS, aWorld, seedWorld, simStateOf } from '@ai-reality/testkit';
import { Rng } from '../../src/core/rng.js';
import { simIdFactory } from '../../src/core/sim-ids.js';
import {
  type FormatOutput,
  type FormatState,
  assignMission,
  castVote,
  createTeam,
  expandSchedule,
  fakeItem,
  findItem,
  formatOf,
  loadFormatInto,
  loadFormatState,
  moveCharacter,
  openVote,
  parseSeasonFormat,
  placeItem,
  recordAction,
  saveFormatState,
  searchLocation,
  tally,
  trackPresence,
} from '../../src/formats/index.js';
import type { SimState } from '../../src/state/types.js';
import { emptyTickBatch } from '../../src/state/journal.js';
import { A, DEF, L, LEA, S, T } from './format-kit.js';

export interface PersistHarness {
  storage: StoragePort;
  reset(): Promise<void> | void;
  close(): Promise<void> | void;
}

const MISSION = '01960000-0000-7000-8000-000000008201';

/** Joue un petit scénario sur un SimState, écrit le lot du tick puis le FormatState dans la même transaction. */
export function formatPersistenceSuite(name: string, factory: () => Promise<PersistHarness>): void {
  describe(`persistance des formats — ${name}`, () => {
    let h: PersistHarness;
    beforeEach(async () => {
      h = await factory();
      await h.reset();
    });
    afterEach(async () => {
      await h.close();
    });

    it('un tick de format commité puis rechargé redonne exactement le même FormatState', async () => {
      const fixture = aWorld().build();
      await seedWorld(h.storage, fixture);
      await h.storage.tx((s) =>
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
      const state: SimState = simStateOf(fixture);
      state.epoch = { id: IDS.epoch, number: 0 };
      for (const id of Object.values(IDS.characters))
        state.positions[id] = { kind: 'at', locationId: L.jardin, zoneId: null };
      const fs = formatOf(state);
      const ids = simIdFactory(state.world.seed, state.world.config, 0, 1, 'persist');
      const fc = { ids, epochId: IDS.epoch, epoch: 0, tick: 1 };
      const format = parseSeasonFormat({ format: 'adventure' });

      // Définitions (le « chargement » du format) : objets, mission, calendrier.
      fs.itemDefs[DEF.necklace] = {
        id: DEF.necklace,
        slug: 'immunity_necklace',
        name: 'Collier',
        description: null,
        kind: 'power',
        effects: { nullify_votes_against_holder: true, expires: 'after_use' },
        transferable: true,
        expiresAfterEpoch: null,
        visualRef: null,
      };
      fs.itemDefs[DEF.clue] = {
        id: DEF.clue,
        slug: 'clue',
        name: 'Indice',
        description: null,
        kind: 'clue',
        effects: { points_to: 'immunity_necklace' },
        transferable: true,
        expiresAfterEpoch: null,
        visualRef: null,
      };
      fs.missionDefs[MISSION] = {
        id: MISSION,
        slug: 'find_necklace_holder',
        title: 'Collier',
        briefing: 'Trouve-le',
        scope: 'individual',
        secrecy: 'secret',
        objective: {
          knows: {
            who: '$self',
            fact: { predicate: 'holds', object: 'item_def:immunity_necklace' },
            minConfidence: 0.7,
          },
        },
        failure: null,
        reward: { credits: 15 },
        penalty: null,
        deadlineEpochOffset: 3,
      };
      for (const n of expandSchedule(format, 3, ids)) fs.scheduled[n.id] = n;

      // Le tick : équipes, objets, fouille, mission, conseil.
      const out: FormatOutput[] = [];
      const red = createTeam(state, fc, { slug: 'red', name: 'Rouges', campLocationId: L.jardin });
      out.push(red, moveCharacter(state, fc, A, red.team.id), moveCharacter(state, fc, S, red.team.id));
      const necklace = placeItem(state, fc, {
        itemDefId: DEF.necklace,
        locationId: L.jardin,
        hidden: true,
        difficulty: 30,
      });
      out.push(necklace, placeItem(state, fc, { itemDefId: DEF.clue, locationId: L.salon, hidden: true }));
      out.push(
        searchLocation(state, fc, { actorId: LEA, locationId: L.jardin, rng: { next: () => 0 } as unknown as Rng }),
      );
      out.push(fakeItem(state, fc, { itemDefId: DEF.necklace, actorId: T }));
      out.push(assignMission(state, fc, { missionDefId: MISSION, to: { characterId: T } }));
      const council = openVote(state, fc, { kind: 'elimination' });
      out.push(council);
      castVote(state, { sessionId: council.session.id, voterId: A, targetId: T });
      castVote(state, { sessionId: council.session.id, voterId: S, targetId: T });
      out.push(tally(state, fc, council.session.id));
      recordAction(state, { actorId: LEA, action: 'search', targetId: null, locationId: L.jardin, epoch: 0, tick: 1 });
      trackPresence(state, [[A, S, LEA]]);
      expect(findItem).toBeDefined();

      const batch = {
        ...emptyTickBatch(IDS.epoch, 1),
        events: out.flatMap((o) => o.events),
        effects: out.flatMap((o) => o.effects),
        facts: out.flatMap((o) => o.facts),
        knowledge: out.flatMap((o) => o.knowledge),
      };
      await h.storage.tx(async (tx) => {
        await tx.journal.commitTick(batch);
        await saveFormatState(tx, IDS.season, fs);
        for (const change of out.flatMap((o) => o.statusChanges))
          await tx.characters.updateStatus(change.characterId, change.to);
      });

      const reloaded: FormatState = await loadFormatState(h.storage, IDS.season);
      expect(reloaded).toEqual(fs);
      expect(Object.keys(reloaded.items)).toHaveLength(3);
      expect(reloaded.voteSessions[council.session.id]?.result?.eliminated).toBe(T);

      // Le chargeur range le tout dans SimState.ext d'un état neuf.
      const fresh = simStateOf(fixture);
      await loadFormatInto(h.storage, fresh);
      expect(fresh.ext['format']).toEqual(fs);

      // Réécrire le même état est idempotent.
      await h.storage.tx((tx) => saveFormatState(tx, IDS.season, fs));
      expect(await loadFormatState(h.storage, IDS.season)).toEqual(fs);
    });
  });
}

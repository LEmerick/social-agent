/** Critère de sortie M7 : une saison adventure de 5 époques, 8 personnages, tourne de bout en bout. */
import { describe, expect, it } from 'vitest';
import { HeuristicOutcomeModel, type StoragePort, loadFormatState } from '@ai-reality/engine';
import { UniformRandomPolicy, adventureWorld, seedWorld } from '@ai-reality/testkit';
import { formatScheduler, runNumber } from './format-run-kit.js';
import { expectInventoryReplayed, expectPresenceCovers } from './format-invariants.js';

export interface SeasonHarness {
  readonly storage: StoragePort;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export function formatSeasonSuite(name: string, factory: () => Promise<SeasonHarness>): void {
  describe(`saison adventure de 5 époques (${name})`, () => {
    it('tourne de bout en bout : invariants de possession, inventaire rejoué, présence', async () => {
      const harness = await factory();
      try {
        await harness.reset();
        const fixture = await seedWorld(harness.storage, adventureWorld({ seed: 'saison-m7' }));
        for (let number = 0; number < 5; number += 1) {
          const scheduler = formatScheduler(harness.storage, new UniformRandomPolicy({ moveProbability: 0.25 }), {
            outcome: new HeuristicOutcomeModel(),
            seasonEpochs: 5,
          });
          await scheduler.run(runNumber(fixture, number)).done;
        }
        const events = await harness.storage.tx((s) => s.journal.eventsOfWorld(fixture.world.id));
        const types = new Set(events.map((e) => e.type));
        for (const t of ['team_created', 'item_placed', 'scheduled_fired', 'team_challenge_resolved', 'vote_tallied']) {
          expect(types.has(t), t).toBe(true);
        }
        const items = await expectInventoryReplayed(harness.storage, fixture);
        expect(items).toBeGreaterThan(3);
        await expectPresenceCovers(harness.storage, fixture, [0, 1, 2, 3, 4]);

        const fs = await loadFormatState(harness.storage, fixture.season.id);
        const sessions = Object.values(fs.voteSessions).filter((s) => s.result !== null);
        expect(sessions.length).toBeGreaterThanOrEqual(3);
        // Les éliminés du journal sont exactement ceux dont le statut a changé.
        const eliminated = events.filter((e) => e.type === 'status_changed').length;
        const states = await harness.storage.tx(async (s) => {
          const epoch = await s.epochs.findByNumber(fixture.world.id, 4);
          return epoch ? s.characterStates.listByEpoch(epoch.id) : [];
        });
        expect(states.filter((c) => c.status === 'eliminated')).toHaveLength(eliminated);
        expect(eliminated).toBeGreaterThan(0);
      } finally {
        await harness.close();
      }
    }, 120_000);
  });
}

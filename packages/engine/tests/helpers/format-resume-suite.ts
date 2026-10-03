/** Reprise d'une époque de format après panne : le journal et le `FormatState` sont identiques à une exécution continue. */
import { describe, expect, it } from 'vitest';
import { HeuristicOutcomeModel, type StoragePort, loadFormatState } from '@ai-reality/engine';
import { UniformRandomPolicy, adventureWorld, seedWorld } from '@ai-reality/testkit';
import { failAt, snapshotOf } from './epoch-kit.js';
import { formatScheduler, runNumber } from './format-run-kit.js';
import { fullHooks } from './interaction-kit.js';

export interface ResumeHarness {
  readonly storage: StoragePort;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export function formatResumeSuite(name: string, factory: () => Promise<ResumeHarness>): void {
  describe(`reprise d'une époque de format (${name})`, () => {
    it('une panne au milieu du conseil, puis resume(), reproduit exactement l’époque continue', async () => {
      const harness = await factory();
      try {
        const { storage } = harness;
        const policy = () => new UniformRandomPolicy({ moveProbability: 0.25 });
        const make = (extraTick: Parameters<typeof fullHooks>[0] = []) =>
          formatScheduler(storage, policy(), {
            outcome: new HeuristicOutcomeModel(),
            seasonEpochs: 3,
            hooks: fullHooks(extraTick),
          });
        const play = async (number: number, extra: Parameters<typeof fullHooks>[0] = []) => {
          await make(extra).run(runNumber(fixture, number)).done;
        };
        const fixture = adventureWorld({ seed: 'reprise-format' });

        // Référence : deux époques sans interruption.
        await harness.reset();
        await seedWorld(storage, fixture);
        await play(0);
        await play(1);
        const reference = await snapshotOf(storage, fixture.world.id, 1);
        const refFormat = await loadFormatState(storage, fixture.season.id);
        expect(Object.values(refFormat.voteSessions).length).toBeGreaterThanOrEqual(2);

        // Même saison, mais l'époque 1 tombe en panne au tick 28 (le conseil), puis reprend.
        await harness.reset();
        await seedWorld(storage, fixture);
        await play(0);
        await expect(play(1, [failAt(28)])).rejects.toThrow('panne injectée au tick 28');
        const interrupted = await snapshotOf(storage, fixture.world.id, 1);
        expect(interrupted.epoch).toMatchObject({ status: 'failed', lastCommittedTick: 27 });
        // L'état persisté s'arrête au tick 27 : le conseil n'a pas eu lieu.
        const beforeCouncil = await loadFormatState(storage, fixture.season.id);
        expect(
          Object.values(beforeCouncil.voteSessions).filter((s) => s.epochId === interrupted.epoch.id),
        ).toHaveLength(0);

        const resumed = await make().resume(interrupted.epoch.id).done;
        expect(resumed.firstTick).toBe(28);
        const final = await snapshotOf(storage, fixture.world.id, 1);
        expect(final.epoch).toEqual(reference.epoch);
        expect(final.journal).toEqual(reference.journal);
        expect(final.states).toEqual(reference.states);
        expect(final.liveRelationships).toEqual(reference.liveRelationships);
        expect(await loadFormatState(storage, fixture.season.id)).toEqual(refFormat);
      } finally {
        await harness.close();
      }
    }, 120_000);
  });
}

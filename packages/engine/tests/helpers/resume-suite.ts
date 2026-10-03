import { describe, expect, it } from 'vitest';
import type { StoragePort } from '@ai-reality/engine';
import {
  DAY_SCRIPT,
  eventHook,
  failAt,
  fixtureWith,
  playEpoch,
  schedulerFor,
  seeded,
  snapshotOf,
} from './epoch-kit.js';

export interface ResumeHarness {
  readonly storage: StoragePort;
  /** Vide la base : on rejoue ensuite le même monde, les identifiants étant déterministes. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Reprise après interruption : un hook lève une exception au tick 17 ; `resume()` doit ensuite produire
 * exactement le même journal (scènes, présences, events, effets, identifiants compris) qu'une exécution continue.
 */
export function resumeSuite(name: string, factory: () => Promise<ResumeHarness>): void {
  describe(`reprise d'époque (${name})`, () => {
    it("resume() après une panne au tick 17 reproduit le journal d'une exécution sans interruption", async () => {
      const harness = await factory();
      try {
        const fixture = fixtureWith();
        const run = { worldId: fixture.world.id, seasonNumber: fixture.season.number, number: 0 };

        // Référence : exécution continue.
        await harness.reset();
        await seeded(harness.storage, fixture);
        await playEpoch(harness.storage, fixture, DAY_SCRIPT, { tick: [eventHook] });
        const reference = await snapshotOf(harness.storage, fixture.world.id, 0);
        expect(reference.journal.events.length).toBeGreaterThan(20);

        // Exécution interrompue au tick 17, puis reprise (nouveau scheduler : aucun état en mémoire n'est réutilisé).
        await harness.reset();
        await seeded(harness.storage, fixture);
        const crashing = schedulerFor(harness.storage, DAY_SCRIPT, { tick: [eventHook, failAt(17)] });
        await expect(crashing.run(run).done).rejects.toThrow('panne injectée au tick 17');

        const interrupted = await snapshotOf(harness.storage, fixture.world.id, 0);
        expect(interrupted.epoch).toMatchObject({ status: 'failed', lastCommittedTick: 16 });
        expect(interrupted.journal.presences.some((p) => p.tickEnd === null)).toBe(true);

        const resumed = await schedulerFor(harness.storage, DAY_SCRIPT, { tick: [eventHook] }).resume(
          interrupted.epoch.id,
        ).done;
        expect(resumed.firstTick).toBe(17);

        const final = await snapshotOf(harness.storage, fixture.world.id, 0);
        expect(final.epoch).toEqual(reference.epoch);
        expect(final.journal).toEqual(reference.journal);
        expect(final.states).toEqual(reference.states);
        expect(final.relationships).toEqual(reference.relationships);
        expect(final.liveRelationships).toEqual(reference.liveRelationships);
      } finally {
        await harness.close();
      }
    }, 60_000);

    it('une panne au tick 0 (avant tout commit) se rattrape aussi, plan compris', async () => {
      const harness = await factory();
      try {
        const fixture = fixtureWith();
        const run = { worldId: fixture.world.id, seasonNumber: fixture.season.number, number: 0 };
        await harness.reset();
        await seeded(harness.storage, fixture);
        await playEpoch(harness.storage, fixture, DAY_SCRIPT, { tick: [eventHook] });
        const reference = await snapshotOf(harness.storage, fixture.world.id, 0);

        await harness.reset();
        await seeded(harness.storage, fixture);
        await expect(schedulerFor(harness.storage, DAY_SCRIPT, { tick: [failAt(0)] }).run(run).done).rejects.toThrow();
        const failed = await snapshotOf(harness.storage, fixture.world.id, 0);
        expect(failed.epoch.lastCommittedTick).toBe(-1);
        await schedulerFor(harness.storage, DAY_SCRIPT, { tick: [eventHook] }).resume(failed.epoch.id).done;

        expect(await snapshotOf(harness.storage, fixture.world.id, 0)).toEqual(reference);
      } finally {
        await harness.close();
      }
    }, 60_000);
  });
}

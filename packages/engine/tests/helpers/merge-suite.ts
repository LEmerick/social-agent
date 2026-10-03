/** Scénario `merge` : le déclencheur `count_active ≤ 10` fusionne les équipes (douze personnages, un éliminé par époque). */
import { describe, expect, it } from 'vitest';
import {
  type StoragePort,
  loadFormatState,
  membersOf,
  parseSeasonFormat,
  ScriptedOutcomeModel,
} from '@ai-reality/engine';
import { adventureWorld, seedWorld } from '@ai-reality/testkit';
import { fullHooks } from './interaction-kit.js';
import { TEST_SCHEDULE, formatScheduler, runNumber } from './format-run-kit.js';
import { ScenarioPolicy } from './scenario-policy.js';
import { snapshotOf } from './epoch-kit.js';

export interface MergeHarness {
  readonly storage: StoragePort;
  reset(): Promise<void>;
  close(): Promise<void>;
}

const format = () =>
  parseSeasonFormat({
    format: 'adventure',
    items: [],
    missions: [],
    schedule: TEST_SCHEDULE.map((s) => (s.kind === 'merge' ? { ...s, trigger: { count_active: { lte: 10 } } } : s)),
  });

export function mergeSuite(name: string, factory: () => Promise<MergeHarness>): void {
  describe(`scénario merge : la fusion des équipes (${name})`, () => {
    it('count_active ≤ 10 réunit les deux équipes en une seule', async () => {
      const harness = await factory();
      try {
        await harness.reset();
        const { storage } = harness;
        const fixture = await seedWorld(storage, adventureWorld({ characters: 12, seed: 'fusion' }));
        const play = async (number: number) => {
          const scheduler = formatScheduler(
            storage,
            // Personne ne bouge de lui-même : les convocations de l'épreuve et du conseil suffisent.
            new ScenarioPolicy({ voteRule: (_voter, candidates) => [...candidates].sort()[0] }),
            { outcome: new ScriptedOutcomeModel(), format: format(), seasonEpochs: 4, hooks: fullHooks() },
          );
          await scheduler.run(runNumber(fixture, number)).done;
          return snapshotOf(storage, fixture.world.id, number);
        };
        const activeTeams = async () => {
          const fs = await loadFormatState(storage, fixture.season.id);
          return Object.values(fs.teams).filter((t) => t.dissolvedEpoch === null);
        };

        // Époque 0 : douze personnages, deux équipes, un éliminé au conseil → onze, pas de fusion.
        const e0 = await play(0);
        expect(e0.journal.events.filter((e) => e.type === 'status_changed')).toHaveLength(1);
        expect(e0.journal.events.some((e) => e.type === 'team_merged')).toBe(false);
        expect((await activeTeams()).map((t) => t.slug).sort()).toEqual(['red', 'yellow']);

        // Époque 1 : le deuxième éliminé ramène l'effectif à dix → fusion au tick suivant le conseil.
        const e1 = await play(1);
        const merged = e1.journal.events.filter((e) => e.type === 'team_merged');
        expect(merged).toHaveLength(1);
        expect(merged[0]?.tick).toBe(29);
        const fs = await loadFormatState(storage, fixture.season.id);
        const teams = await activeTeams();
        expect(teams.map((t) => t.slug)).toEqual(['merged']);
        const mergedTeam = teams[0];
        const members = membersOf(fs, mergedTeam?.id ?? '', 1);
        expect(members).toHaveLength(10);
        const survivors = e1.states
          .filter((s) => s.status !== 'eliminated')
          .map((s) => s.characterId)
          .sort();
        expect(members).toEqual(survivors);
        expect(
          Object.values(fs.teams)
            .filter((t) => t.dissolvedEpoch === 1)
            .map((t) => t.slug)
            .sort(),
        ).toEqual(['red', 'yellow']);
        const fired = Object.values(fs.scheduled).find((s) => s.kind === 'merge');
        expect(fired?.firedEventId).toBe(
          e1.journal.events.find((e) => e.type === 'scheduled_fired' && e.payload['kind'] === 'merge')?.id,
        );
        expect(merged[0]?.payload).toMatchObject({ into: mergedTeam?.id });

        // Époque 2 : une seule équipe, l'épreuve devient individuelle et le conseil réunit tout le monde.
        const e2 = await play(2);
        const challenge = e2.journal.events.find((e) => e.type === 'team_challenge_resolved');
        expect(challenge?.payload).toMatchObject({ winnerTeamId: null });
        expect(e2.journal.events.filter((e) => e.type === 'status_changed')).toHaveLength(1);
        expect(e2.journal.events.filter((e) => e.type === 'team_merged')).toHaveLength(0);
      } finally {
        await harness.close();
      }
    }, 180_000);
  });
}

/** Format villa : pas d'équipes, économie de crédits, repas, conseil au vote du public injecté entre deux époques. */
import { describe, expect, it } from 'vitest';
import {
  HeuristicOutcomeModel,
  type StoragePort,
  loadFormatState,
  injectPublicVote,
  parseSeasonFormat,
} from '@ai-reality/engine';
import { UniformRandomPolicy, adventureWorld, seedWorld } from '@ai-reality/testkit';
import { snapshotOf } from './epoch-kit.js';
import { formatScheduler, runNumber } from './format-run-kit.js';
import { fullHooks } from './interaction-kit.js';

export interface VillaHarness {
  readonly storage: StoragePort;
  reset(): Promise<void>;
  close(): Promise<void>;
}

const villa = () =>
  parseSeasonFormat({
    format: 'villa',
    schedule: [
      { kind: 'meal', every: 1, tick: 14, params: { location: 'salon' } },
      { kind: 'council', every: 1, tick: 28, params: { vote: 'public', location: 'conseil' } },
    ],
  });

export function villaSuite(name: string, factory: () => Promise<VillaHarness>): void {
  describe(`format villa : le vote du public injecté (${name})`, () => {
    it('le conseil ouvre la session, l’API injecte les voix entre deux époques, l’éliminé quitte la villa', async () => {
      const harness = await factory();
      try {
        await harness.reset();
        const { storage } = harness;
        const fixture = await seedWorld(storage, adventureWorld({ characters: 4, economy: true, seed: 'villa' }));
        const play = async (number: number) => {
          const scheduler = formatScheduler(storage, new UniformRandomPolicy({ moveProbability: 0.2 }), {
            outcome: new HeuristicOutcomeModel(),
            format: villa(),
            seasonEpochs: 3,
            hooks: fullHooks(),
          });
          await scheduler.run(runNumber(fixture, number)).done;
          return snapshotOf(storage, fixture.world.id, number);
        };

        const e0 = await play(0);
        expect(e0.journal.events.filter((e) => e.type === 'meal_shared')).toHaveLength(1);
        const opened = e0.journal.events.filter((e) => e.type === 'vote_opened');
        expect(opened).toHaveLength(1);
        expect(opened[0]?.payload).toMatchObject({ kind: 'public' });
        expect(e0.journal.events.some((e) => e.type === 'vote_tallied')).toBe(false);
        const teams = (await loadFormatState(storage, fixture.season.id)).teams;
        expect(Object.keys(teams)).toHaveLength(0);

        const sessionId = String(opened[0]?.payload['sessionId']);
        const [first, second] = fixture.characters.map((c) => c.id).sort();
        if (!first || !second) throw new Error('fixture trop petite');
        // Les voix du public pour sortir : le plus voté est éliminé.
        const result = await injectPublicVote(storage, {
          worldId: fixture.world.id,
          seasonNumber: fixture.season.number,
          sessionId,
          tallies: { [first]: 1200, [second]: 340 },
        });
        expect(result).toMatchObject({ status: 'decided', eliminated: first });
        const events = await storage.tx((s) => s.journal.eventsOfWorld(fixture.world.id));
        const tallied = events.find((e) => e.type === 'vote_tallied');
        expect(tallied?.payload).toMatchObject({ kind: 'public', eliminated: first });
        expect(events.find((e) => e.type === 'status_changed')?.payload).toMatchObject({
          characterId: first,
          to: 'eliminated',
        });
        const fs = await loadFormatState(storage, fixture.season.id);
        expect(fs.voteSessions[sessionId]?.result?.counts).toMatchObject({ [first]: 1200, [second]: 340 });

        // Une session close ne reçoit pas un second résultat.
        await expect(
          injectPublicVote(storage, {
            worldId: fixture.world.id,
            seasonNumber: fixture.season.number,
            sessionId,
            tallies: { [second]: 1 },
          }),
        ).rejects.toThrow(/close/);

        // Époque suivante : l'éliminé est hors-jeu pour toute l'époque.
        const e1 = await play(1);
        const away = e1.journal.presences.filter((p) => p.characterId === first);
        expect(away.every((p) => p.kind === 'offstage' && p.offstageReason === 'eliminated')).toBe(true);
        expect(e1.journal.interactions.every((i) => i.participants.every((p) => p.characterId !== first))).toBe(true);
      } finally {
        await harness.close();
      }
    }, 120_000);
  });
}

import { describe, expect, it } from 'vitest';
import { simulateBalance } from '../../src/balance/index.js';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { aWorld, seedWorld } from '@ai-reality/testkit';

const newSeason = (seedPrefix: string) => async (index: number) => {
  const storage = createMemoryStorage();
  const fixture = await seedWorld(
    storage,
    aWorld()
      .withSeed(`${seedPrefix}-${String(index)}`)
      .build(),
  );
  return { storage, worldId: fixture.world.id, seasonNumber: fixture.season.number };
};

describe('simulateBalance', () => {
  it('2 saisons de 3 époques sans LLM : statistiques cohérentes', async () => {
    const report = await simulateBalance({ seasons: 2, epochs: 3, newSeason: newSeason('bal') });
    expect(report.seasons).toBe(2);
    expect(report.epochsPerSeason).toBe(3);
    expect(report.interactions).toBeGreaterThan(30);
    // Entretien de 10 par époque et 100 crédits au départ (moins les actions payantes) : personne n'est éliminé en 3 époques.
    expect(report.meanSurvivalEpochs).toBe(3);
    expect(report.eliminationRate).toBe(0);
    expect(report.finalCredits.max).toBeLessThanOrEqual(70);
    expect(report.finalCredits.min).toBeGreaterThan(0);
    expect(report.finalCredits.mean).toBeGreaterThan(40);
    expect(report.betrayalRate).toBeGreaterThanOrEqual(0);
    expect(report.betrayalRate).toBeLessThan(0.5);
    const share = Object.values(report.actionDistribution).reduce((s, x) => s + x, 0);
    expect(share).toBeCloseTo(1, 9);
    expect(Object.values(report.outcomeDistribution).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    expect(Object.keys(report.actionDistribution).length).toBeGreaterThan(4);
  }, 120_000);

  it('mêmes graines ⇒ même rapport', async () => {
    const run = () => simulateBalance({ seasons: 1, epochs: 2, newSeason: newSeason('det') });
    expect(await run()).toEqual(await run());
  }, 120_000);

  it('avec une économie serrée, des personnages sont éliminés et la survie moyenne baisse', async () => {
    const report = await simulateBalance({
      seasons: 1,
      epochs: 5,
      newSeason: async () => {
        const storage = createMemoryStorage();
        const base = aWorld().withSeed('serre').build();
        // 25 crédits au départ, 10 d'entretien, restriction sous 20, une époque de grâce.
        const economy = { startingCredits: 25, dailyUpkeep: 10, restrictedThreshold: 20, graceEpochs: 1 };
        const fixture = await seedWorld(storage, { ...base, season: { ...base.season, rules: { economy } } });
        return { storage, worldId: fixture.world.id, seasonNumber: fixture.season.number };
      },
    });
    expect(report.eliminationRate).toBeGreaterThan(0);
    expect(report.meanSurvivalEpochs).toBeLessThan(5);
    expect(report.finalCredits.min).toBeLessThan(20);
  }, 240_000);
});

import { describe, expect, it } from 'vitest';
import { HeuristicOutcomeModel, SCORE_NAMES, recomputeScores } from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { UniformRandomPolicy, aWorld, seedWorld } from '@ai-reality/testkit';
import { ScoringService } from '../../src/interaction/index.js';
import { snapshotOf } from '../helpers/epoch-kit.js';
import { fullHooks, interactionScheduler, runOf } from '../helpers/interaction-kit.js';

describe('ScoringService.recompute', () => {
  it('relit les poids de la saison après updateRules et met à jour entrées et scores des personnages', async () => {
    const storage = createMemoryStorage();
    const fixture = await seedWorld(storage, aWorld().build());
    await interactionScheduler(
      storage,
      new UniformRandomPolicy({ moveProbability: 0.35 }),
      new HeuristicOutcomeModel(),
      fullHooks(),
    ).run(runOf(fixture)).done;
    const before = await snapshotOf(storage, fixture.world.id, 0);
    const entries = before.journal.scoreEntries;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.weight === 1)).toBe(true);

    const weights = { social: 2, drama: 0.5, popularity: 3, survival: 4, influence: 1.5 };
    await storage.tx((s) =>
      s.seasons.updateRules(fixture.season.id, { scoreWeights: weights }, fixture.season.rulesVersion + 1),
    );
    const result = await ScoringService.recompute(storage, before.epoch.id);

    expect(result.weights).toEqual(weights);
    const after = await snapshotOf(storage, fixture.world.id, 0);
    expect(after.journal.scoreEntries).toEqual(entries.map((e) => ({ ...e, weight: weights[e.score] })));
    const expected = recomputeScores(entries, weights).byCharacter;
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    for (const row of after.states) {
      const summary = expected[row.characterId];
      if (!summary) continue;
      for (const name of SCORE_NAMES) expect(row.scores[name]).toBeCloseTo(summary.perScore[name], 9);
    }
    // Les scores ont réellement changé par rapport à la pondération 1.
    expect(after.states.map((r) => r.scores)).not.toEqual(before.states.map((r) => r.scores));
    // Idempotent.
    await ScoringService.recompute(storage, before.epoch.id);
    expect(await snapshotOf(storage, fixture.world.id, 0)).toEqual(after);
  });

  it('avec des poids explicites : ils l’emportent sur ceux de la saison ; époque inconnue ⇒ NOT_FOUND', async () => {
    const storage = createMemoryStorage();
    const fixture = await seedWorld(storage, aWorld().build());
    await interactionScheduler(
      storage,
      new UniformRandomPolicy({ moveProbability: 0.35 }),
      new HeuristicOutcomeModel(),
    ).run(runOf(fixture)).done;
    const { epoch } = await snapshotOf(storage, fixture.world.id, 0);
    const zero = { social: 0, drama: 0, popularity: 0, survival: 0, influence: 0 };
    await ScoringService.recompute(storage, epoch.id, zero);
    const after = await snapshotOf(storage, fixture.world.id, 0);
    expect(after.journal.scoreEntries.every((e) => e.weight === 0)).toBe(true);
    for (const row of after.states) for (const v of Object.values(row.scores)) expect(Math.abs(v)).toBe(0);
    await expect(ScoringService.recompute(storage, '01960000-0000-7000-8000-00000000ffff')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

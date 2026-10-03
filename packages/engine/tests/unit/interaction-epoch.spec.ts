import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HeuristicOutcomeModel, optionKey } from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { UniformRandomPolicy, aWorld, seedWorld } from '@ai-reality/testkit';
import { ScriptedDecisionPolicy } from '../../src/decision/scripted-policy.js';
import { C, L, Z, go, snapshotOf } from '../helpers/epoch-kit.js';
import { interactionEpochSuite, playRandomEpoch } from '../helpers/interaction-epoch-suite.js';
import { fullHooks, interactionScheduler, runOf } from '../helpers/interaction-kit.js';

interactionEpochSuite('storage-memory', () => {
  const storage = createMemoryStorage();
  return Promise.resolve({
    storage,
    reset: () => {
      storage.reset();
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  });
});

describe('interactions : invariants et performance (storage-memory)', () => {
  it('époque de quatre personnages avec interactions en moins d’une seconde', async () => {
    const storage = createMemoryStorage();
    const fixture = await seedWorld(storage, aWorld().build());
    const start = performance.now();
    const snap = await playRandomEpoch(storage, fixture);
    const elapsed = performance.now() - start;
    expect(snap.journal.interactions.length).toBeGreaterThan(10);
    expect(elapsed).toBeLessThan(1000);
  });

  it('propriété : jamais deux interactions par personnage et par tick, au plus maxInteractionsPerScene par scène', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 8 }), fc.integer({ min: 1, max: 3 }), async (seed, max) => {
        const storage = createMemoryStorage();
        const base = aWorld().build();
        const fixture = await seedWorld(storage, {
          ...base,
          world: { ...base.world, seed, config: { ...base.world.config, maxInteractionsPerScene: max } },
        });
        await interactionScheduler(
          storage,
          new UniformRandomPolicy({ moveProbability: 0.5 }),
          new HeuristicOutcomeModel(),
          fullHooks(),
        ).run(runOf(fixture)).done;
        const { journal } = await snapshotOf(storage, fixture.world.id, 0);

        const perTick = new Map<string, number>();
        const perScene = new Map<string, number>();
        for (const i of journal.interactions) {
          const sceneKey = `${i.sceneId}|${String(i.tickStart)}`;
          perScene.set(sceneKey, (perScene.get(sceneKey) ?? 0) + 1);
          for (const p of i.participants.filter((x) => x.role !== 'bystander')) {
            const key = `${p.characterId}|${String(i.tickStart)}`;
            perTick.set(key, (perTick.get(key) ?? 0) + 1);
          }
        }
        expect([...perTick.values()].every((n) => n === 1)).toBe(true);
        expect([...perScene.values()].every((n) => n <= max)).toBe(true);
      }),
      { numRuns: 12 },
    );
  }, 60_000);

  it('une option dont la cible est déjà engagée est abandonnée', async () => {
    const storage = createMemoryStorage();
    const fixture = await seedWorld(storage, aWorld().build());
    const to = (targetId: string) => ({ action: 'small_talk', targetId, factId: null, itemId: null, locationId: null });
    // Tous au jardin (banc) : à tick 0, alexandre parle à sarah ; sarah (engagée) est abandonnée ; léa vise sarah (engagée) ; thomas vise alexandre.
    const destinations = Object.fromEntries(
      [C.alexandre, C.sarah, C.lea, C.thomas].map((id) => [id, { 0: go(L.jardin, Z.banc) }]),
    );
    const decision = new ScriptedDecisionPolicy({
      destinations,
      actions: { [C.alexandre]: { 0: to(C.sarah) }, [C.lea]: { 0: to(C.sarah) }, [C.thomas]: { 0: to(C.alexandre) } },
    });
    await interactionScheduler(storage, decision, undefined, fullHooks()).run(runOf(fixture)).done;
    const { journal } = await snapshotOf(storage, fixture.world.id, 0);
    const first = journal.interactions.filter((i) => i.tickStart === 0);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ initiatorId: C.alexandre });
    expect(optionKey({ action: 'small_talk', targetId: C.sarah, factId: null, itemId: null, locationId: null })).toBe(
      'small_talk|' + C.sarah + '|||',
    );
  });

  it('économie : sous le seuil, la transition est un event status_changed, publiée sur le bus et stockée', async () => {
    const storage = createMemoryStorage();
    const base = aWorld().build();
    const fixture = await seedWorld(storage, {
      ...base,
      season: { ...base.season, rules: { economy: { restrictedThreshold: 95 } } },
    });
    const scheduler = interactionScheduler(storage, new ScriptedDecisionPolicy(), undefined, fullHooks());
    const run = scheduler.run(runOf(fixture));
    const transitions: string[] = [];
    run.bus.on('character.status', (t) => transitions.push(`${t.characterId}:${t.from}>${t.to}`));
    await run.done;

    const { journal, states } = await snapshotOf(storage, fixture.world.id, 0);
    const changes = journal.events.filter((e) => e.type === 'status_changed');
    expect(changes).toHaveLength(4);
    expect(transitions.sort()).toEqual(
      [C.alexandre, C.sarah, C.lea, C.thomas].map((id) => `${id}:active>restricted`).sort(),
    );
    expect(states.every((s) => s.status === 'restricted' && s.credits === 90)).toBe(true);
  });
});

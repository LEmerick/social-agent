import { describe, expect, it } from 'vitest';
import { BudgetedLlm, runLockstep, lockstepAround } from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { runOf } from '../helpers/interaction-kit.js';
import {
  jitterLlm,
  journalHash,
  promptDrivenLlm,
  seededTwoScenes,
  twoSceneScheduler,
} from '../helpers/parallel-kit.js';

async function play(options: { parallelScenes: boolean; concurrency: number; latencySeed: number }) {
  const storage = createMemoryStorage();
  const { fixture } = await seededTwoScenes(storage);
  const jitter = jitterLlm(promptDrivenLlm(), options.latencySeed);
  const llm = new BudgetedLlm(jitter, { maxConcurrency: options.concurrency });
  const run = twoSceneScheduler(storage, fixture, llm, {
    parallelScenes: options.parallelScenes,
    extra: { meter: llm },
  }).run(runOf(fixture));
  const result = await run.done;
  const journal = await storage.tx((s) => s.journal.read(result.epochId));
  return { journal, hash: journalHash(journal), result, calls: jitter.calls() };
}

describe('scènes indépendantes en parallèle', () => {
  it('le journal ne dépend ni de la concurrence ni de l’ordre d’arrivée des réponses', async () => {
    const parallelA = await play({ parallelScenes: true, concurrency: 8, latencySeed: 11 });
    const parallelB = await play({ parallelScenes: true, concurrency: 8, latencySeed: 987654 });
    const sequential = await play({ parallelScenes: true, concurrency: 1, latencySeed: 5 });

    expect(parallelA.journal.interactions.length).toBeGreaterThan(8);
    expect(new Set(parallelA.journal.interactions.map((i) => i.sceneId)).size).toBe(2);
    expect(parallelA.journal.utterances.length).toBeGreaterThan(8);
    expect(parallelA.hash).toBe(sequential.hash);
    expect(parallelB.hash).toBe(sequential.hash);
    expect(parallelA.journal).toEqual(sequential.journal);
  }, 60_000);

  it('les appels de deux scènes sont réellement en vol en même temps, et un à un en mode séquentiel', async () => {
    const parallel = await play({ parallelScenes: true, concurrency: 8, latencySeed: 3 });
    const sequential = await play({ parallelScenes: true, concurrency: 1, latencySeed: 3 });
    expect(parallel.result.metrics.llm?.peakInFlight).toBeGreaterThanOrEqual(2);
    expect(sequential.result.metrics.llm?.peakInFlight).toBe(1);
    expect(parallel.result.metrics.llm?.calls).toBe(sequential.result.metrics.llm?.calls);
  }, 60_000);

  it('sans appel LLM, parallèle ou non, le journal est le même', async () => {
    const { HeuristicOutcomeModel } = await import('@ai-reality/engine');
    const { UniformRandomPolicy } = await import('@ai-reality/testkit');
    const { fullHooks, interactionScheduler } = await import('../helpers/interaction-kit.js');
    const { interactionHook, economyHook } = await import('@ai-reality/engine');
    const hashOf = async (parallelScenes: boolean): Promise<string> => {
      const storage = createMemoryStorage();
      const { fixture } = await seededTwoScenes(storage);
      const done = interactionScheduler(
        storage,
        new UniformRandomPolicy({ moveProbability: 0.4 }),
        new HeuristicOutcomeModel(),
        {
          ...fullHooks(),
          tick: [interactionHook({ parallelScenes })],
          economy: economyHook(),
        },
      ).run(runOf(fixture)).done;
      const result = await done;
      return journalHash(await storage.tx((s) => s.journal.read(result.epochId)));
    };
    expect(await hashOf(true)).toBe(await hashOf(false));
  }, 60_000);
});

describe('runLockstep', () => {
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it('l’ordre d’exécution des segments ne dépend pas de la durée des appels', async () => {
    const trace = async (delays: number[][]): Promise<string[]> => {
      const log: string[] = [];
      await runLockstep(
        delays.map((steps, task) => async () => {
          log.push(`${String(task)}:début`);
          for (const [i, ms] of steps.entries()) {
            await lockstepAround(() => sleep(ms));
            log.push(`${String(task)}:${String(i)}`);
          }
        }),
      );
      return log;
    };
    const a = await trace([
      [9, 1, 5],
      [1, 8],
      [4, 4, 1],
    ]);
    const b = await trace([
      [1, 9, 1],
      [8, 1],
      [1, 1, 9],
    ]);
    expect(a).toEqual(b);
    expect(a.slice(0, 3)).toEqual(['0:début', '1:début', '2:début']);
  });

  it('une tâche en échec n’empêche pas les autres de finir, et l’erreur est relancée', async () => {
    const done: number[] = [];
    await expect(
      runLockstep([
        async () => {
          await lockstepAround(() => sleep(1));
          throw new Error('boum');
        },
        async () => {
          await lockstepAround(() => sleep(5));
          done.push(1);
        },
      ]),
    ).rejects.toThrow('boum');
    expect(done).toEqual([1]);
  });
});

/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : l'époque interrompue existe, les assertions précédentes le garantissent */
/** Tests chaos : panne LLM (erreur, délai), erreur de stockage au commit, arrêt brutal ⇒ `resume` exact, sans effet en double. */
import { describe, expect, it } from 'vitest';
import {
  type LLMPort,
  type LlmRequest,
  type LlmResult,
  type StoragePort,
  BudgetedLlm,
  DEFAULT_WORLD_CONFIG,
  auditSeason,
  deriveUuid,
  llmUnavailable,
  promptHash,
  replaySeason,
} from '@ai-reality/engine';
import { aWorld, seedWorld, type WorldFixture } from '@ai-reality/testkit';
import { journalHash, promptDrivenLlm, twoSceneScheduler } from './parallel-kit.js';

export interface ChaosHarness {
  readonly storage: StoragePort;
  reset(): Promise<void>;
}

/** Même prompt ⇒ même identifiant d'appel, d'une exécution à l'autre : les journaux se comparent tels quels. */
function stableIds(inner: LLMPort): LLMPort {
  return {
    async complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
      const result = await inner.complete(req);
      return { ...result, llmCallId: deriveUuid(`chaos:${promptHash(req)}`) };
    },
  };
}

/** Le LLM de la saison : réponses fonction du prompt, derrière `BudgetedLlm` (seul à faire circuler le jeton entre scènes). */
const seasonLlm = (): LLMPort => new BudgetedLlm(stableIds(promptDrivenLlm()));

type Fault = 'error' | 'timeout';

/** Un LLM qui tombe en panne à son `n`-ième appel (une seule fois) : erreur fournisseur ou délai dépassé. */
function flaky(inner: LLMPort, failAtCall: number, fault: Fault): LLMPort & { failed: () => boolean } {
  let calls = 0;
  let failed = false;
  return {
    failed: () => failed,
    async complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
      calls += 1;
      if (calls === failAtCall) {
        failed = true;
        if (fault === 'error') throw llmUnavailable('panne simulée du fournisseur');
        // Délai dépassé : l'appel ne répond jamais, c'est le garde-fou de délai de l'appelant qui l'interrompt.
        await new Promise<never>((_, reject) => setTimeout(() => reject(llmUnavailable('délai dépassé (30 s)')), 15));
      }
      return inner.complete(req);
    },
  };
}

const newWorld = (storage: StoragePort): Promise<WorldFixture> =>
  seedWorld(storage, aWorld().withSeed('chaos-m8b').build());

const run = (fixture: WorldFixture, number: number) => ({
  worldId: fixture.world.id,
  seasonNumber: fixture.season.number,
  number,
});

/** Journal complet d'une époque, comparable. */
async function epochJournal(storage: StoragePort, fixture: WorldFixture, number: number) {
  return storage.tx(async (s) => {
    const epoch = await s.epochs.findByNumber(fixture.world.id, number);
    if (!epoch) throw new Error(`époque ${String(number)} absente`);
    return { epoch, journal: await s.journal.read(epoch.id), states: await s.characterStates.listByEpoch(epoch.id) };
  });
}

/** Référence : la même saison de deux époques, sans panne. */
async function cleanSeason(factory: () => Promise<ChaosHarness>) {
  const { storage, reset } = await factory();
  await reset();
  const fixture = await newWorld(storage);
  const llm = seasonLlm();
  for (const number of [0, 1]) await twoSceneScheduler(storage, fixture, llm).run(run(fixture, number)).done;
  const replay = await replaySeason(storage, fixture.world.id, fixture.season.number);
  return { fixture, storage, replay, hash: journalHash(await epochJournal(storage, fixture, 1)) };
}

export function chaosSuite(name: string, factory: () => Promise<ChaosHarness>): void {
  describe(`chaos (${name})`, () => {
    for (const fault of ['error', 'timeout'] as const) {
      it(`panne LLM (${fault}) au milieu d'un tick, scènes en parallèle : resume reproduit l'époque sans effet en double`, async () => {
        const clean = await cleanSeason(factory);

        const { storage, reset } = await factory();
        await reset();
        const fixture = await newWorld(storage);
        const ok = seasonLlm();
        await twoSceneScheduler(storage, fixture, ok).run(run(fixture, 0)).done;

        const budgeted = new BudgetedLlm(flaky(stableIds(promptDrivenLlm()), 40, fault));
        const broken = twoSceneScheduler(storage, fixture, budgeted, { parallelScenes: true }).run(run(fixture, 1));
        await expect(broken.done).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });

        const interrupted = await storage.tx((s) => s.epochs.findByNumber(fixture.world.id, 1));
        expect(interrupted?.status).toBe('failed');
        // La panne tombe bien au milieu de l'époque : des ticks sont validés, pas tous.
        expect(interrupted?.lastCommittedTick).toBeGreaterThanOrEqual(0);
        expect(interrupted?.lastCommittedTick).toBeLessThan(DEFAULT_WORLD_CONFIG.ticksPerEpoch - 1);
        // Un tick interrompu n'a rien laissé derrière lui : l'audit voit une époque inachevée, rien d'autre.
        const before = await auditSeason(storage, fixture.world.id, fixture.season.number);
        expect(before.issues.map((i) => i.kind)).not.toContain('seq_gap');

        const resumed = await twoSceneScheduler(storage, fixture, ok, { parallelScenes: true }).resume(interrupted!.id)
          .done;
        expect(resumed.firstTick).toBe(interrupted!.lastCommittedTick + 1);

        expect(journalHash(await epochJournal(storage, fixture, 1))).toBe(clean.hash);
        const audit = await auditSeason(storage, fixture.world.id, fixture.season.number);
        expect(audit.issues).toEqual([]);
        const replay = await replaySeason(storage, fixture.world.id, fixture.season.number);
        expect(replay.diffs).toEqual([]);
        expect(replay.stateHash).toBe(clean.replay.stateHash);
      }, 120_000);
    }

    it('erreur de stockage au commit d’un tick (écriture faite puis exception) : tout est annulé, resume reproduit l’époque', async () => {
      const clean = await cleanSeason(factory);

      const { storage, reset } = await factory();
      await reset();
      const fixture = await newWorld(storage);
      const llm = seasonLlm();
      await twoSceneScheduler(storage, fixture, llm).run(run(fixture, 0)).done;

      let commits = 0;
      const failing: StoragePort = {
        tx: (fn) =>
          storage.tx((s) =>
            fn({
              ...s,
              journal: {
                ...s.journal,
                async commitTick(batch) {
                  await s.journal.commitTick(batch);
                  commits += 1;
                  // Délai d'attente de la base au 6e commit de l'époque, une fois les écritures faites.
                  if (commits === 6) throw new Error('canceling statement due to statement timeout');
                },
              },
            }),
          ),
      };
      const broken = twoSceneScheduler(failing, fixture, llm, { parallelScenes: true }).run(run(fixture, 1));
      await expect(broken.done).rejects.toThrow(/statement timeout/);

      const interrupted = await storage.tx((s) => s.epochs.findByNumber(fixture.world.id, 1));
      expect(interrupted?.status).toBe('failed');
      expect(interrupted?.lastCommittedTick).toBe(4); // le 6e commit (tick 5) a été annulé en entier
      const partial = await epochJournal(storage, fixture, 1);
      expect(Math.max(...partial.journal.events.map((e) => e.tick))).toBeLessThanOrEqual(4);

      await twoSceneScheduler(storage, fixture, llm, { parallelScenes: true }).resume(interrupted!.id).done;
      expect(journalHash(await epochJournal(storage, fixture, 1))).toBe(clean.hash);
      expect((await auditSeason(storage, fixture.world.id, fixture.season.number)).issues).toEqual([]);
      expect((await replaySeason(storage, fixture.world.id, fixture.season.number)).stateHash).toBe(
        clean.replay.stateHash,
      );
    }, 120_000);

    it('arrêt brutal au milieu d’un tick (le processus ne rend jamais la main) : un nouveau scheduler reprend, sans doublon', async () => {
      const clean = await cleanSeason(factory);

      const { storage, reset } = await factory();
      await reset();
      const fixture = await newWorld(storage);
      const llm = seasonLlm();
      await twoSceneScheduler(storage, fixture, llm).run(run(fixture, 0)).done;

      // Le « processus » meurt pendant le tick 7 : son appel LLM ne revient jamais et personne n'attend plus rien.
      let calls = 0;
      const dying: LLMPort = {
        complete: <T>(req: LlmRequest<T>): Promise<LlmResult<T>> => {
          calls += 1;
          return calls === 60 ? new Promise<LlmResult<T>>(() => undefined) : llm.complete(req);
        },
      };
      const killed = twoSceneScheduler(storage, fixture, dying, { parallelScenes: true }).run(run(fixture, 1));
      killed.done.catch(() => undefined);
      await until(() => calls >= 60);

      // Statut resté à « running » : personne n'a pu écrire « failed ». Le journal ne contient que des ticks complets.
      const interrupted = await storage.tx((s) => s.epochs.findByNumber(fixture.world.id, 1));
      expect(interrupted?.status).toBe('running');
      expect(interrupted?.lastCommittedTick).toBeGreaterThanOrEqual(0);
      expect(interrupted?.lastCommittedTick).toBeLessThan(DEFAULT_WORLD_CONFIG.ticksPerEpoch - 1);

      await twoSceneScheduler(storage, fixture, llm, { parallelScenes: true }).resume(interrupted!.id).done;
      expect(journalHash(await epochJournal(storage, fixture, 1))).toBe(clean.hash);
      const audit = await auditSeason(storage, fixture.world.id, fixture.season.number);
      expect(audit.issues).toEqual([]);
      expect((await replaySeason(storage, fixture.world.id, fixture.season.number)).stateHash).toBe(
        clean.replay.stateHash,
      );
    }, 120_000);
  });
}

async function until(condition: () => boolean, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition non atteinte');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  // Laisse l'exécution se bloquer sur l'appel suspendu.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

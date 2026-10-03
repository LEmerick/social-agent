import { describe, expect, it } from 'vitest';
import {
  type EpochMetrics,
  type LLMPort,
  type LlmRequest,
  type LlmResult,
  BudgetedLlm,
  HeuristicOutcomeModel,
  LlmBudgetExceededError,
  ScriptedDecisionPolicy,
  UtilityDecisionPolicy,
  costOf,
  personaPrompt,
} from '@ai-reality/engine';
import { aWorld, seedWorld } from '@ai-reality/testkit';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { LlmDecisionPolicy } from '../../src/decision/llm-policy.js';
import { LlmOutcomeModel } from '../../src/decision/llm-outcome.js';
import { economyHook } from '../../src/economy/hook.js';
import { budgetedDecision, budgetedDialogue, budgetedOutcome, createEpochScheduler } from '../../src/epoch/index.js';
import { interactionHook } from '../../src/interaction/index.js';
import { LlmDialogue } from '../../src/interaction/llm-dialogue.js';
import { C, L, Z, go } from '../helpers/epoch-kit.js';
import { runOf } from '../helpers/interaction-kit.js';
import { journalHash, promptDrivenLlm } from '../helpers/parallel-kit.js';

const PRICING = { fake: { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 } };

/** Ajoute à chaque réponse un usage proportionnel au prompt (le FakeLLM n'en déclare aucun). */
function withUsage(inner: LLMPort, outputTokens = 40): LLMPort {
  return {
    async complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
      const result = await inner.complete(req);
      const chars = req.system.stable.length + req.messages.reduce((total, m) => total + m.content.length, 0);
      return {
        ...result,
        model: 'fake',
        usage: { inputTokens: Math.ceil(chars / 4), outputTokens, cachedTokens: 0 },
        latencyMs: 2,
      };
    },
  };
}

const request = (text = 'bonjour', maxTokens = 100): LlmRequest => ({
  purpose: 'speak',
  tier: 'fast',
  system: { stable: 'système' },
  messages: [{ role: 'user', content: text }],
  maxTokens,
});

describe('BudgetedLlm', () => {
  it('borne la concurrence et mesure appels, jetons et coût', async () => {
    let inFlight = 0;
    let peak = 0;
    const slow: LLMPort = {
      async complete<T>(): Promise<LlmResult<T>> {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return {
          text: 'ok',
          llmCallId: 'x',
          model: 'fake',
          usage: { inputTokens: 1_000, outputTokens: 200, cachedTokens: 400 },
          latencyMs: 5,
        } as LlmResult<T>;
      },
    };
    const llm = new BudgetedLlm(slow, { maxConcurrency: 2, pricing: PRICING });
    llm.beginEpoch();
    await Promise.all(Array.from({ length: 6 }, () => llm.complete(request())));
    const m = llm.snapshot();
    expect(peak).toBe(2);
    expect(m.peakInFlight).toBe(2);
    expect(m.calls).toBe(6);
    expect(m.inputTokens).toBe(6_000);
    expect(m.outputTokens).toBe(1_200);
    expect(m.cachedTokens).toBe(2_400);
    // 600 jetons frais à 3 $, 400 en cache à 0,3 $, 200 de sortie à 15 $ (par million), six fois.
    const one = (600 * 3 + 400 * 0.3 + 200 * 15) / 1e6;
    expect(m.costUsd).toBeCloseTo(6 * one, 10);
    expect(costOf(PRICING, 'fake', { inputTokens: 1_000, outputTokens: 200, cachedTokens: 400 })).toBeCloseTo(one, 10);
    expect(m.byPurpose.speak?.calls).toBe(6);
    llm.beginEpoch();
    expect(llm.snapshot().calls).toBe(0);
  });

  it('refuse les appels une fois le budget de jetons atteint, réservations en vol comprises', async () => {
    const llm = new BudgetedLlm(withUsage(promptDrivenLlm(), 40), { budget: { maxTokensPerEpoch: 400 } });
    llm.beginEpoch();
    const reply = { purpose: 'verify' as const, tier: 'fast' as const, system: { stable: 's'.repeat(80) } };
    const ask = (): Promise<LlmResult> =>
      llm.complete({ ...reply, messages: [{ role: 'user', content: 'x'.repeat(200) }], maxTokens: 40 });
    // Chaque appel pèse 20 + 50 + 40 = 110 jetons réels ; le quatrième ne passe plus.
    let accepted = 0;
    while (!llm.exhausted && accepted < 10) {
      await ask();
      accepted += 1;
    }
    expect(accepted).toBeLessThan(10);
    await expect(ask()).rejects.toBeInstanceOf(LlmBudgetExceededError);
    await expect(ask()).rejects.toMatchObject({ code: 'LLM_BUDGET_EXCEEDED' });
    const m = llm.snapshot();
    expect(m.rejected).toBe(2);
    expect(m.inputTokens + m.outputTokens).toBeGreaterThanOrEqual(400);
    // Nouvelle époque, nouveau budget.
    llm.beginEpoch();
    expect(llm.exhausted).toBe(false);
  });

  it('le budget en coût s’appuie sur le tarif', async () => {
    const llm = new BudgetedLlm(withUsage(promptDrivenLlm(), 1_000), {
      pricing: PRICING,
      budget: { maxCostPerEpoch: 0.01 },
    });
    llm.beginEpoch();
    let calls = 0;
    while (!llm.exhausted && calls < 50) {
      await llm.complete({ ...request('x'.repeat(4_000), 1_000), purpose: 'verify' });
      calls += 1;
    }
    expect(calls).toBeLessThan(50);
    expect(llm.snapshot().costUsd).toBeGreaterThanOrEqual(0.01);
  });
});

describe('époque sous budget', () => {
  async function play(budget: { maxTokensPerEpoch?: number } | null) {
    const storage = createMemoryStorage();
    const fixture = await seedWorld(storage, aWorld().withSeed('budget-m8b').build());
    const persona = (id: string): string => {
      const record = fixture.characters.find((c) => c.id === id);
      if (!record) throw new Error(id);
      return personaPrompt(record);
    };
    const llm = new BudgetedLlm(withUsage(promptDrivenLlm()), {
      maxConcurrency: 1,
      pricing: PRICING,
      ...(budget ? { budget } : {}),
    });
    const destinations = {
      [C.alexandre]: { 0: go(L.jardin, Z.banc) },
      [C.sarah]: { 0: go(L.jardin, Z.banc) },
      [C.lea]: { 0: go(L.cuisine) },
      [C.thomas]: { 0: go(L.cuisine) },
    };
    const scripted = new ScriptedDecisionPolicy({ destinations });
    const utility = new UtilityDecisionPolicy();
    let clock = 0;
    const scheduler = createEpochScheduler({
      storage,
      meter: llm,
      now: () => (clock += 10),
      decision: budgetedDecision(
        new LlmDecisionPolicy({ llm, persona, destination: scripted }),
        { choose: (input) => utility.choose(input), chooseDestination: (input) => scripted.chooseDestination(input) },
        llm,
      ),
      outcome: budgetedOutcome(new LlmOutcomeModel({ llm, persona }), new HeuristicOutcomeModel(), llm),
      hooks: {
        tick: [interactionHook({ dialogue: budgetedDialogue(new LlmDialogue({ llm, persona }), llm) })],
        economy: economyHook(),
      },
    });
    const run = scheduler.run(runOf(fixture));
    const seen: EpochMetrics[] = [];
    run.bus.on('epoch.metrics', ({ metrics }) => seen.push(metrics));
    const result = await run.done;
    const journal = await storage.tx((s) => s.journal.read(result.epochId));
    return { result, journal, seen, llm };
  }

  it('sans budget : métriques complètes dans le résultat et sur le bus', async () => {
    const { result, seen, journal } = await play(null);
    const { metrics } = result;
    expect(seen).toEqual([metrics]);
    expect(metrics.llm?.calls).toBeGreaterThan(20);
    expect(metrics.llm?.fallbacks).toBe(0);
    expect(metrics.llm?.costUsd).toBeGreaterThan(0);
    expect(metrics.llm?.inputTokens).toBeGreaterThan(0);
    expect(metrics.ticks).toBe(result.ticksPerEpoch);
    expect(Object.keys(metrics.phaseMs).sort()).toEqual(['close', 'economy', 'init', 'memory', 'plan', 'ticks']);
    expect(metrics.phaseMs.ticks).toBeGreaterThan(0);
    expect(metrics.totalMs).toBeGreaterThanOrEqual(metrics.phaseMs.ticks);
    expect(journal.decisions.every((d) => d.policy === 'llm@1')).toBe(true);
    expect(journal.interactions.every((i) => i.mode === 'dialogue')).toBe(true);
  });

  it('budget épuisé en cours d’époque : repli sur les politiques sans LLM et le dialogue résumé, journalisé', async () => {
    const full = await play(null);
    const cap = Math.floor(
      ((full.result.metrics.llm?.inputTokens ?? 0) + (full.result.metrics.llm?.outputTokens ?? 0)) / 4,
    );
    const { result, journal, llm } = await play({ maxTokensPerEpoch: cap });
    const m = result.metrics.llm;
    expect(m?.fallbacks).toBeGreaterThan(0);
    expect(m?.calls).toBeLessThan(full.result.metrics.llm?.calls ?? 0);
    // La limite tient : au plus l'estimation d'un appel de dépassement.
    expect((m?.inputTokens ?? 0) + (m?.outputTokens ?? 0)).toBeLessThan(cap + 1_500);
    expect(llm.exhausted).toBe(true);

    const policies = new Set(journal.decisions.map((d) => d.policy));
    expect(policies.has('llm@1')).toBe(true);
    expect([...policies].some((p) => p !== 'llm@1')).toBe(true);
    const summarized = journal.interactions.filter((i) => i.mode === 'summarized');
    expect(summarized.length).toBeGreaterThan(0);
    expect(summarized[0]?.classification?.['verification']).toMatchObject({
      fallback: true,
      reasons: ['LLM_BUDGET_EXCEEDED'],
    });
    // Le début de l'époque est encore du dialogue complet.
    expect(journal.interactions.some((i) => i.mode === 'dialogue')).toBe(true);
  });

  it('avec une seule requête à la fois, le repli est déterministe (même budget ⇒ même journal)', async () => {
    const full = await play(null);
    const cap = Math.floor(
      ((full.result.metrics.llm?.inputTokens ?? 0) + (full.result.metrics.llm?.outputTokens ?? 0)) / 3,
    );
    const a = await play({ maxTokensPerEpoch: cap });
    const b = await play({ maxTokensPerEpoch: cap });
    expect(journalHash(a.journal)).toBe(journalHash(b.journal));
  });
});

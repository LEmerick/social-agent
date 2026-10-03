/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
/**
 * Évaluations live des agents LLM (`pnpm test:live`, hors CI) : squelette des mesures du jalon M5.
 *
 *  1. cohérence de persona : face à la même tentation de trahir son allié, un personnage loyal doit trahir
 *     nettement moins souvent qu'un manipulateur (20 exécutions chacun) ;
 *  2. taux de vérification réussie des dialogues ≥ 90 % ;
 *  3. coût et latence mesurés et journalisés (une ligne JSON par évaluation, préfixe `[live]`).
 *
 * Sauté sans `ANTHROPIC_API_KEY`. Les seuils sont des points de départ à recalibrer après les premières mesures.
 */
import { RecordingLLM, aCharacter, aWorld, simStateOf } from '@ai-reality/testkit';
import { describe, expect, it } from 'vitest';
import { LlmDialogue } from '../../src/interaction/llm-dialogue.js';
import { LlmDecisionPolicy } from '../../src/decision/llm-policy.js';
import { ScriptedDecisionPolicy } from '../../src/decision/scripted-policy.js';
import { personaPrompt } from '../../src/character/compile.js';
import { Rng } from '../../src/core/rng.js';
import type { LlmCallRecord } from '../../src/llm/index.js';
import { relKey } from '../../src/state/types.js';
import { C, dialogueInput, option } from '../helpers/llm-kit.js';

const RUNS = 20;
const hasKey = (process.env.ANTHROPIC_API_KEY ?? '') !== '';

/** Tarifs ($ par million de jetons, skill claude-api, 2026-09-25) : entrée, sortie, lecture de cache. */
const PRICES: Readonly<Record<string, readonly [number, number, number]>> = {
  'claude-sonnet-5-5': [2, 10, 0.2],
  'claude-haiku-4-5': [1, 5, 0.1],
};

function report(label: string, records: readonly LlmCallRecord[]): void {
  let dollars = 0;
  for (const r of records) {
    const [input, output, cached] = PRICES[r.model] ?? PRICES['claude-sonnet-5-5']!;
    const cachedTokens = r.cachedTokens ?? 0;
    dollars +=
      (((r.inputTokens ?? 0) - cachedTokens) * input + (r.outputTokens ?? 0) * output + cachedTokens * cached) / 1e6;
  }
  const latencies = records.map((r) => r.latencyMs ?? 0).sort((a, b) => a - b);
  console.info(
    `[live] ${JSON.stringify({
      label,
      calls: records.length,
      dollars: Number(dollars.toFixed(4)),
      latencyMsP50: latencies[Math.floor(latencies.length / 2)] ?? 0,
      latencyMsMax: latencies.at(-1) ?? 0,
      inputTokens: records.reduce((t, r) => t + (r.inputTokens ?? 0), 0),
      cachedTokens: records.reduce((t, r) => t + (r.cachedTokens ?? 0), 0),
      outputTokens: records.reduce((t, r) => t + (r.outputTokens ?? 0), 0),
    })}`,
  );
}

async function liveLlm(): Promise<RecordingLLM> {
  const { anthropicLLM } = await import('../../../llm-anthropic/src/index.js');
  return new RecordingLLM(anthropicLLM());
}

describe.skipIf(!hasKey)('évaluations live des agents', () => {
  it('cohérence de persona : le loyal trahit moins souvent que le manipulateur', async () => {
    const llm = await liveLlm();
    const betrayal = new Set(['break_alliance', 'accuse', 'sabotage']);
    const options = [
      option('small_talk', C.sarah),
      option('compliment', C.sarah),
      option('comfort', C.sarah),
      option('break_alliance', C.sarah),
      option('accuse', C.sarah),
      option('rest'),
    ];

    async function betrayalRate(loyalty: number, manipulation: number): Promise<number> {
      const fixture = aWorld()
        .withCharacters(
          aCharacter('alexandre').withTrait('loyalty', loyalty).withTrait('manipulation', manipulation),
          aCharacter('sarah'),
          aCharacter('thomas'),
        )
        .build();
      const state = simStateOf(fixture);
      for (const id of Object.keys(state.characters)) {
        state.positions[id] = { kind: 'at', locationId: fixture.locations[0]?.id ?? '', zoneId: null };
      }
      const edge = state.relationships[relKey(C.alexandre, C.sarah)];
      if (edge) Object.assign(edge, { alliance: 70, trust: 70, acquaintance: 'close' });
      const persona = (id: string): string => {
        const record = fixture.characters.find((c) => c.id === id);
        return record ? personaPrompt(record) : '';
      };
      const policy = new LlmDecisionPolicy({ llm, persona, destination: new ScriptedDecisionPolicy() });
      let betrayals = 0;
      for (let i = 0; i < RUNS; i++) {
        const { chosen } = await policy.choose({ actorId: C.alexandre, state, options, rng: Rng.derive('live', i) });
        if (chosen && betrayal.has(chosen.action)) betrayals += 1;
      }
      return betrayals / RUNS;
    }

    const loyal = await betrayalRate(95, 5);
    const manipulator = await betrayalRate(5, 95);
    console.info(`[live] ${JSON.stringify({ label: 'persona', loyal, manipulator })}`);
    report('persona', llm.records);
    expect(loyal).toBeLessThan(manipulator);
    expect(manipulator - loyal).toBeGreaterThanOrEqual(0.2);
  });

  it('taux de vérification des dialogues ≥ 90 %', async () => {
    const llm = await liveLlm();
    const fixture = aWorld().build();
    const persona = (id: string): string => {
      const record = fixture.characters.find((c) => c.id === id);
      return record ? personaPrompt(record) : '';
    };
    const state = simStateOf(fixture);
    for (const id of Object.keys(state.characters)) {
      state.positions[id] = { kind: 'at', locationId: fixture.locations[0]?.id ?? '', zoneId: null };
    }
    const dialogue = new LlmDialogue({ llm, persona });
    const cases: readonly (readonly [string, string])[] = [
      ['propose_alliance', 'accepted'],
      ['propose_alliance', 'accepted_conditional'],
      ['propose_alliance', 'refused'],
      ['propose_alliance', 'deflected'],
      ['compliment', 'accepted'],
      ['provoke', 'escalated'],
      ['accuse', 'refused'],
      ['apologize', 'accepted'],
      ['small_talk', 'accepted'],
      ['request_favor', 'refused'],
    ];
    let verified = 0;
    let firstTry = 0;
    for (const [action, outcome] of cases) {
      const result = await dialogue.generate(dialogueInput(state, option(action, C.sarah), outcome));
      if (result.verification?.verified === true) verified += 1;
      if (result.verification?.verified === true && result.verification.attempts === 1) firstTry += 1;
    }
    console.info(`[live] ${JSON.stringify({ label: 'verification', cases: cases.length, verified, firstTry })}`);
    report('verification', llm.records);
    expect(verified / cases.length).toBeGreaterThanOrEqual(0.9);
  });
});

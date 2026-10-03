import { describe, expect, it } from 'vitest';
import type { LlmCallRecord } from '@ai-reality/engine/llm';
import { fixedId } from '../fixtures/ids.js';
import { type HarnessRef, expectCode } from './support.js';

const EPOCH_A = fixedId(0, 900);
const EPOCH_B = fixedId(0, 901);

function call(n: number, overrides: Partial<LlmCallRecord> = {}): LlmCallRecord {
  return {
    id: fixedId(0, 910 + n),
    epochId: EPOCH_A,
    characterId: null,
    purpose: 'speak',
    model: 'claude-sonnet-5-5',
    promptHash: `hash-${String(n)}`,
    request: {
      tier: 'dialogue',
      system: { stable: 'persona', variable: null },
      messages: [{ role: 'user', content: `tour ${String(n)}` }],
      schema: null,
      temperature: 0.7,
      maxTokens: 512,
    },
    response: { text: `{"ok":${String(n)}}`, data: { ok: n } },
    inputTokens: 120,
    outputTokens: 30,
    cachedTokens: 100,
    latencyMs: 850,
    createdAt: new Date(Date.UTC(2026, 9, 3, 12, 0, n)),
    ...overrides,
  };
}

export function llmCallsContract(h: HarnessRef): void {
  describe('appels LLM (llm_call)', () => {
    it('un appel inséré se relit à l’identique, avec les nouveaux objectifs et des champs nuls', async () => {
      const full = call(1, { purpose: 'compile_directive' });
      const sparse = call(2, {
        purpose: 'verify',
        epochId: null,
        response: { text: 'ok', data: null },
        inputTokens: null,
        outputTokens: null,
        cachedTokens: null,
        latencyMs: null,
      });
      await h().storage.tx(async (s) => {
        await s.llmCalls.insert(full);
        await s.llmCalls.insert(sparse);
      });
      const byHash = await h().storage.tx(async (s) => ({
        full: await s.llmCalls.findByPromptHash(full.promptHash),
        sparse: await s.llmCalls.findByPromptHash(sparse.promptHash),
        none: await s.llmCalls.findByPromptHash('inconnu'),
      }));
      expect(byHash.full).toEqual([full]);
      expect(byHash.sparse).toEqual([sparse]);
      expect(byHash.none).toEqual([]);
    });

    it('findByPromptHash renvoie tous les appels du même prompt, du plus ancien au plus récent', async () => {
      const first = call(3, { promptHash: 'same' });
      const second = call(4, { promptHash: 'same' });
      await h().storage.tx(async (s) => {
        await s.llmCalls.insert(second);
        await s.llmCalls.insert(first);
      });
      expect(await h().storage.tx((s) => s.llmCalls.findByPromptHash('same'))).toEqual([first, second]);
    });

    it('listByEpoch ne renvoie que l’époque demandée, dans l’ordre de création', async () => {
      const a1 = call(5);
      const a2 = call(6);
      const b1 = call(7, { epochId: EPOCH_B });
      await h().storage.tx(async (s) => {
        await s.llmCalls.insert(a2);
        await s.llmCalls.insert(b1);
        await s.llmCalls.insert(a1);
      });
      expect(await h().storage.tx((s) => s.llmCalls.listByEpoch(EPOCH_A))).toEqual([a1, a2]);
      expect(await h().storage.tx((s) => s.llmCalls.listByEpoch(EPOCH_B))).toEqual([b1]);
      expect(await h().storage.tx((s) => s.llmCalls.listByEpoch(fixedId(0, 999)))).toEqual([]);
    });

    it('un identifiant en double est rejeté (DUPLICATE) et la transaction est annulée', async () => {
      await h().storage.tx((s) => s.llmCalls.insert(call(8)));
      await expectCode(
        h().storage.tx(async (s) => {
          await s.llmCalls.insert(call(9));
          await s.llmCalls.insert(call(8, { promptHash: 'autre' }));
        }),
        'DUPLICATE',
      );
      expect(await h().storage.tx((s) => s.llmCalls.listByEpoch(EPOCH_A))).toHaveLength(1);
    });
  });
}

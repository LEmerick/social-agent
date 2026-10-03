import type { PromptFingerprint } from './prompt-hash.js';
import { promptFingerprint, hashFingerprint } from './prompt-hash.js';
import type { LlmPurpose, LlmRequest, LlmResult } from './port.js';

/** Un appel LLM tel que stocké dans `llm_call` (voir le modèle `LlmCall` de `05-evenements.prisma`). */
export interface LlmCallRecord {
  readonly id: string;
  readonly epochId: string | null;
  readonly characterId: string | null;
  readonly purpose: LlmPurpose;
  readonly model: string;
  readonly promptHash: string;
  readonly request: PromptFingerprint;
  readonly response: { readonly text: string; readonly data: unknown };
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cachedTokens: number | null;
  readonly latencyMs: number | null;
  readonly createdAt: Date;
}

export function buildCallRecord(req: LlmRequest, result: LlmResult, createdAt: Date): LlmCallRecord {
  const request = promptFingerprint(req);
  return {
    id: result.llmCallId,
    epochId: req.epochId ?? null,
    characterId: req.characterId ?? null,
    purpose: req.purpose,
    model: result.model,
    promptHash: hashFingerprint(request),
    request,
    response: { text: result.text, data: result.data ?? null },
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cachedTokens: result.usage.cachedTokens,
    latencyMs: Math.round(result.latencyMs),
    createdAt,
  };
}

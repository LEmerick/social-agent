import type { StorageTx } from '@ai-reality/engine';
import type { LlmCallRecord, PromptFingerprint } from '@ai-reality/engine/llm';
import type { LlmCall } from '@prisma/client';
import { type Db, guard, toJson } from './support.js';

const ORDER = [{ createdAt: 'asc' }, { id: 'asc' }] as const;

function toRecord(row: LlmCall): LlmCallRecord {
  const response = row.response as { text?: string; data?: unknown } | null;
  return {
    id: row.id,
    epochId: row.epochId,
    characterId: row.characterId,
    purpose: row.purpose,
    model: row.model,
    promptHash: row.promptHash,
    request: row.request as unknown as PromptFingerprint,
    response: { text: response?.text ?? '', data: response?.data ?? null },
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedTokens: row.cachedTokens,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt,
  };
}

/** Appels LLM tracés (`llm_call`). */
export function llmRepos(db: Db): Pick<StorageTx, 'llmCalls'> {
  return {
    llmCalls: {
      insert: (r) =>
        guard(async () => {
          await db.llmCall.create({
            data: {
              id: r.id,
              epochId: r.epochId,
              characterId: r.characterId,
              purpose: r.purpose,
              model: r.model,
              promptHash: r.promptHash,
              request: toJson(r.request),
              response: toJson(r.response),
              inputTokens: r.inputTokens,
              outputTokens: r.outputTokens,
              cachedTokens: r.cachedTokens,
              latencyMs: r.latencyMs,
              createdAt: r.createdAt,
            },
          });
        }),
      findByPromptHash: async (promptHash) =>
        (await db.llmCall.findMany({ where: { promptHash }, orderBy: [...ORDER] })).map(toRecord),
      listByEpoch: async (epochId) =>
        (await db.llmCall.findMany({ where: { epochId }, orderBy: [...ORDER] })).map(toRecord),
    },
  };
}

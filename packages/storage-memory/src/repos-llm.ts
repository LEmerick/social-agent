import type { StorageTx } from '@ai-reality/engine';
import type { LlmCallRecord } from '@ai-reality/engine/llm';
import { type Db, cmp, copy, duplicate, later } from './db.js';

const byCreation = (a: LlmCallRecord, b: LlmCallRecord): number =>
  a.createdAt.getTime() - b.createdAt.getTime() || cmp(a.id, b.id);

/** Appels LLM tracés (`llm_call`). */
export function llmRepos(db: Db): Pick<StorageTx, 'llmCalls'> {
  return {
    llmCalls: {
      insert: (record) =>
        later(() => {
          if (db.llmCalls.has(record.id)) throw duplicate(`Appel LLM ${record.id}`);
          db.llmCalls.set(record.id, copy(record));
        }),
      findByPromptHash: (promptHash) =>
        later(() =>
          [...db.llmCalls.values()]
            .filter((c) => c.promptHash === promptHash)
            .sort(byCreation)
            .map(copy),
        ),
      listByEpoch: (epochId) =>
        later(() =>
          [...db.llmCalls.values()]
            .filter((c) => c.epochId === epochId)
            .sort(byCreation)
            .map(copy),
        ),
    },
  };
}

import {
  type LLMPort,
  type LlmCallRecord,
  type LlmRequest,
  type LlmResult,
  buildCallRecord,
} from '@ai-reality/engine/llm';

/**
 * Enveloppe un LLM et produit un `LlmCallRecord` (forme de la table `llm_call`) pour chaque appel réussi.
 * `records` s'insère telle quelle via `StorageTx.llmCalls.insert`. L'horloge est injectable pour des dates stables.
 */
export class RecordingLLM implements LLMPort {
  readonly records: LlmCallRecord[] = [];

  constructor(
    private readonly inner: LLMPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async complete<T = unknown>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const result = await this.inner.complete(req);
    this.records.push(buildCallRecord(req, result, this.now()));
    return result;
  }
}

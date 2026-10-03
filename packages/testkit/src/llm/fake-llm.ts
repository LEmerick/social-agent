import {
  type LLMPort,
  type LlmPurpose,
  type LlmRequest,
  type LlmResult,
  deriveUuid,
  llmUnavailable,
  parseStructuredOutput,
  promptHash,
} from '@ai-reality/engine/llm';

/** Texte brut, objet (sérialisé en JSON), erreur à lever, ou fonction de la requête et du rang d'appel de la règle. */
export type FakeReply =
  | string
  | Error
  | Readonly<Record<string, unknown>>
  | readonly unknown[]
  | ((req: LlmRequest, n: number) => string | Error | Readonly<Record<string, unknown>> | readonly unknown[]);

export interface FakeRule {
  /** Filtre sur l'objectif (facultatif). */
  readonly purpose?: LlmPurpose;
  /** Prédicat sur la requête (facultatif). Les deux filtres se cumulent. */
  readonly when?: (req: LlmRequest) => boolean;
  /**
   * Réponses consommées dans l'ordre à chaque appel qui correspond à la règle ; la dernière se répète.
   * Exemple : `['pas du json', { ok: true }]` ⇒ échec puis succès.
   */
  readonly replies: readonly FakeReply[];
}

export interface FakeLLMOptions {
  readonly model?: string;
  readonly rules?: readonly FakeRule[];
}

/**
 * LLM scripté pour les tests : la première règle qui correspond répond. Sans règle correspondante,
 * l'appel échoue en `LLM_UNAVAILABLE`. Toutes les requêtes reçues sont conservées dans `requests`.
 */
export class FakeLLM implements LLMPort {
  readonly requests: LlmRequest[] = [];
  private readonly rules: FakeRule[];
  private readonly counts = new Map<FakeRule, number>();
  private readonly model: string;
  private seq = 0;

  constructor(options: FakeLLMOptions = {}) {
    this.rules = [...(options.rules ?? [])];
    this.model = options.model ?? 'fake-llm';
  }

  /** Ajoute une règle (évaluée après les précédentes) ; renvoie `this` pour chaîner. */
  on(rule: FakeRule): this {
    this.rules.push(rule);
    return this;
  }

  /** Requêtes reçues, filtrées par objectif. */
  requestsFor(purpose: LlmPurpose): LlmRequest[] {
    return this.requests.filter((r) => r.purpose === purpose);
  }

  complete<T = unknown>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    this.requests.push(req);
    const rule = this.rules.find(
      (r) => (r.purpose === undefined || r.purpose === req.purpose) && (r.when?.(req) ?? true),
    );
    if (!rule) {
      return Promise.reject(llmUnavailable(`FakeLLM : aucune règle pour l'appel « ${req.purpose} »`));
    }
    const n = this.counts.get(rule) ?? 0;
    this.counts.set(rule, n + 1);
    const entry = rule.replies[Math.min(n, rule.replies.length - 1)];
    if (entry === undefined) return Promise.reject(llmUnavailable('FakeLLM : règle sans réponse'));

    try {
      const reply = typeof entry === 'function' ? entry(req, n) : entry;
      if (reply instanceof Error) throw reply;
      const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
      const result: LlmResult<T> = {
        text,
        ...(req.output ? { data: parseStructuredOutput(text, req.output) } : {}),
        llmCallId: deriveUuid(`fake:${promptHash(req)}:${String(this.seq++)}`),
        model: this.model,
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        latencyMs: 0,
      };
      return Promise.resolve(result);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

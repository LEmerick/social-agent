import OpenAI from 'openai';
import {
  type LLMPort,
  type LlmCallRecord,
  type LlmRequest,
  type LlmResult,
  LlmInvalidOutputError,
  buildCallRecord,
  jsonSchemaOf,
  llmUnavailable,
  parseStructuredOutput,
} from '@ai-reality/engine/llm';
import { randomUUID } from 'node:crypto';
import { DEFAULT_MODELS, type ModelMap, acceptsEffort, acceptsTemperature, modelFor } from './models.js';

type Params = OpenAI.Responses.ResponseCreateParamsNonStreaming;
type Response = OpenAI.Responses.Response;

/** Ce que l'adaptateur utilise du SDK : permet d'injecter un faux client dans les tests. */
export interface OpenAIClientLike {
  readonly responses: {
    create(params: Params): PromiseLike<Response>;
  };
}

export interface OpenAILLMOptions {
  /** Client SDK (ou double). À défaut : `new OpenAI({ apiKey })`. */
  readonly client?: OpenAIClientLike;
  readonly apiKey?: string;
  readonly models?: Partial<ModelMap>;
  /** Appelé pour chaque réponse reçue, y compris quand la sortie se révèle invalide ensuite (traçabilité, coûts). */
  readonly onCall?: (record: LlmCallRecord) => void | Promise<void>;
  /** Horloge monotone en millisecondes (défaut `performance.now`) ; sert à mesurer la latence. */
  readonly now?: () => number;
  /** Générateur d'identifiant d'appel (défaut `randomUUID`). */
  readonly newId?: () => string;
}

const DEFAULT_MAX_TOKENS = 4_096;

/**
 * Construit la requête SDK (API Responses). Exportée pour pouvoir être inspectée dans les tests.
 *
 * Le bloc `stable` (persona, règles du monde) part en `instructions`, en tête du prompt : le cache de préfixe
 * automatique d'OpenAI le réutilise d'un appel à l'autre. Le bloc `variable` suit, en message `developer`.
 * Le schéma est envoyé en mode non strict (le mode strict exige que tout champ soit requis) ; Zod valide côté client.
 */
export function buildResponseParams(req: LlmRequest, model: string): Params {
  const input: OpenAI.Responses.ResponseInputItem[] = [];
  if (req.system.variable) input.push({ role: 'developer', content: req.system.variable });
  for (const m of req.messages) input.push({ role: m.role, content: m.content });

  return {
    model,
    instructions: req.system.stable,
    input,
    max_output_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    store: false,
    ...(req.temperature !== undefined && acceptsTemperature(model) ? { temperature: req.temperature } : {}),
    ...(req.effort !== undefined && acceptsEffort(model) ? { reasoning: { effort: req.effort } } : {}),
    ...(req.output
      ? {
          text: {
            format: {
              type: 'json_schema' as const,
              name: req.purpose,
              schema: jsonSchemaOf(req.output),
              strict: false,
            },
          },
        }
      : {}),
  };
}

const textOf = (response: Response): { text: string; refused: boolean } => {
  let text = '';
  let refused = false;
  for (const item of response.output) {
    if (item.type !== 'message') continue;
    for (const part of item.content) {
      if (part.type === 'output_text') text += part.text;
      else refused = true;
    }
  }
  return { text, refused };
};

export function openaiLLM(options: OpenAILLMOptions = {}): LLMPort {
  const models: ModelMap = { ...DEFAULT_MODELS, ...options.models };
  const client: OpenAIClientLike =
    options.client ?? new OpenAI(options.apiKey === undefined ? {} : { apiKey: options.apiKey });
  const now = options.now ?? (() => performance.now());
  const newId = options.newId ?? randomUUID;

  return {
    async complete<T = unknown>(req: LlmRequest<T>): Promise<LlmResult<T>> {
      const model = modelFor(models, req.tier);
      const params = buildResponseParams(req, model);

      const started = now();
      let response: Response;
      try {
        response = await client.responses.create(params);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw llmUnavailable(`Appel OpenAI en échec (${model}) : ${detail}`);
      }
      const latencyMs = now() - started;

      const { text, refused } = textOf(response);
      if (refused) throw llmUnavailable(`Appel OpenAI refusé par le modèle (${model})`);
      if (response.status === 'failed' || response.status === 'cancelled') {
        throw llmUnavailable(
          `Appel OpenAI ${response.status} (${model}) : ${response.error?.message ?? 'sans détail'}`,
        );
      }

      const usage = response.usage;
      const base: LlmResult = {
        text,
        llmCallId: newId(),
        model: response.model,
        // Chez OpenAI, `input_tokens` compte déjà tout le prompt ; `cached_tokens` en est la part lue depuis le cache.
        usage: {
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          cachedTokens: usage?.input_tokens_details.cached_tokens ?? 0,
        },
        latencyMs,
      };

      let data: T | undefined;
      let failure: LlmInvalidOutputError | undefined;
      if (req.output) {
        try {
          data = parseStructuredOutput(text, req.output);
        } catch (error) {
          if (!(error instanceof LlmInvalidOutputError)) throw error;
          failure = error;
        }
      }

      // L'appel a eu lieu (et coûté) même si la sortie est inutilisable : on le trace dans les deux cas.
      await options.onCall?.(buildCallRecord(req, data === undefined ? base : { ...base, data }, new Date()));
      if (failure) throw failure;
      return data === undefined ? (base as LlmResult<T>) : { ...base, data };
    },
  };
}

import Anthropic from '@anthropic-ai/sdk';
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
import { DEFAULT_MODELS, type ModelMap, acceptsTemperature, modelFor } from './models.js';

/** Ce que l'adaptateur utilise du SDK : permet d'injecter un faux client dans les tests. */
export interface AnthropicClientLike {
  readonly messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): PromiseLike<Anthropic.Message>;
  };
}

export interface AnthropicLLMOptions {
  /** Client SDK (ou double). À défaut : `new Anthropic({ apiKey })`. */
  readonly client?: AnthropicClientLike;
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
 * Retire les mots-clés que les sorties structurées d'Anthropic n'acceptent pas (bornes, longueurs, motifs).
 * La validation complète reste faite côté client par Zod.
 */
const UNSUPPORTED_KEYS = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'maxItems',
  'uniqueItems',
  'maxProperties',
  'minProperties',
]);

export function toOutputSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toOutputSchema);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (UNSUPPORTED_KEYS.has(key)) continue;
      out[key] = toOutputSchema(v);
    }
    return out;
  }
  return value;
}

/** Construit la requête SDK. Exportée pour pouvoir être inspectée dans les tests. */
export function buildMessageParams(req: LlmRequest, model: string): Anthropic.MessageCreateParamsNonStreaming {
  const system: Anthropic.TextBlockParam[] = [
    // Persona et règles du monde : identiques d'un appel à l'autre ⇒ préfixe mis en cache.
    { type: 'text', text: req.system.stable, cache_control: { type: 'ephemeral' } },
  ];
  if (req.system.variable) system.push({ type: 'text', text: req.system.variable });

  return {
    model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    system,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(req.temperature !== undefined && acceptsTemperature(model) ? { temperature: req.temperature } : {}),
    ...(req.output
      ? {
          output_config: {
            format: {
              type: 'json_schema',
              schema: toOutputSchema(jsonSchemaOf(req.output)) as Record<string, unknown>,
            },
          },
        }
      : {}),
  };
}

export function anthropicLLM(options: AnthropicLLMOptions = {}): LLMPort {
  const models: ModelMap = { ...DEFAULT_MODELS, ...options.models };
  const client: AnthropicClientLike =
    options.client ?? new Anthropic(options.apiKey === undefined ? {} : { apiKey: options.apiKey });
  const now = options.now ?? (() => performance.now());
  const newId = options.newId ?? randomUUID;

  return {
    async complete<T = unknown>(req: LlmRequest<T>): Promise<LlmResult<T>> {
      const model = modelFor(models, req.tier);
      const params = buildMessageParams(req, model);

      const started = now();
      let message: Anthropic.Message;
      try {
        message = await client.messages.create(params);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw llmUnavailable(`Appel Anthropic en échec (${model}) : ${detail}`);
      }
      const latencyMs = now() - started;

      if (message.stop_reason === 'refusal') {
        throw llmUnavailable(`Appel Anthropic refusé par le modèle (${model})`);
      }

      const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      const cached = message.usage.cache_read_input_tokens ?? 0;
      const created = message.usage.cache_creation_input_tokens ?? 0;
      const base: LlmResult = {
        text,
        llmCallId: newId(),
        model: message.model,
        // `inputTokens` = tout le prompt (non caché + écrit au cache + lu depuis le cache) ; `cachedTokens` en est la part lue.
        usage: {
          inputTokens: message.usage.input_tokens + created + cached,
          outputTokens: message.usage.output_tokens,
          cachedTokens: cached,
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

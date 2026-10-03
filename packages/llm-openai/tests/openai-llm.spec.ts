import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { type LlmCallRecord, type LlmRequest, promptHash, z } from '@ai-reality/engine/llm';
import { type OpenAIClientLike, DEFAULT_MODELS, acceptsEffort, acceptsTemperature, openaiLLM } from '../src/index.js';

type Params = OpenAI.Responses.ResponseCreateParamsNonStreaming;
type Response = OpenAI.Responses.Response;

const Reply = z.object({ line: z.string().min(1), mood: z.number().int().min(0).max(100) });

interface Usage {
  readonly input?: number;
  readonly output?: number;
  readonly cached?: number;
}

function response(
  text: string,
  usage: Usage = {},
  model = 'gpt-6.1-sol',
  part: 'output_text' | 'refusal' = 'output_text',
): Response {
  const content =
    part === 'output_text' ? { type: 'output_text', text, annotations: [] } : { type: 'refusal', refusal: text };
  return {
    id: 'resp_1',
    object: 'response',
    model,
    status: 'completed',
    error: null,
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [content] },
    ],
    usage: {
      input_tokens: usage.input ?? 10,
      input_tokens_details: { cached_tokens: usage.cached ?? 0, cache_write_tokens: 0 },
      output_tokens: usage.output ?? 5,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: (usage.input ?? 10) + (usage.output ?? 5),
    },
  } as unknown as Response;
}

function fakeClient(reply: () => Response | Error) {
  const calls: Params[] = [];
  const client: OpenAIClientLike = {
    responses: {
      create: (params) => {
        calls.push(params);
        const r = reply();
        return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
      },
    },
  };
  return { client, calls };
}

const req: LlmRequest<z.infer<typeof Reply>> = {
  purpose: 'speak',
  tier: 'dialogue',
  system: { stable: 'Persona de Sarah', variable: 'Il est midi' },
  messages: [{ role: 'user', content: 'Que dis-tu ?' }],
  output: Reply,
  temperature: 0.8,
  maxTokens: 500,
  characterId: 'perso-1',
  epochId: 'epoque-1',
};

describe('openaiLLM — forme de la requête', () => {
  it('dialogue : modèle capable, bloc stable en instructions, variable en developer, schéma JSON non strict', async () => {
    const { client, calls } = fakeClient(() => response('{"line":"salut","mood":5}'));
    await openaiLLM({ client }).complete(req);
    const params = calls[0];
    expect(params?.model).toBe('gpt-6.1-sol');
    expect(params?.max_output_tokens).toBe(500);
    expect(params?.store).toBe(false);
    expect(params?.instructions).toBe('Persona de Sarah');
    expect(params?.input).toEqual([
      { role: 'developer', content: 'Il est midi' },
      { role: 'user', content: 'Que dis-tu ?' },
    ]);
    expect(params).not.toHaveProperty('temperature');
    expect(params?.text?.format).toEqual({
      type: 'json_schema',
      name: 'speak',
      strict: false,
      schema: {
        type: 'object',
        properties: {
          line: { type: 'string', minLength: 1 },
          mood: { type: 'integer', minimum: 0, maximum: 100 },
        },
        required: ['line', 'mood'],
        additionalProperties: false,
      },
    });
  });

  it('fast : modèle rapide, sans bloc variable ni schéma', async () => {
    const { client, calls } = fakeClient(() => response('ok', {}, 'gpt-6-luna'));
    const rest = { ...req, output: undefined };
    await openaiLLM({ client }).complete({ ...rest, tier: 'fast', system: { stable: 'P' } });
    expect(calls[0]?.model).toBe('gpt-6-luna');
    expect(calls[0]?.instructions).toBe('P');
    expect(calls[0]?.input).toEqual([{ role: 'user', content: 'Que dis-tu ?' }]);
    expect(calls[0]).not.toHaveProperty('text');
  });

  it('effort : transmis en reasoning.effort aux modèles de raisonnement ; température transmise aux autres', async () => {
    const { client, calls } = fakeClient(() => response('{"line":"salut","mood":5}'));
    await openaiLLM({ client }).complete({ ...req, effort: 'medium' });
    expect(calls[0]?.reasoning).toEqual({ effort: 'medium' });

    const old = fakeClient(() => response('{"line":"salut","mood":5}', {}, 'gpt-4.1'));
    await openaiLLM({ client: old.client, models: { dialogue: 'gpt-4.1' } }).complete({ ...req, effort: 'low' });
    expect(old.calls[0]).not.toHaveProperty('reasoning');
    expect(old.calls[0]?.temperature).toBe(0.8);
  });

  it('acceptsEffort / acceptsTemperature : familles o et GPT-5+ en raisonnement, GPT-4 non', () => {
    for (const m of ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra', 'gpt-5.5', 'o3']) {
      expect(acceptsEffort(m)).toBe(true);
      expect(acceptsTemperature(m)).toBe(false);
    }
    for (const m of ['gpt-4.1', 'gpt-4o-mini']) {
      expect(acceptsEffort(m)).toBe(false);
      expect(acceptsTemperature(m)).toBe(true);
    }
  });

  it('modèles surchargeables ; maxTokens par défaut', async () => {
    const { client, calls } = fakeClient(() => response('ok'));
    const rest = { ...req, output: undefined, maxTokens: undefined };
    await openaiLLM({ client, models: { fast: 'gpt-6-astra' } }).complete({ ...rest, tier: 'fast' });
    expect(calls[0]?.model).toBe('gpt-6-astra');
    expect(calls[0]?.max_output_tokens).toBe(4096);
    expect(DEFAULT_MODELS).toEqual({ dialogue: 'gpt-6.1-sol', fast: 'gpt-6-luna' });
  });
});

describe('openaiLLM — réponse', () => {
  it('parse et valide la sortie, mappe l’usage (dont jetons cachés), mesure la latence, appelle onCall', async () => {
    const { client } = fakeClient(() => response('{"line":"salut","mood":5}', { input: 450, cached: 400, output: 12 }));
    const clock = [1_000, 1_250];
    const records: LlmCallRecord[] = [];
    const llm = openaiLLM({
      client,
      now: () => clock.shift() ?? 0,
      newId: () => 'call-1',
      onCall: (r) => void records.push(r),
    });
    const result = await llm.complete(req);

    expect(result.data).toEqual({ line: 'salut', mood: 5 });
    expect(result.text).toBe('{"line":"salut","mood":5}');
    expect(result.llmCallId).toBe('call-1');
    expect(result.model).toBe('gpt-6.1-sol');
    expect(result.usage).toEqual({ inputTokens: 450, outputTokens: 12, cachedTokens: 400 });
    expect(result.latencyMs).toBe(250);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'call-1',
      purpose: 'speak',
      model: 'gpt-6.1-sol',
      promptHash: promptHash(req),
      characterId: 'perso-1',
      epochId: 'epoque-1',
      inputTokens: 450,
      outputTokens: 12,
      cachedTokens: 400,
      latencyMs: 250,
      response: { text: '{"line":"salut","mood":5}', data: { line: 'salut', mood: 5 } },
    });
  });

  it('sortie invalide ⇒ LLM_INVALID_OUTPUT avec le texte brut, mais l’appel est tout de même tracé', async () => {
    const { client } = fakeClient(() => response('{"line":"","mood":500}'));
    const records: LlmCallRecord[] = [];
    const llm = openaiLLM({ client, onCall: (r) => void records.push(r) });
    await expect(llm.complete(req)).rejects.toMatchObject({
      code: 'LLM_INVALID_OUTPUT',
      rawText: '{"line":"","mood":500}',
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.response).toEqual({ text: '{"line":"","mood":500}', data: null });
  });

  it('sans schéma : texte seul, pas de data', async () => {
    const { client } = fakeClient(() => response('Bonjour'));
    const result = await openaiLLM({ client }).complete({ ...req, output: undefined });
    expect(result.text).toBe('Bonjour');
    expect(result).not.toHaveProperty('data');
  });

  it('erreur du SDK, refus ou réponse en échec ⇒ LLM_UNAVAILABLE', async () => {
    const down = fakeClient(() => new Error('connexion refusée'));
    await expect(openaiLLM({ client: down.client }).complete(req)).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });

    const refused = fakeClient(() => response('Je ne peux pas.', {}, 'gpt-6.1-sol', 'refusal'));
    await expect(openaiLLM({ client: refused.client }).complete(req)).rejects.toMatchObject({
      code: 'LLM_UNAVAILABLE',
    });

    const failed = fakeClient(() => ({ ...response(''), status: 'failed' }) as Response);
    await expect(openaiLLM({ client: failed.client }).complete(req)).rejects.toMatchObject({
      code: 'LLM_UNAVAILABLE',
    });
  });
});

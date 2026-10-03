import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { type LlmCallRecord, type LlmRequest, promptHash, z } from '@ai-reality/engine/llm';
import { type AnthropicClientLike, DEFAULT_MODELS, anthropicLLM, toOutputSchema } from '../src/index.js';

const Reply = z.object({ line: z.string().min(1), mood: z.number().int().min(0).max(100) });

function message(text: string, usage: Partial<Anthropic.Usage> = {}, model = 'claude-sonnet-5-5'): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      ...usage,
    },
  } as unknown as Anthropic.Message;
}

function fakeClient(reply: () => Anthropic.Message | Error) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: AnthropicClientLike = {
    messages: {
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

describe('anthropicLLM — forme de la requête', () => {
  it('dialogue : modèle capable, cache_control sur le bloc stable seul, schéma JSON, température omise (Sonnet 5.5)', async () => {
    const { client, calls } = fakeClient(() => message('{"line":"salut","mood":5}'));
    await anthropicLLM({ client }).complete(req);
    const params = calls[0];
    expect(params?.model).toBe('claude-sonnet-5-5');
    expect(params?.max_tokens).toBe(500);
    expect(params?.system).toEqual([
      { type: 'text', text: 'Persona de Sarah', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Il est midi' },
    ]);
    expect(params?.messages).toEqual([{ role: 'user', content: 'Que dis-tu ?' }]);
    expect(params).not.toHaveProperty('temperature');
    expect(params?.output_config?.format).toEqual({
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: { line: { type: 'string' }, mood: { type: 'integer' } },
        required: ['line', 'mood'],
        additionalProperties: false,
      },
    });
    expect(params).not.toHaveProperty('tool_choice');
  });

  it('fast : modèle rapide, température transmise (Haiku 4.5), sans bloc variable ni schéma', async () => {
    const { client, calls } = fakeClient(() => message('ok', {}, 'claude-haiku-4-5'));
    const rest = { ...req, output: undefined };
    await anthropicLLM({ client }).complete({ ...rest, tier: 'fast', system: { stable: 'P' } });
    expect(calls[0]?.model).toBe('claude-haiku-4-5');
    expect(calls[0]?.temperature).toBe(0.8);
    expect(calls[0]?.system).toEqual([{ type: 'text', text: 'P', cache_control: { type: 'ephemeral' } }]);
    expect(calls[0]).not.toHaveProperty('output_config');
  });

  it('modèles surchargeables ; maxTokens par défaut', async () => {
    const { client, calls } = fakeClient(() => message('ok'));
    const rest = { ...req, output: undefined, maxTokens: undefined };
    await anthropicLLM({ client, models: { fast: 'claude-sonnet-5' } }).complete({ ...rest, tier: 'fast' });
    expect(calls[0]?.model).toBe('claude-sonnet-5');
    expect(calls[0]?.max_tokens).toBe(4096);
    expect(DEFAULT_MODELS).toEqual({ dialogue: 'claude-sonnet-5-5', fast: 'claude-haiku-4-5' });
  });

  it('toOutputSchema retire les bornes non supportées, récursivement', () => {
    expect(
      toOutputSchema({
        type: 'object',
        properties: {
          a: { type: 'string', minLength: 1, maxLength: 3 },
          b: { type: 'array', items: { type: 'number', minimum: 0 } },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'number' } } },
    });
  });
});

describe('anthropicLLM — réponse', () => {
  it('parse et valide la sortie, mappe l’usage (dont jetons cachés), mesure la latence, appelle onCall', async () => {
    const { client } = fakeClient(() =>
      message('{"line":"salut","mood":5}', {
        input_tokens: 20,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 400,
        output_tokens: 12,
      }),
    );
    const clock = [1_000, 1_250];
    const records: LlmCallRecord[] = [];
    const llm = anthropicLLM({
      client,
      now: () => clock.shift() ?? 0,
      newId: () => 'call-1',
      onCall: (r) => void records.push(r),
    });
    const result = await llm.complete(req);

    expect(result.data).toEqual({ line: 'salut', mood: 5 });
    expect(result.text).toBe('{"line":"salut","mood":5}');
    expect(result.llmCallId).toBe('call-1');
    expect(result.model).toBe('claude-sonnet-5-5');
    expect(result.usage).toEqual({ inputTokens: 450, outputTokens: 12, cachedTokens: 400 });
    expect(result.latencyMs).toBe(250);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'call-1',
      purpose: 'speak',
      model: 'claude-sonnet-5-5',
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
    const { client } = fakeClient(() => message('{"line":"","mood":500}'));
    const records: LlmCallRecord[] = [];
    const llm = anthropicLLM({ client, onCall: (r) => void records.push(r) });
    await expect(llm.complete(req)).rejects.toMatchObject({
      code: 'LLM_INVALID_OUTPUT',
      rawText: '{"line":"","mood":500}',
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.response).toEqual({ text: '{"line":"","mood":500}', data: null });
  });

  it('sans schéma : texte seul, pas de data', async () => {
    const { client } = fakeClient(() => message('Bonjour'));
    const rest = { ...req, output: undefined };
    const result = await anthropicLLM({ client }).complete(rest);
    expect(result.text).toBe('Bonjour');
    expect(result).not.toHaveProperty('data');
  });

  it('erreur du SDK ou refus ⇒ LLM_UNAVAILABLE', async () => {
    const down = fakeClient(() => new Error('connexion refusée'));
    await expect(anthropicLLM({ client: down.client }).complete(req)).rejects.toMatchObject({
      code: 'LLM_UNAVAILABLE',
    });

    const refused = fakeClient(() => ({ ...message(''), stop_reason: 'refusal' }) as Anthropic.Message);
    await expect(anthropicLLM({ client: refused.client }).complete(req)).rejects.toMatchObject({
      code: 'LLM_UNAVAILABLE',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { DomainError } from '@ai-reality/engine';
import {
  type LlmRequest,
  LlmInvalidOutputError,
  completeStructured,
  parseStructuredOutput,
  z,
} from '@ai-reality/engine/llm';
import { FakeLLM, RecordingLLM } from '../src/index.js';

const Line = z.object({ line: z.string(), mood: z.number().int() });
const req: LlmRequest<z.infer<typeof Line>> = {
  purpose: 'speak',
  tier: 'dialogue',
  system: { stable: 'persona' },
  messages: [{ role: 'user', content: 'parle' }],
  output: Line,
};

describe('parseStructuredOutput', () => {
  it('accepte du JSON nu ou entouré de barrières ```json', () => {
    expect(parseStructuredOutput('{"line":"a","mood":1}', Line)).toEqual({ line: 'a', mood: 1 });
    expect(parseStructuredOutput('```json\n{"line":"a","mood":1}\n```', Line)).toEqual({ line: 'a', mood: 1 });
  });

  it('JSON invalide ou non conforme ⇒ LLM_INVALID_OUTPUT avec le texte brut', () => {
    for (const raw of ['pas du json', '{"line":"a"}']) {
      const error = (() => {
        try {
          parseStructuredOutput(raw, Line);
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(LlmInvalidOutputError);
      expect((error as LlmInvalidOutputError).code).toBe('LLM_INVALID_OUTPUT');
      expect((error as LlmInvalidOutputError).rawText).toBe(raw);
    }
  });
});

describe('completeStructured', () => {
  it('sortie invalide, nouvel essai, succès : la relance transmet la réponse fautive', async () => {
    const fake = new FakeLLM({ rules: [{ replies: ['pas du json', { line: 'salut', mood: 3 }] }] });
    const result = await completeStructured(fake, req, { retries: 2 });
    expect(result.data).toEqual({ line: 'salut', mood: 3 });
    expect(fake.requests).toHaveLength(2);
    const retry = fake.requests[1];
    expect(retry?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(retry?.messages[1]?.content).toBe('pas du json');
    expect(retry?.messages[2]?.content).toContain('invalide');
  });

  it('invalide à chaque essai ⇒ LLM_INVALID_OUTPUT après exactement `retries` appels', async () => {
    const fake = new FakeLLM({ rules: [{ replies: ['x'] }] });
    await expect(completeStructured(fake, req, { retries: 3 })).rejects.toMatchObject({ code: 'LLM_INVALID_OUTPUT' });
    expect(fake.requests).toHaveLength(3);
  });

  it('un seul essai : pas de relance', async () => {
    const fake = new FakeLLM({ rules: [{ replies: ['x'] }] });
    await expect(completeStructured(fake, req, { retries: 1 })).rejects.toBeInstanceOf(LlmInvalidOutputError);
    expect(fake.requests).toHaveLength(1);
  });

  it('les autres erreurs ne sont pas relancées', async () => {
    const fake = new FakeLLM({ rules: [{ replies: [new DomainError('LLM_UNAVAILABLE', 'panne')] }] });
    await expect(completeStructured(fake, req, { retries: 3 })).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
    expect(fake.requests).toHaveLength(1);
  });
});

describe('FakeLLM', () => {
  it('route par objectif et prédicat, enregistre les requêtes, répète la dernière réponse', async () => {
    const fake = new FakeLLM()
      .on({ purpose: 'evaluate', replies: ['{"x":1}'] })
      .on({ when: (r) => r.messages.length > 1, replies: ['long'] })
      .on({ replies: [(r, n) => `${r.purpose}:${String(n)}`] });

    expect((await fake.complete({ ...req, purpose: 'evaluate', output: undefined })).text).toBe('{"x":1}');
    expect(
      (await fake.complete({ ...req, messages: [...req.messages, ...req.messages], output: undefined })).text,
    ).toBe('long');
    expect((await fake.complete({ ...req, output: undefined })).text).toBe('speak:0');
    expect((await fake.complete({ ...req, output: undefined })).text).toBe('speak:1');
    expect(fake.requests).toHaveLength(4);
    expect(fake.requestsFor('evaluate')).toHaveLength(1);
  });

  it('aucune règle ⇒ LLM_UNAVAILABLE', async () => {
    await expect(new FakeLLM().complete(req)).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
  });
});

describe('RecordingLLM', () => {
  it('produit un LlmCallRecord aligné sur llm_call', async () => {
    const fake = new FakeLLM({ rules: [{ replies: [{ line: 'a', mood: 1 }] }] });
    const rec = new RecordingLLM(fake, () => new Date('2026-10-03T12:00:00Z'));
    const result = await rec.complete({ ...req, characterId: 'perso', epochId: 'epoque' });
    const [record] = rec.records;
    expect(record).toMatchObject({
      id: result.llmCallId,
      characterId: 'perso',
      epochId: 'epoque',
      purpose: 'speak',
      model: 'fake-llm',
      response: { text: '{"line":"a","mood":1}', data: { line: 'a', mood: 1 } },
      createdAt: new Date('2026-10-03T12:00:00Z'),
    });
    expect(record?.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record?.request.tier).toBe('dialogue');
  });
});

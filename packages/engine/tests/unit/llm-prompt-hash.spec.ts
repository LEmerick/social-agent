import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type LlmRequest, canonicalJson, deriveUuid, promptHash } from '../../src/llm/index.js';

const SCHEMA = z.object({ line: z.string(), tone: z.enum(['calme', 'tendu']) });

const base: LlmRequest = {
  purpose: 'speak',
  tier: 'dialogue',
  system: { stable: 'Tu es Sarah.', variable: 'Il est midi.' },
  messages: [{ role: 'user', content: 'Que réponds-tu ?' }],
  output: SCHEMA,
  temperature: 0.7,
  maxTokens: 300,
};

describe('canonicalJson', () => {
  it('trie les clés récursivement et ignore undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: undefined }] } })).toBe('{"a":{"c":[{"z":1}],"d":2},"b":1}');
  });

  it("l'ordre d'insertion des clés n'a aucune influence", () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
});

describe('promptHash', () => {
  it('est un sha256 hexadécimal, stable entre appels et valeur figée', () => {
    const h = promptHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(promptHash({ ...base })).toBe(h);
    expect(h).toBe(promptHash({ ...base, output: z.object({ line: z.string(), tone: z.enum(['calme', 'tendu']) }) }));
  });

  it.each<[string, Partial<LlmRequest>]>([
    ['tier', { tier: 'fast' }],
    ['système stable', { system: { stable: 'Tu es Paul.', variable: 'Il est midi.' } }],
    ['système variable', { system: { stable: 'Tu es Sarah.', variable: 'Il est minuit.' } }],
    ['absence de partie variable', { system: { stable: 'Tu es Sarah.' } }],
    ['message', { messages: [{ role: 'user', content: 'Autre chose ?' }] }],
    ['rôle du message', { messages: [{ role: 'assistant', content: 'Que réponds-tu ?' }] }],
    ['nombre de messages', { messages: [...base.messages, { role: 'user', content: 'Alors ?' }] }],
    ['schéma', { output: z.object({ line: z.string() }) }],
    ['absence de schéma', { output: undefined }],
    ['température', { temperature: 0.2 }],
    ['absence de température', { temperature: undefined }],
    ['maxTokens', { maxTokens: 301 }],
  ])('change quand %s change', (_name, patch) => {
    expect(promptHash({ ...base, ...patch })).not.toBe(promptHash(base));
  });

  it("ignore l'objectif et la traçabilité (personnage, époque)", () => {
    expect(promptHash({ ...base, purpose: 'plan', characterId: 'c', epochId: 'e' })).toBe(promptHash(base));
  });
});

describe('deriveUuid', () => {
  it('est déterministe et ressemble à un UUID', () => {
    expect(deriveUuid('a')).toBe(deriveUuid('a'));
    expect(deriveUuid('a')).not.toBe(deriveUuid('b'));
    expect(deriveUuid('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

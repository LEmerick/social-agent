import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LlmRequest, promptHash, z } from '@ai-reality/engine/llm';
import { FakeLLM, ReplayLLM } from '../src/index.js';

const Reply = z.object({ line: z.string() });
const req: LlmRequest<z.infer<typeof Reply>> = {
  purpose: 'speak',
  tier: 'fast',
  system: { stable: 'persona' },
  messages: [{ role: 'user', content: 'parle' }],
  output: Reply,
  temperature: 0.5,
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cassettes-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('ReplayLLM', () => {
  it('cassette manquante ⇒ LLM_CASSETTE_MISSING avec le hash', async () => {
    const replay = new ReplayLLM({ dir, record: false });
    await expect(replay.complete(req)).rejects.toMatchObject({ code: 'LLM_CASSETTE_MISSING' });
    await expect(replay.complete(req)).rejects.toThrow(promptHash(req));
  });

  it('le mode enregistrement exige un LLM interne', () => {
    expect(() => new ReplayLLM({ dir, record: true })).toThrow(/inner/);
  });

  it('enregistre dans un dossier temporaire, puis rejoue à l’identique sans appeler le LLM interne', async () => {
    const inner = new FakeLLM({ model: 'modele-x', rules: [{ replies: [{ line: 'bonjour' }] }] });
    const recorded = await new ReplayLLM({ dir, record: true, inner }).complete(req);
    expect(inner.requests).toHaveLength(1);
    expect(readdirSync(dir)).toEqual([`${promptHash(req)}.json`]);

    const offline = new ReplayLLM({ dir, record: false });
    const replayed = await offline.complete(req);
    expect(replayed.text).toBe(recorded.text);
    expect(replayed.data).toEqual({ line: 'bonjour' });
    expect(replayed.model).toBe('modele-x');
    expect(replayed.usage).toEqual(recorded.usage);
    expect(inner.requests).toHaveLength(1);
  });

  it('écriture déterministe : clés triées, indentée, retour à la ligne final, requête lisible', async () => {
    const inner = new FakeLLM({ rules: [{ replies: [{ line: 'a' }] }] });
    await new ReplayLLM({ dir, record: true, inner }).complete(req);
    const raw = readFileSync(join(dir, `${promptHash(req)}.json`), 'utf8');
    expect(raw.endsWith('}\n')).toBe(true);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
    expect(parsed).toMatchObject({
      promptHash: promptHash(req),
      purpose: 'speak',
      request: { tier: 'fast', temperature: 0.5, messages: [{ role: 'user', content: 'parle' }] },
      response: { text: '{"line":"a"}' },
    });

    // Un second enregistrement dans un autre dossier produit un fichier strictement identique.
    const other = mkdtempSync(join(tmpdir(), 'cassettes-bis-'));
    try {
      const inner2 = new FakeLLM({ rules: [{ replies: [{ line: 'a' }] }] });
      await new ReplayLLM({ dir: other, record: true, inner: inner2 }).complete(req);
      expect(readFileSync(join(other, `${promptHash(req)}.json`), 'utf8')).toBe(raw);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('en mode enregistrement, une cassette existante est rejouée et non réécrite', async () => {
    const first = new FakeLLM({ rules: [{ replies: [{ line: 'premier' }] }] });
    await new ReplayLLM({ dir, record: true, inner: first }).complete(req);
    const second = new FakeLLM({ rules: [{ replies: [{ line: 'second' }] }] });
    const result = await new ReplayLLM({ dir, record: true, inner: second }).complete(req);
    expect(result.data).toEqual({ line: 'premier' });
    expect(second.requests).toHaveLength(0);
  });

  it('les identifiants d’appel sont déterministes entre deux rejeux et distincts pour une même requête répétée', async () => {
    const inner = new FakeLLM({ rules: [{ replies: [{ line: 'a' }] }] });
    await new ReplayLLM({ dir, record: true, inner }).complete(req);
    const ids = async (): Promise<string[]> => {
      const replay = new ReplayLLM({ dir, record: false });
      return [(await replay.complete(req)).llmCallId, (await replay.complete(req)).llmCallId];
    };
    const [a1, a2] = await ids();
    expect([a1, a2]).toEqual(await ids());
    expect(a1).not.toBe(a2);
  });

  it('une cassette dont la sortie ne respecte pas le schéma ⇒ LLM_INVALID_OUTPUT (rejeu d’un essai raté)', async () => {
    const hash = promptHash(req);
    writeFileSync(
      join(dir, `${hash}.json`),
      JSON.stringify({
        promptHash: hash,
        purpose: 'speak',
        model: 'm',
        request: {},
        response: { text: '{"autre":1}' },
        usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
      }),
    );
    await expect(new ReplayLLM({ dir, record: false }).complete(req)).rejects.toMatchObject({
      code: 'LLM_INVALID_OUTPUT',
    });
  });
});

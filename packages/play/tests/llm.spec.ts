import { FakeLLM } from '@ai-reality/testkit';
import { describe, expect, it } from 'vitest';
import { createPlaySession } from '../src/index.js';
import { passive, playEpoch } from './helpers.js';

describe('session avec LLM', () => {
  it('confie aux LLM les choix, les issues et les dialogues des autres, sans dévoiler leurs coulisses', async () => {
    const llm = new FakeLLM({
      rules: [
        {
          purpose: 'evaluate',
          when: (r) => r.messages[0]?.content.startsWith('Choisis') === true,
          replies: [
            (req) => {
              const line = (req.messages[0]?.content ?? '').split('\n').find((l) => /^\d+\. small_talk/.test(l));
              return { choice: line ? (line.split('.')[0] ?? 'none') : 'none' };
            },
          ],
        },
        { purpose: 'evaluate', replies: [{ outcome: 'accepted', reason: 'Bonne humeur.' }] },
        {
          purpose: 'speak',
          replies: [
            {
              text: 'Bonjour tout le monde !',
              intent: 'small_talk',
              tone: 'léger',
              emotion: 'joie',
              reveals: [],
              mentions: [],
              wantsToContinue: false,
            },
          ],
        },
        { purpose: 'verify', replies: [{ coherent: true, reason: 'Cohérent.' }] },
      ],
    });
    const session = await createPlaySession({ characterSlug: 'alexandre', llm });
    const { requests } = await playEpoch(session, (r) => (r.kind === 'outcome' ? 1 : passive(r, 0)));
    expect(llm.requestsFor('speak').length).toBeGreaterThan(0);
    expect(requests.some((r) => r.kind === 'outcome')).toBe(true);
    const texts = session
      .log()
      .filter((e) => e.kind === 'heard')
      .map((e) => e.text);
    expect(texts.some((t) => t.includes('« Bonjour tout le monde ! »'))).toBe(true);
    // Les consignes et raisons internes du LLM ne sont jamais montrées.
    expect(
      session
        .log()
        .map((e) => e.text)
        .join('\n'),
    ).not.toMatch(/Bonne humeur|Cohérent/);
  }, 60_000);
});

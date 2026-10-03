/**
 * Scénario « alliance » avec agents LLM : mêmes personnages et mêmes destinations que `alliance-suite`, mais l'action,
 * l'issue et le dialogue viennent de `LlmDecisionPolicy`, `LlmOutcomeModel` et `LlmDialogue`.
 *
 * Les cassettes de `packages/testkit/cassettes/alliance/` ont été enregistrées avec `scriptedAllianceLlm()` comme
 * LLM interne (aucune clé API n'était disponible) : `RECORD=1 pnpm vitest run alliance.replay` les régénère.
 * Un changement de prompt change les hashes : relancer l'enregistrement (et, avec une clé, remplacer le LLM interne
 * par `anthropicLLM`) puis relire le diff des cassettes.
 */
import { type LLMPort, type StoragePort, ScriptedDecisionPolicy, personaPrompt } from '@ai-reality/engine';
import { FakeLLM, type WorldFixture } from '@ai-reality/testkit';
import { LlmDecisionPolicy } from '../../src/decision/llm-policy.js';
import { LlmOutcomeModel } from '../../src/decision/llm-outcome.js';
import { LlmDialogue } from '../../src/interaction/llm-dialogue.js';
import { interactionHook } from '../../src/interaction/index.js';
import { economyHook } from '../../src/economy/hook.js';
import { createEpochScheduler } from '../../src/epoch/index.js';
import { C, L, Z, go } from './epoch-kit.js';

export const personasOf =
  (fixture: WorldFixture) =>
  (id: string): string => {
    const record = fixture.characters.find((c) => c.id === id);
    if (!record) throw new Error(`personnage ${id} absent`);
    return personaPrompt(record);
  };

/** LLM déterministe qui joue l'histoire : Alexandre propose une alliance à Sarah, qui accepte sous conditions. */
export function scriptedAllianceLlm(): FakeLLM {
  const asks = (text: string) => (r: { messages: readonly { content: string }[] }) =>
    r.messages[0]?.content.startsWith(text) === true;
  return new FakeLLM({
    model: 'scripted-alliance',
    rules: [
      {
        purpose: 'evaluate',
        when: asks('Choisis'),
        replies: [
          (req) => {
            const stable = req.system.variable ?? '';
            const lines = (req.messages[0]?.content ?? '').split('\n');
            const proposal = lines.find((l) => /^\d+\. propose_alliance → Sarah/.test(l));
            const allied = /alliance [1-9]/.test(stable);
            const alexandre = stable.startsWith('Vous êtes Alexandre');
            return proposal && alexandre && !allied
              ? { choice: proposal.split('.')[0] ?? 'none', reason: 'Je veux Sarah de mon côté.' }
              : { choice: 'none' };
          },
        ],
      },
      {
        purpose: 'evaluate',
        replies: [{ outcome: 'accepted_conditional', reason: 'Sarah accepte, mais veut des garanties.' }],
      },
      {
        purpose: 'speak',
        when: asks('Action en cours'),
        replies: [
          (req) =>
            req.messages[0]?.content.includes('Tu prends la parole')
              ? {
                  text: 'Sarah, toi et moi on irait plus loin ensemble. Une alliance, ça te dit ?',
                  intent: 'propose_alliance',
                  tone: 'posé, séducteur',
                  emotion: 'confiance',
                  reveals: [],
                  mentions: ['Sarah'],
                  wantsToContinue: true,
                }
              : {
                  text: 'D’accord, Alexandre, mais je veux des garanties : pas de coup dans le dos.',
                  intent: 'accept_with_conditions',
                  tone: 'prudent',
                  emotion: 'méfiance',
                  reveals: [],
                  mentions: ['Alexandre'],
                  wantsToContinue: false,
                },
        ],
      },
      {
        purpose: 'verify',
        replies: [{ coherent: true, reason: 'La proposition aboutit à une acceptation conditionnelle.' }],
      },
    ],
  });
}

export function llmScheduler(storage: StoragePort, fixture: WorldFixture, llm: LLMPort) {
  const persona = personasOf(fixture);
  const decision = new LlmDecisionPolicy({
    llm,
    persona,
    destination: new ScriptedDecisionPolicy({
      destinations: { [C.alexandre]: { 0: go(L.jardin, Z.banc) }, [C.sarah]: { 0: go(L.jardin, Z.banc) } },
    }),
  });
  return createEpochScheduler({
    storage,
    decision,
    outcome: new LlmOutcomeModel({ llm, persona }),
    hooks: { tick: [interactionHook({ dialogue: new LlmDialogue({ llm, persona }) })], economy: economyHook() },
  });
}

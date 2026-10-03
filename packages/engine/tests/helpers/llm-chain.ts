/**
 * Scénario « chaîne » avec agents LLM : A→B→C→D comme `chain-suite`, mais les choix d'action (`LlmDecisionPolicy`), les
 * issues (`LlmOutcomeModel`) et les dialogues (`LlmDialogue`) viennent du LLM. Les déplacements restent écrits et
 * l'`AgendaDecisionPolicy` fait exécuter l'intention différée de Sarah.
 *
 * Les cassettes de `packages/testkit/cassettes/chain/` ont été enregistrées avec `scriptedChainLlm()` comme LLM
 * interne (aucune clé API n'était disponible) : `RECORD=1 npx vitest run packages/engine/tests/unit/chain.replay.spec.ts`
 * les régénère. Un changement de prompt change les hashes : relancer l'enregistrement puis relire le diff.
 */
import {
  type LLMPort,
  type SimState,
  type StoragePort,
  AgendaDecisionPolicy,
  ScriptedDecisionPolicy,
  loadSimState,
} from '@ai-reality/engine';
import { FakeLLM, type WorldFixture, aWorld, seedWorld } from '@ai-reality/testkit';
import { LlmDecisionPolicy } from '../../src/decision/llm-policy.js';
import { LlmOutcomeModel } from '../../src/decision/llm-outcome.js';
import { LlmDialogue } from '../../src/interaction/llm-dialogue.js';
import { C, L, Z, go, snapshotOf } from './epoch-kit.js';
import { interactionHook } from '../../src/interaction/index.js';
import { economyHook } from '../../src/economy/hook.js';
import { createEpochScheduler } from '../../src/epoch/index.js';
import { runOf } from './interaction-kit.js';
import { personasOf } from './llm-alliance.js';

const PROPOSAL = 'a proposé une alliance à';

type Req = {
  readonly messages: readonly { readonly content: string }[];
  readonly system: { variable?: string | undefined };
};
const asks = (text: string) => (r: Req) => r.messages[0]?.content.startsWith(text) === true;
const actorOf = (r: Req): string => /^Vous êtes (\S+)/.exec(r.system.variable ?? '')?.[1] ?? '';

/**
 * LLM déterministe qui joue la chaîne : Alexandre propose une alliance à Sarah ; Léa raconte la proposition à Thomas ;
 * Thomas confronte Alexandre. Chacun n'agit qu'une fois (la mémoire des « déjà fait » vit dans la fermeture, au
 * moment de l'enregistrement ; au rejeu, les cassettes tiennent lieu de script).
 */
export function scriptedChainLlm(): FakeLLM {
  const done = new Set<string>();
  const pick = (r: Req, who: string, action: string, target: string, aboutProposal: boolean): string | null => {
    if (actorOf(r) !== who || done.has(action)) return null;
    const lines = (r.messages[0]?.content ?? '').split('\n');
    const line = lines.find(
      (l) =>
        new RegExp(`^\\d+\\. ${action} → ${target}`).test(l) &&
        (aboutProposal ? l.includes(PROPOSAL) : !l.includes('(fait')),
    );
    if (!line) return null;
    done.add(action);
    return line.split('.')[0] ?? null;
  };
  const speech = (initiator: string, reply: string, intent: string, mention: string) => (r: Req) =>
    r.messages[0]?.content.includes('Tu prends la parole')
      ? {
          text: initiator,
          intent,
          tone: 'posé',
          emotion: 'confiance',
          reveals: [],
          mentions: [mention],
          wantsToContinue: false,
        }
      : {
          text: reply,
          intent: 'react',
          tone: 'prudent',
          emotion: 'surprise',
          reveals: [],
          mentions: [mention],
          wantsToContinue: false,
        };
  return new FakeLLM({
    model: 'scripted-chain',
    rules: [
      {
        purpose: 'evaluate',
        when: asks('Choisis'),
        replies: [
          (r) => {
            const choice =
              pick(r as Req, 'Alexandre', 'propose_alliance', 'Sarah', false) ??
              pick(r as Req, 'Léa', 'share_secret', 'Thomas', true) ??
              pick(r as Req, 'Thomas', 'confront', 'Alexandre', true);
            return choice ? { choice, reason: 'C’est le moment.' } : { choice: 'none' };
          },
        ],
      },
      {
        purpose: 'evaluate',
        when: (r) => r.messages[0]?.content.includes('tente : propose_alliance') === true,
        replies: [{ outcome: 'accepted', reason: 'Sarah accepte.' }],
      },
      {
        purpose: 'evaluate',
        when: (r) => r.messages[0]?.content.includes('tente : share_secret') === true,
        replies: [{ outcome: 'believed', reason: 'Thomas la croit.' }],
      },
      {
        purpose: 'evaluate',
        when: (r) => r.messages[0]?.content.includes('tente : confront') === true,
        replies: [{ outcome: 'escalated', reason: 'Alexandre s’énerve.' }],
      },
      { purpose: 'evaluate', replies: [{ outcome: 'neutral', reason: 'Rien de marquant.' }] },
      {
        purpose: 'speak',
        when: asks('Action en cours : propose_alliance'),
        replies: [speech('Sarah, associons-nous, toi et moi.', 'Entendu, Alexandre.', 'propose_alliance', 'Sarah')],
      },
      {
        purpose: 'speak',
        when: asks('Action en cours : share_secret'),
        replies: [
          speech(
            'Thomas, tu sais ce que j’ai appris ? Alexandre et Sarah sont alliés.',
            'Je ne m’y attendais pas…',
            'share_secret',
            'Thomas',
          ),
        ],
      },
      {
        purpose: 'speak',
        when: asks('Action en cours : confront'),
        replies: [
          speech(
            'Alexandre, on m’a dit que tu t’alliais avec Sarah dans notre dos.',
            'Qui t’a raconté ça ?',
            'confront',
            'Alexandre',
          ),
        ],
      },
      {
        purpose: 'speak',
        replies: [speech('Salut tout le monde.', 'Salut.', 'small_talk', 'Sarah')],
      },
      { purpose: 'verify', replies: [{ coherent: true, reason: 'L’échange aboutit à l’issue décidée.' }] },
    ],
  });
}

export function llmChainScheduler(storage: StoragePort, fixture: WorldFixture, llm: LLMPort) {
  const persona = personasOf(fixture);
  const moves = new ScriptedDecisionPolicy({
    destinations: {
      [C.alexandre]: { 0: go(L.jardin, Z.banc) },
      [C.sarah]: { 0: go(L.jardin, Z.banc), 1: go(L.cuisine) },
      [C.lea]: { 0: go(L.cuisine), 4: go(L.salon) },
      [C.thomas]: { 0: go(L.chambres), 4: go(L.salon), 6: go(L.jardin, Z.banc) },
    },
  });
  const decision = new AgendaDecisionPolicy(new LlmDecisionPolicy({ llm, persona, destination: moves }));
  return createEpochScheduler({
    storage,
    decision,
    outcome: new LlmOutcomeModel({ llm, persona }),
    hooks: { tick: [interactionHook({ dialogue: new LlmDialogue({ llm, persona }) })], economy: economyHook() },
  });
}

export async function playLlmChain(storage: StoragePort, llm: LLMPort) {
  const fixture = await seedWorld(storage, aWorld().build());
  await llmChainScheduler(storage, fixture, llm).run(runOf(fixture)).done;
  const snap = await snapshotOf(storage, fixture.world.id, 0);
  const state: SimState = await loadSimState(storage, fixture.world.id, fixture.season.number);
  const factId = Object.values(state.facts).find((f) => f.predicate === PROPOSAL)?.id ?? '';
  return { state, factId, journal: snap.journal };
}

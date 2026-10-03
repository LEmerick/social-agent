/** Outils des tests de parallélisme et de chaos : LLM factice à latences aléatoires, époque à deux scènes indépendantes. */
import { createHash } from 'node:crypto';
import {
  type LLMPort,
  type LlmRequest,
  type LlmResult,
  type StoragePort,
  BudgetedLlm,
  ScriptedDecisionPolicy,
  personaPrompt,
} from '@ai-reality/engine';
import { FakeLLM, aWorld, seedWorld } from '@ai-reality/testkit';
import { LlmDecisionPolicy } from '../../src/decision/llm-policy.js';
import { LlmOutcomeModel } from '../../src/decision/llm-outcome.js';
import { economyHook } from '../../src/economy/hook.js';
import { createEpochScheduler, type EpochSchedulerDeps } from '../../src/epoch/index.js';
import { LlmDialogue } from '../../src/interaction/llm-dialogue.js';
import { interactionHook } from '../../src/interaction/index.js';
import { C, L, Z, go } from './epoch-kit.js';

const fnv = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};

const lastContent = (req: LlmRequest): string => req.messages.at(-1)?.content ?? '';

/**
 * Réponses dépendant uniquement de la requête (choix = option tirée par le hash du prompt, première issue listée,
 * énoncé générique, vérification positive) : le même prompt reçoit toujours la même réponse.
 */
export function promptDrivenLlm(): FakeLLM {
  return new FakeLLM({
    model: 'prompt-driven',
    rules: [
      {
        purpose: 'evaluate',
        when: (r) => lastContent(r).startsWith('Choisis'),
        replies: [
          (req) => {
            const options = lastContent(req)
              .split('\n')
              .filter((l) => /^[1-9]\d*\. /.test(l));
            if (options.length === 0) return { choice: 'none' };
            return { choice: String((fnv(lastContent(req)) % options.length) + 1), reason: 'au hasard' };
          },
        ],
      },
      {
        purpose: 'evaluate',
        replies: [
          (req) => ({ outcome: /^- (\w+) /m.exec(lastContent(req))?.[1] ?? 'accepted', reason: 'première issue' }),
        ],
      },
      {
        purpose: 'speak',
        replies: [
          (req) => ({
            text: `Réplique ${String(fnv(lastContent(req)) % 1000)}`,
            intent: 'talk',
            tone: 'neutre',
            emotion: 'calme',
            reveals: [],
            mentions: [],
            wantsToContinue: fnv(lastContent(req)) % 3 !== 0,
          }),
        ],
      },
      { purpose: 'verify', replies: [{ coherent: true, reason: 'ok' }] },
    ],
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Latence aléatoire (graine propre à l'exécution) avant chaque réponse : l'ordre d'arrivée change d'une exécution à l'autre. */
export function jitterLlm(inner: LLMPort, seed: number, maxMs = 6): LLMPort & { calls: () => number } {
  let state = seed >>> 0 || 1;
  let calls = 0;
  const next = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
  return {
    calls: () => calls,
    async complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
      calls += 1;
      const delay = Math.floor(next() * maxMs);
      const result = await inner.complete(req);
      await sleep(delay);
      return result;
    },
  };
}

export const journalHash = (journal: unknown): string =>
  createHash('sha256').update(JSON.stringify(journal)).digest('hex');

export interface TwoScenes {
  readonly storage: StoragePort;
  readonly fixture: Awaited<ReturnType<typeof seedWorld>>;
}

/** Monde Palmiers : Alexandre et Sarah au jardin, Léa et Thomas à la cuisine, deux scènes sans personnage commun. */
export async function seededTwoScenes(storage: StoragePort): Promise<TwoScenes> {
  const fixture = await seedWorld(storage, aWorld().build());
  return { storage, fixture };
}

export function twoSceneScheduler(
  storage: StoragePort,
  fixture: TwoScenes['fixture'],
  llm: LLMPort,
  options: { parallelScenes: boolean; extra?: Partial<EpochSchedulerDeps>; wrapHooks?: boolean } = {
    parallelScenes: true,
  },
) {
  const persona = (id: string): string => {
    const record = fixture.characters.find((c) => c.id === id);
    if (!record) throw new Error(`personnage ${id} absent`);
    return personaPrompt(record);
  };
  const destinations = {
    [C.alexandre]: { 0: go(L.jardin, Z.banc) },
    [C.sarah]: { 0: go(L.jardin, Z.banc) },
    [C.lea]: { 0: go(L.cuisine) },
    [C.thomas]: { 0: go(L.cuisine) },
  };
  return createEpochScheduler({
    storage,
    decision: new LlmDecisionPolicy({
      llm,
      persona,
      destination: new ScriptedDecisionPolicy({ destinations }),
    }),
    outcome: new LlmOutcomeModel({ llm, persona }),
    hooks: {
      tick: [interactionHook({ dialogue: new LlmDialogue({ llm, persona }), parallelScenes: options.parallelScenes })],
      economy: economyHook(),
    },
    ...options.extra,
  });
}

export { BudgetedLlm };

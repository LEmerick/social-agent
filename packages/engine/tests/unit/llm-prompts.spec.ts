/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
import { describe, expect, it } from 'vitest';
import { FakeLLM } from '@ai-reality/testkit';
import { buildAgentContext } from '../../src/agent/context.js';
import { createAgentRuntime } from '../../src/agent/runtime.js';
import { situationOf } from '../../src/agent/situation.js';
import { LlmDecisionPolicy } from '../../src/decision/llm-policy.js';
import { LlmOutcomeModel } from '../../src/decision/llm-outcome.js';
import { ScriptedDecisionPolicy } from '../../src/decision/scripted-policy.js';
import { LlmDialogue } from '../../src/interaction/llm-dialogue.js';
import { Rng } from '../../src/core/rng.js';
import { C, dialogueInput, option, palmiersAtGarden, personaOf, speakReply } from '../helpers/llm-kit.js';

/**
 * Prompts figés pour une situation Palmiers : Alexandre propose une alliance à Sarah au jardin.
 * Toute modification d'un prompt change le snapshot (revue obligatoire) puis invalide les cassettes concernées.
 */
describe('snapshot des prompts', () => {
  it('plan, choix, issue, réplique, vérification', async () => {
    const llm = new FakeLLM({
      rules: [
        { purpose: 'plan', replies: [{ intentions: [] }] },
        {
          purpose: 'evaluate',
          when: (r) => r.messages[0]?.content.includes('Choisis') === true,
          replies: [{ choice: '1' }],
        },
        { purpose: 'evaluate', replies: [{ outcome: 'accepted_conditional' }] },
        { purpose: 'speak', replies: [speakReply({ wantsToContinue: false })] },
        { purpose: 'verify', replies: [{ coherent: true, reason: 'ok' }] },
      ],
    });
    const state = palmiersAtGarden((s) => {
      s.characters[C.alexandre]!.directive = {
        actions: { propose_alliance: 1.5 },
        targets: { [C.sarah]: 1.2 },
        prefer: [],
        forbid: ['insult'],
      };
    });
    const propose = option('propose_alliance', C.sarah);

    const runtime = createAgentRuntime({ llm, persona: personaOf });
    await runtime.plan(buildAgentContext(state, C.alexandre, situationOf(state, C.alexandre)), {
      memories: ['Sarah m’a souri hier au dîner.'],
      locations: Object.values(state.locations).map((l) => ({ id: l.id, name: l.name })),
      names: { [C.sarah]: 'Sarah' },
      directive: state.characters[C.alexandre]!.directive,
    });
    await new LlmDecisionPolicy({ llm, persona: personaOf, destination: new ScriptedDecisionPolicy() }).choose({
      actorId: C.alexandre,
      state,
      options: [option('small_talk', C.sarah), propose],
      rng: Rng.derive('snap'),
    });
    await new LlmOutcomeModel({ llm, persona: personaOf }).resolve({ option: propose, actorId: C.alexandre, state });
    await new LlmDialogue({ llm, persona: personaOf }).generate(dialogueInput(state, propose, 'accepted_conditional'));

    expect(
      llm.requests.map((r) => ({
        purpose: r.purpose,
        tier: r.tier,
        maxTokens: r.maxTokens,
        effort: r.effort ?? null,
        stable: r.system.stable,
        variable: r.system.variable ?? null,
        messages: r.messages,
      })),
    ).toMatchSnapshot();
  });

  it('le préfixe stable (persona + règles) ne varie pas d’une tâche à l’autre pour un même personnage', async () => {
    const llm = new FakeLLM({
      rules: [
        { purpose: 'plan', replies: [{ intentions: [] }] },
        { purpose: 'speak', replies: [speakReply()] },
      ],
    });
    const state = palmiersAtGarden();
    const ctx = buildAgentContext(state, C.alexandre, situationOf(state, C.alexandre));
    const runtime = createAgentRuntime({ llm, persona: personaOf });
    await runtime.plan(ctx);
    await runtime.speak(ctx, { action: 'small_talk', outcome: 'accepted', turn: { index: 1, max: 2 } });
    expect(llm.requests[0]!.system.stable).toBe(llm.requests[1]!.system.stable);
    expect(llm.requests[0]!.system.stable).toBe(
      `${personaOf(C.alexandre)}\n\n${llm.requests[0]!.system.stable.split('\n\n').at(-1)}`,
    );
  });
});

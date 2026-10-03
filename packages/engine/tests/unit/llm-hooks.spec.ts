/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
import { describe, expect, it } from 'vitest';
import { FakeLLM, IDS } from '@ai-reality/testkit';
import { agentMemoryHook, agentPlanHook, directiveIntentions } from '../../src/agent/hooks.js';
import { createAgentRuntime } from '../../src/agent/runtime.js';
import { simIdFactory } from '../../src/core/sim-ids.js';
import type { TickContext } from '../../src/epoch/types.js';
import type { MemoryService } from '../../src/memory/service.js';
import type { MemoryDraft } from '../../src/memory/types.js';
import { emptyTickBatch } from '../../src/state/journal.js';
import type { SimState } from '../../src/state/types.js';
import { C, palmiersAtGarden, personaOf } from '../helpers/llm-kit.js';
import { anEvent, epochId } from '../helpers/memory-kit.js';

const secret = IDS.facts.sarahSecret;

/** Contexte de tick minimal : seuls les champs que lisent les hooks d'agents. */
function tickContext(state: SimState, phase: 'plan' | 'memory'): TickContext {
  const epochNumber = 0;
  const tick = phase === 'plan' ? 0 : state.world.config.ticksPerEpoch;
  return {
    phase,
    state,
    batch: emptyTickBatch(epochId(0), tick),
    epochId: epochId(0),
    epochNumber,
    tick,
    ids: (stream: string) => simIdFactory(state.world.seed, state.world.config, epochNumber, tick, stream),
  } as unknown as TickContext;
}

const planReply = (target: string, priority: number) => ({
  intentions: [{ kind: 'talk_to', target, goal: null, factId: null, location: null, priority }],
});

describe('agentPlanHook (phase 2)', () => {
  it('un agenda par agent, trié par priorité', async () => {
    const state = palmiersAtGarden();
    const llm = new FakeLLM({
      rules: [
        {
          purpose: 'plan',
          replies: [
            {
              intentions: [
                { kind: 'talk_to', target: 'Sarah', goal: null, factId: null, location: null, priority: 0.2 },
                { kind: 'avoid', target: 'Thomas', goal: null, factId: null, location: null, priority: 0.7 },
              ],
            },
          ],
        },
      ],
    });
    await agentPlanHook(createAgentRuntime({ llm, persona: personaOf }))(tickContext(state, 'plan'));
    expect(llm.requestsFor('plan')).toHaveLength(4);
    const alexandre = state.characters[C.alexandre]!.agenda;
    expect(alexandre.map((i) => [i.kind, i.targetId, i.priority])).toEqual([
      ['avoid', C.thomas, 0.7],
      ['talk_to', C.sarah, 0.2],
    ]);
  });

  it('directive : priorité haute, guided : moyenne, autonome : celle du modèle', async () => {
    const state = palmiersAtGarden((s) => {
      const biases = { actions: {}, targets: { [C.sarah]: 1.5, [C.thomas]: -1 }, prefer: [], forbid: [] };
      s.characters[C.alexandre] = { ...s.characters[C.alexandre]!, autonomy: 'directive', directive: biases };
      s.characters[C.lea] = { ...s.characters[C.lea]!, autonomy: 'guided', directive: biases };
      s.characters[C.thomas] = { ...s.characters[C.thomas]!, autonomy: 'autonomous', directive: biases };
    });
    expect(directiveIntentions(state, state.characters[C.thomas]!)).toEqual([]);
    const llm = new FakeLLM({
      rules: [
        // Alexandre (aucune intention vers Sarah) ; Léa propose déjà Sarah à 0,95 ; Thomas à 0,1.
        {
          purpose: 'plan',
          when: (r) => r.system.variable?.includes('Vous êtes Léa') === true,
          replies: [planReply('Sarah', 0.95)],
        },
        {
          purpose: 'plan',
          when: (r) => r.system.variable?.includes('Vous êtes Thomas') === true,
          replies: [planReply('Sarah', 0.1)],
        },
        { purpose: 'plan', replies: [{ intentions: [] }] },
      ],
    });
    await agentPlanHook(createAgentRuntime({ llm, persona: personaOf }))(tickContext(state, 'plan'));
    const priorityTowardSarah = (id: string) =>
      state.characters[id]!.agenda.find((i) => i.targetId === C.sarah)?.priority;
    expect(priorityTowardSarah(C.alexandre)).toBe(0.9);
    expect(priorityTowardSarah(C.lea)).toBe(0.95);
    expect(priorityTowardSarah(C.thomas)).toBe(0.1);
    // Sans cible Sarah pour Sarah elle-même : l'agenda directif n'invente rien d'autre.
    expect(state.characters[C.alexandre]!.agenda).toHaveLength(1);
  });

  it('conserve les intentions différées `tell` déjà présentes', async () => {
    const state = palmiersAtGarden((s) => {
      s.characters[C.sarah]!.agenda = [
        { kind: 'tell', targetId: C.lea, goal: null, factId: secret, locationId: null, priority: 0.4 },
      ];
    });
    const llm = new FakeLLM({ rules: [{ purpose: 'plan', replies: [{ intentions: [] }] }] });
    await agentPlanHook(createAgentRuntime({ llm, persona: personaOf }))(tickContext(state, 'plan'));
    expect(state.characters[C.sarah]!.agenda.map((i) => i.kind)).toEqual(['tell']);
  });
});

describe('agentMemoryHook (phase 6)', () => {
  const memoryStub = () => {
    const recorded = new Map<string, MemoryDraft[]>();
    const service = {
      record: (characterId: string, drafts: readonly MemoryDraft[]) => {
        recorded.set(characterId, [...drafts]);
        return Promise.resolve([]);
      },
    } as unknown as MemoryService;
    return { service, recorded };
  };

  it('souvenirs des events vécus, croyances `inferred` dans le lot de clôture, objectifs mis à jour', async () => {
    const state = palmiersAtGarden();
    const proposal = anEvent(
      0,
      'alliance_proposed',
      [
        [C.alexandre, 'actor'],
        [C.sarah, 'target'],
      ],
      0.7,
    );
    const llm = new FakeLLM({
      rules: [
        {
          purpose: 'reflect',
          when: (r) => r.system.variable?.includes('Vous êtes Sarah') === true,
          replies: [
            {
              beliefs: [
                { factId: secret, belief: 'doubts', confidence: 0.4 },
                { factId: 'inconnu', belief: 'believes', confidence: 1 },
              ],
              goalUpdates: [{ goalIndex: 0, status: 'abandoned' }],
            },
          ],
        },
        { purpose: 'reflect', replies: [{ beliefs: [], goalUpdates: [] }] },
      ],
    });
    const { service, recorded } = memoryStub();
    const ctx = tickContext(state, 'memory');
    const goalsBefore = state.characters[C.sarah]!.goals.filter((g) => g.status === 'open');
    expect(goalsBefore.length).toBeGreaterThan(0);

    await agentMemoryHook(createAgentRuntime({ llm, persona: personaOf }), service, () => Promise.resolve([proposal]))(
      ctx,
    );

    // Souvenirs : Alexandre et Sarah ont vécu l'event, pas Léa ni Thomas.
    expect([...recorded.keys()].sort()).toEqual([C.alexandre, C.sarah].sort());
    expect(recorded.get(C.sarah)![0]!.summary).toMatch(/alliance/);
    // Réflexion de Sarah : une connaissance `inferred`, reliée à la connaissance d'origine.
    expect(ctx.batch.knowledge).toHaveLength(1);
    const edge = ctx.batch.knowledge[0]!;
    expect(edge).toMatchObject({
      characterId: C.sarah,
      factId: secret,
      sourceType: 'inferred',
      belief: 'doubts',
      confidence: 0.4,
      parentKnowledgeId: IDS.knowledge.sarahSecret,
      learnedTick: state.world.config.ticksPerEpoch,
    });
    expect(state.knowledge[edge.id]).toEqual(edge);
    // Le premier objectif ouvert est abandonné.
    expect(state.characters[C.sarah]!.goals.find((g) => g.id === goalsBefore[0]!.id)!.status).toBe('abandoned');
    // Le changement est aussi dans le lot de clôture (persisté par commitTick, relu par loadSimState).
    expect(ctx.batch.goals).toEqual([
      expect.objectContaining({
        ...goalsBefore[0]!,
        characterId: C.sarah,
        status: 'abandoned',
        createdEpoch: null,
        closedEpoch: 0,
      }),
    ]);
  });
});

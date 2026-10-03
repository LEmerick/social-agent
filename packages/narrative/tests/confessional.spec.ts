import { describe, expect, it } from 'vitest';
import { buildAgentContext, createAgentRuntime, renderAgentContext } from '@ai-reality/engine';
import type { FactNode, KnowledgeEdge } from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { FakeLLM, IDS, aSimState, fixedId } from '@ai-reality/testkit';
import {
  buildArcsFrom,
  candidatesOf,
  collectDigest,
  confessionalQuestion,
  createConfessionalService,
  memoryNarrativeStorage,
  storageContextProvider,
} from '../src/index.js';
import { C, EPOCH_14, EVT, L, seedBetrayal } from './helpers/betrayal.js';

const FUTURE_FACT: FactNode = {
  id: fixedId(0x50, 2),
  subjectId: C.alexandre,
  predicate: 'prépare la confrontation du jardin contre',
  objectId: C.sarah,
  objectText: null,
  isTrue: true,
  sensitivity: 3,
  originEventId: EVT.betrayal,
  inventedById: null,
};
const LATE_FACT: FactNode = {
  ...FUTURE_FACT,
  id: fixedId(0x50, 3),
  predicate: 'a été trahie lors de la confrontation du jardin',
  subjectId: C.sarah,
  objectId: null,
};

const edge = (n: number, characterId: string, factId: string, learnedTick: number): KnowledgeEdge => ({
  id: fixedId(0x61, n),
  characterId,
  factId,
  sourceType: 'witnessed',
  toldById: null,
  viaEventId: null,
  parentKnowledgeId: null,
  learnedEpoch: 14,
  learnedTick,
  confidence: 1,
  belief: 'believes',
});

const interviewReply = { answer: 'Je ne sais pas s’il est sincère, mais je veux y croire.', reveals: [] };

async function betrayalArc() {
  const sim = createMemoryStorage();
  await seedBetrayal(sim);
  await sim.tx(async (s) => {
    await s.facts.insert(IDS.world, [FUTURE_FACT, LATE_FACT]);
    await s.knowledge.insert([
      edge(1, C.alexandre, FUTURE_FACT.id, 0), // Alexandre seul sait ce qu'il prépare
      edge(2, C.sarah, LATE_FACT.id, 16), // Sarah ne l'apprendra qu'à la trahison
    ]);
  });
  const digest = await collectDigest(memoryNarrativeStorage(sim), EPOCH_14);
  const arc = buildArcsFrom(digest.worldId, candidatesOf(digest))[0];
  if (!arc) throw new Error('arc absent');
  return { sim, arc };
}

describe('confessionnal : étanchéité', () => {
  it('le contexte du confessionnal ne contient que les connaissances du personnage, telles qu’avant l’arc', async () => {
    const { sim, arc } = await betrayalArc();
    const ctx = await storageContextProvider(sim)(C.sarah, arc);

    // Son secret, oui ; ce que seul Alexandre sait, non ; ce qu'elle n'apprend qu'à la confrontation à venir, non.
    expect(ctx.knowledge.map((k) => k.factId)).toEqual([IDS.facts.sarahSecret]);
    const text = renderAgentContext(ctx);
    expect(text).toContain('autre émission');
    for (const hidden of [FUTURE_FACT.id, LATE_FACT.id, 'confrontation']) expect(text).not.toContain(hidden);

    // Alexandre, lui, connaît son plan… mais pas la confrontation à venir avant qu'elle ait lieu.
    const alexandre = await storageContextProvider(sim)(C.alexandre, arc);
    expect(alexandre.knowledge.map((k) => k.factId)).toEqual([FUTURE_FACT.id]);
  });

  it('la requête envoyée au LLM ne laisse rien filtrer de la suite de l’arc', async () => {
    const { sim, arc } = await betrayalArc();
    const llm = new FakeLLM({ rules: [{ purpose: 'interview', replies: [interviewReply] }] });
    const service = createConfessionalService({
      runtime: createAgentRuntime({ llm, persona: (id) => `Persona ${id}` }),
      contextFor: storageContextProvider(sim),
    });

    const line = await service.record(C.sarah, arc);

    expect(llm.requests).toHaveLength(1);
    const sent = JSON.stringify(llm.requests[0]);
    expect(sent).toContain('Que penses-tu de Alexandre');
    for (const leak of [
      FUTURE_FACT.id,
      LATE_FACT.id,
      FUTURE_FACT.predicate,
      'confrontation',
      'alliance_betrayed',
      EVT.betrayal,
      arc.title,
      'Thomas',
    ]) {
      expect(sent).not.toContain(leak);
    }
    expect(line).toMatchObject({
      kind: 'confessional',
      speakerId: C.sarah,
      text: interviewReply.answer,
      arcId: arc.id,
      utteranceId: null,
    });
    expect(line.llmCallId).not.toBe('');
  });

  it('la question ne cite que des personnes que le personnage connaît', () => {
    const state = aSimState();
    const ctx = buildAgentContext(state, IDS.characters.sarah, {
      locationId: L.confessionnal,
      sceneMemberIds: [],
      previousTurns: [],
    });
    const arc = {
      id: 'a',
      worldId: 'w',
      title: 't',
      status: 'open' as const,
      rootEventId: 'e',
      firstEpochId: 'p',
      lastEpochId: 'p',
      characterIds: [C.sarah, C.thomas],
      eventIds: [],
      importance: 1,
    };
    const question = confessionalQuestion(ctx, arc);
    const known = ctx.relationships.map((r) => r.targetId);
    expect(known.includes(C.thomas) ? question.includes('Thomas') : question.includes('derniers jours')).toBe(true);
  });
});

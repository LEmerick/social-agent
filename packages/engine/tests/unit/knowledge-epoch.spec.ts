import { describe, expect, it } from 'vitest';
import { AgendaDecisionPolicy, HeuristicOutcomeModel, buildAgentContext, renderAgentContext } from '@ai-reality/engine';
import type { TickHook } from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { UniformRandomPolicy, aWorld, seedWorld } from '@ai-reality/testkit';
import { fullHooks, interactionScheduler, runOf } from '../helpers/interaction-kit.js';

const policy = () => new AgendaDecisionPolicy(new UniformRandomPolicy({ moveProbability: 0.4, idleProbability: 0.1 }));

/** Appelle le constructeur de contexte de chaque personnage à chaque tick et contrôle ce qui y figure. */
function leakWatch(report: { calls: number; known: number; hidden: number }): TickHook {
  return (ctx) => {
    const { state } = ctx;
    const allIds = Object.keys(state.characters);
    for (const characterId of allIds) {
      const position = state.positions[characterId];
      const situation = {
        locationId: position?.kind === 'at' ? position.locationId : null,
        sceneMemberIds: allIds,
        previousTurns: [],
      };
      const context = buildAgentContext(state, characterId, situation);
      const knownIds = new Set(
        Object.values(state.knowledge)
          .filter((k) => k.characterId === characterId)
          .map((k) => k.factId),
      );
      const text = renderAgentContext(context) + JSON.stringify(context);
      report.calls += 1;
      report.known += context.knowledge.length;
      expect(context.knowledge.every((k) => knownIds.has(k.factId))).toBe(true);
      expect(context.agenda.every((i) => i.factId === null || knownIds.has(i.factId))).toBe(true);
      for (const fact of Object.values(state.facts)) {
        if (knownIds.has(fact.id)) continue;
        report.hidden += 1;
        expect(text, `fait ${fact.id} (${fact.predicate}) fuité dans le contexte de ${characterId}`).not.toContain(
          fact.id,
        );
        const sameTextKnown = [...knownIds].some(
          (id) => state.facts[id]?.objectText === fact.objectText && fact.objectText,
        );
        if (fact.objectText && !sameTextKnown) expect(text).not.toContain(fact.objectText);
      }
    }
  };
}

describe('étanchéité sur des époques complètes (test critique)', () => {
  it('politique aléatoire, trois époques de faits : aucun fait hors des connaissances du personnage dans son contexte', async () => {
    for (const seed of ['etanche-1', 'etanche-2']) {
      const storage = createMemoryStorage();
      const base = aWorld().build();
      const fixture = await seedWorld(storage, { ...base, world: { ...base.world, seed } });
      const report = { calls: 0, known: 0, hidden: 0 };
      for (let number = 0; number < 3; number++) {
        const hooks = fullHooks([leakWatch(report)]);
        await interactionScheduler(storage, policy(), new HeuristicOutcomeModel(), hooks).run(runOf(fixture, number))
          .done;
      }
      // Le test n'est pas creux : des contextes ont été construits, des faits circulent, d'autres restent ignorés de certains.
      expect(report.calls).toBeGreaterThan(300);
      expect(report.known).toBeGreaterThan(0);
      expect(report.hidden).toBeGreaterThan(0);
      const facts = await storage.tx((s) => s.facts.listByWorld(fixture.world.id));
      expect(facts.length).toBeGreaterThan(10);
      expect(facts.some((f) => !f.isTrue || f.sensitivity >= 2)).toBe(true);
    }
  }, 120_000);

  it('la propagation est déterministe : mêmes faits et mêmes connaissances (identifiants compris) pour une même graine', async () => {
    const run = async () => {
      const storage = createMemoryStorage();
      const fixture = await seedWorld(storage, aWorld().build());
      for (let number = 0; number < 2; number++) {
        await interactionScheduler(storage, policy(), new HeuristicOutcomeModel(), fullHooks()).run(
          runOf(fixture, number),
        ).done;
      }
      return storage.tx(async (s) => ({
        facts: await s.facts.listByWorld(fixture.world.id),
        knowledge: await s.knowledge.listByWorld(fixture.world.id),
      }));
    };
    const first = await run();
    const second = await run();
    expect(first.knowledge.length).toBeGreaterThan(5);
    expect(second).toEqual(first);
  }, 60_000);

  it('toute connaissance non initiale pointe un event d’interaction et, si elle est transmise, un parent du même fait', async () => {
    const storage = createMemoryStorage();
    const fixture = await seedWorld(storage, aWorld().build());
    await interactionScheduler(storage, policy(), new HeuristicOutcomeModel(), fullHooks()).run(runOf(fixture)).done;
    const stored = await storage.tx((x) => x.knowledge.listByWorld(fixture.world.id));
    const byId = new Map(stored.map((k) => [k.id, k]));
    const edges = stored.filter((k) => k.sourceType !== 'seeded');
    expect(edges.length).toBeGreaterThan(0);
    for (const k of edges) {
      expect(k.viaEventId, `connaissance ${k.id}`).not.toBeNull();
      if (k.parentKnowledgeId !== null) expect(byId.get(k.parentKnowledgeId)?.factId).toBe(k.factId);
      if (k.sourceType === 'told' || k.sourceType === 'overheard') expect(k.toldById).not.toBeNull();
    }
  }, 60_000);
});

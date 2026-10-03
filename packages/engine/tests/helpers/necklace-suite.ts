/**
 * Scénario `necklace` (game-formats.md §8) : la chasse au collier jusqu'à l'élimination de Thomas.
 * Époque 3 : mission secrète de Thomas. Époque 4 : Léa fouille la forêt et trouve le collier ; Sarah le devine.
 * Époque 5 : Thomas sonde Sarah, écoute Léa aux portes, sa mission réussit. Époque 6 : faux collier, conseil, collier
 * joué, Thomas éliminé.
 */
import { describe, expect, it } from 'vitest';
import {
  type EventRecord,
  type StoragePort,
  type TickHook,
  defaultEdge,
  formatOf,
  loadFormatState,
  parseSeasonFormat,
  ScriptedOutcomeModel,
} from '@ai-reality/engine';
import { IDS, adventureWorld, seedWorld } from '@ai-reality/testkit';
import { fullHooks } from './interaction-kit.js';
import { formatScheduler, runNumber } from './format-run-kit.js';
import { expectInventoryReplayed } from './format-invariants.js';
import { ScenarioPolicy } from './scenario-policy.js';
import { C, L, Z, go, snapshotOf } from './epoch-kit.js';

const AD = {
  foret: '01960000-0000-7000-8000-000000001101',
  conseil: '01960000-0000-7000-8000-000000001102',
} as const;
const [ALEX, SARAH, LEA, THOMAS] = [C.alexandre, C.sarah, C.lea, C.thomas] as const;

const necklaceFormat = () =>
  parseSeasonFormat({
    format: 'adventure',
    teams: [],
    items: [
      {
        slug: 'immunity_necklace',
        kind: 'power',
        count: 1,
        placement: 'hidden',
        difficulty: 40,
        location: 'foret',
        effects: { on: 'vote_session', nullify_votes_against_holder: true },
        expires: 'after_use',
      },
    ],
    schedule: [{ kind: 'council', epoch: 6, tick: 28, params: { location: 'conseil' } }],
    missions: [
      {
        slug: 'find_necklace_holder',
        title: 'Trouver qui détient le collier',
        briefing: 'Découvre qui détient le collier d’immunité.',
        scope: 'individual',
        secrecy: 'secret',
        objective: {
          knows: {
            who: '$self',
            fact: { predicate: 'holds', object: 'item_def:immunity_necklace' },
            minConfidence: 0.7,
          },
        },
        reward: { credits: 15 },
        assign: { epoch: 3, to: ['thomas'] },
      },
    ],
    vote: { tie: 'revote', maxRounds: 2, allowSelfVote: false, revealVotes: true, immunityItems: true },
  });

const outcomes = new ScriptedOutcomeModel(({ option }) => {
  switch (option.action) {
    case 'search':
      return 'found';
    case 'share_secret':
      return 'believed';
    case 'probe':
      return 'accepted';
    case 'eavesdrop':
    case 'fake_item':
      return 'undetected';
    default:
      return undefined;
  }
});

export interface NecklaceHarness {
  readonly storage: StoragePort;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export function necklaceSuite(name: string, factory: () => Promise<NecklaceHarness>): void {
  describe(`scénario necklace : la chasse au collier (${name})`, () => {
    it('jusqu’à l’élimination de Thomas', async () => {
      const harness = await factory();
      try {
        await harness.reset();
        const { storage } = harness;
        const fixture = await seedWorld(
          storage,
          adventureWorld({
            characters: 4,
            seed: 'necklace',
            // Thomas fait confiance à Léa : de quoi dépasser 0,7 en l'écoutant aux portes.
            relationships: [{ ...defaultEdge(THOMAS, LEA), trust: 70, acquaintance: 'met' }],
          }),
        );
        const format = necklaceFormat();
        const play = async (
          number: number,
          script: ConstructorParameters<typeof ScenarioPolicy>[0],
          extra: TickHook[] = [],
        ) => {
          const scheduler = formatScheduler(storage, new ScenarioPolicy(script), {
            outcome: outcomes,
            format,
            seasonEpochs: 8,
            hooks: fullHooks(extra),
          });
          await scheduler.run(runNumber(fixture, number)).done;
          return snapshotOf(storage, fixture.world.id, number);
        };
        const factsAndKnowledge = () =>
          storage.tx(async (s) => ({
            facts: await s.facts.listByWorld(fixture.world.id),
            knowledge: await s.knowledge.listByWorld(fixture.world.id),
          }));

        // --- Époque 3 : la mission secrète de Thomas.
        const e3 = await play(3, {});
        expect(e3.journal.events.filter((e) => e.type === 'mission_assigned')).toHaveLength(1);
        let { facts, knowledge } = await factsAndKnowledge();
        const missionFact = facts.find((f) => f.predicate === 'mission');
        expect(missionFact).toBeDefined();
        expect(knowledge.filter((k) => k.factId === missionFact?.id).map((k) => k.characterId)).toEqual([THOMAS]);
        const goals = await storage.tx((s) => s.goals.listByWorld(fixture.world.id));
        expect(goals.find((g) => g.origin === 'season')).toMatchObject({ characterId: THOMAS, status: 'open' });

        // --- Époque 4 : Léa fouille la forêt ; Sarah la voit revenir les mains serrées et se doute de quelque chose.
        const sarahSuspects: TickHook = (ctx) => {
          if (ctx.epochNumber !== 4 || ctx.tick !== 9) return;
          const fs = formatOf(ctx.state);
          const necklace = Object.values(fs.items).find((i) => i.holderId === LEA);
          const fact = Object.values(ctx.state.facts).find(
            (f) => f.predicate === 'holds' && f.objectText === `item:${necklace?.id ?? ''}`,
          );
          if (!fact) throw new Error('le fait holds(Léa, collier) est absent');
          const edge = {
            id: ctx.ids('scenario').next(),
            characterId: SARAH,
            factId: fact.id,
            sourceType: 'inferred' as const,
            toldById: null,
            viaEventId: fact.originEventId,
            parentKnowledgeId: null,
            learnedEpoch: ctx.epochNumber,
            learnedTick: ctx.tick,
            confidence: 0.4,
            belief: 'believes' as const,
          };
          ctx.state.knowledge[edge.id] = edge;
          ctx.batch.knowledge.push(edge);
        };
        const e4 = await play(
          4,
          {
            destinations: { [LEA]: { 0: go(AD.foret) }, [SARAH]: { 0: go(L.jardin, Z.piscine) } },
            steps: [{ actor: LEA, tick: 8, action: 'search', locationId: AD.foret }],
          },
          [sarahSuspects],
        );
        const found = e4.journal.events.find((e) => e.type === 'item_found') as EventRecord;
        expect(found).toMatchObject({ payload: { to: LEA } });
        const searched = e4.journal.events.find((e) => e.type === 'searched') as EventRecord;
        expect(found.causedByEventId).toBe(searched.id);
        ({ facts, knowledge } = await factsAndKnowledge());
        const holds = facts.find((f) => f.predicate === 'holds' && f.subjectId === LEA && f.isTrue);
        expect(holds).toBeDefined();
        const onHolds = knowledge.filter((k) => k.factId === holds?.id);
        expect(onHolds.find((k) => k.characterId === LEA)).toMatchObject({ sourceType: 'witnessed', confidence: 1 });
        expect(onHolds.find((k) => k.characterId === SARAH)).toMatchObject({ sourceType: 'inferred', confidence: 0.4 });
        expect(onHolds.some((k) => k.characterId === THOMAS)).toBe(false);

        // --- Époque 5 : Thomas sonde Sarah, écoute Léa aux portes ; sa mission réussit.
        const isHolds = (o: { factId: string | null }) => o.factId === holds?.id;
        const e5 = await play(5, {
          destinations: {
            [THOMAS]: { 0: go(L.salon), 4: go(L.jardin, Z.banc) },
            [SARAH]: { 0: go(L.salon), 4: go(L.jardin, Z.piscine) },
            [LEA]: { 0: go(L.jardin, Z.piscine) },
          },
          steps: [
            { actor: THOMAS, tick: 2, action: 'probe', targetId: SARAH },
            { actor: SARAH, tick: 3, action: 'share_secret', targetId: THOMAS, where: isHolds },
            { actor: LEA, tick: 6, action: 'share_secret', targetId: SARAH, where: isHolds },
            { actor: THOMAS, tick: 6, action: 'eavesdrop', targetId: LEA },
          ],
        });
        ({ knowledge } = await factsAndKnowledge());
        const thomasEdges = knowledge.filter((k) => k.characterId === THOMAS && k.factId === holds?.id);
        expect(thomasEdges.map((k) => k.sourceType).sort()).toEqual(['overheard', 'told']);
        const told = thomasEdges.find((k) => k.sourceType === 'told');
        const overheard = thomasEdges.find((k) => k.sourceType === 'overheard');
        expect(told?.toldById).toBe(SARAH);
        // Le soupçon de Sarah (0,4) est atténué par la confiance de Thomas en elle : trop faible pour la mission.
        expect(told?.confidence).toBeGreaterThan(0.2);
        expect(told?.confidence).toBeLessThan(0.4);
        expect(overheard?.confidence).toBeGreaterThanOrEqual(0.7);
        const success = e5.journal.events.filter((e) => e.type === 'mission_succeeded');
        expect(success).toHaveLength(1);
        expect(success[0]?.participants).toEqual([{ characterId: THOMAS, role: 'subject' }]);
        expect(e5.states.find((s) => s.characterId === THOMAS)?.credits).toBe(
          (e5.states.find((s) => s.characterId === ALEX)?.credits ?? 0) + 15,
        );
        const goalsAfter = await storage.tx((s) => s.goals.listByWorld(fixture.world.id));
        expect(goalsAfter.find((g) => g.origin === 'season')).toMatchObject({ status: 'achieved', closedEpoch: 5 });

        // --- Époque 6 : faux collier, conseil, collier joué, Thomas éliminé.
        const e6 = await play(6, {
          destinations: { [THOMAS]: { 0: go(L.salon) }, [ALEX]: { 0: go(L.salon) }, [SARAH]: { 0: go(L.salon) } },
          steps: [
            { actor: THOMAS, tick: 2, action: 'fake_item' },
            {
              actor: THOMAS,
              tick: 4,
              action: 'show_item',
              targetId: ALEX,
              where: (o, state) => formatOf(state).items[o.itemId ?? '']?.isFake === true,
            },
          ],
          councilItems: [LEA, THOMAS],
          votes: { [ALEX]: THOMAS, [SARAH]: LEA, [LEA]: THOMAS, [THOMAS]: LEA },
        });
        const fs = await loadFormatState(storage, fixture.season.id);
        const session = Object.values(fs.voteSessions)[0];
        expect(Object.values(fs.voteSessions)).toHaveLength(1);
        expect(session?.result).toMatchObject({ status: 'decided', eliminated: THOMAS, nullified: [LEA] });
        expect(session?.result?.counts).toEqual({ [THOMAS]: 2 });
        expect(session?.played).toEqual([{ itemId: expect.any(String), holderId: LEA }]);
        const states = e6.states;
        expect(states.find((s) => s.characterId === THOMAS)?.status).toBe('eliminated');
        const changes = e6.journal.events.filter((e) => e.type === 'status_changed');
        expect(changes).toHaveLength(1);
        expect(changes[0]?.payload).toMatchObject({ characterId: THOMAS, to: 'eliminated', reason: 'vote' });

        // Le collier de Léa est consommé ; le faux de Thomas aussi, sans effet.
        const items = Object.values(fs.items);
        expect(items).toHaveLength(2);
        expect(
          items
            .filter((i) => i.state === 'used')
            .map((i) => [i.holderId, i.isFake])
            .sort(),
        ).toEqual(
          [
            [LEA, false],
            [THOMAS, true],
          ].sort(),
        );
        // Le bluff : Thomas a inventé un fait faux, qu'Alexandre, spectateur, tient pour vrai.
        ({ facts, knowledge } = await factsAndKnowledge());
        const claim = facts.find((f) => f.inventedById === THOMAS && !f.isTrue);
        expect(claim).toMatchObject({
          predicate: 'holds',
          subjectId: THOMAS,
          objectText: 'item_def:immunity_necklace',
        });
        expect(knowledge.find((k) => k.factId === claim?.id && k.characterId === ALEX)).toMatchObject({
          toldById: THOMAS,
        });
        // Bulletins révélés : « il a voté contre moi ».
        const edge = (await storage.tx((s) => s.relationships.listByWorld(fixture.world.id))).find(
          (r) => r.sourceId === LEA && r.targetId === THOMAS,
        );
        expect(edge?.rivalry).toBeGreaterThan(0);
        expect(e6.journal.events.filter((e) => e.type === 'vote_cast')).toHaveLength(4);

        await expectInventoryReplayed(storage, fixture);
        expect(IDS.world).toBe(fixture.world.id);
      } finally {
        await harness.close();
      }
    }, 120_000);
  });
}

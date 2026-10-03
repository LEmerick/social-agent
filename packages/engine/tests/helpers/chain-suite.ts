/**
 * Scénario « chaîne » de bout en bout (implementation-plan.md M4) : Alexandre propose une alliance à Sarah (jardin),
 * Sarah le raconte à Léa (intention différée), Léa à Thomas, Thomas confronte Alexandre. Une suite, deux stockages.
 */
import { describe, expect, it } from 'vitest';
import {
  type ActionOption,
  type DecisionPolicy,
  type DecisionResult,
  type Id,
  type SimState,
  AgendaDecisionPolicy,
  ScriptedDecisionPolicy,
  loadSimState,
  provenance,
  trustFactor,
} from '@ai-reality/engine';
import { IDS, aWorld, seedWorld } from '@ai-reality/testkit';
import { ScriptedOutcomeModel } from '../../src/decision/scripted-outcome.js';
import { C, L, Z, go, snapshotOf } from './epoch-kit.js';
import type { EpochHarness } from './interaction-epoch-suite.js';
import { fullHooks, interactionScheduler, runOf } from './interaction-kit.js';

const PROPOSAL = 'a proposé une alliance à';

interface Turn {
  readonly action: string;
  readonly targetId: Id;
  /** Le fait de l'alliance proposée (créé pendant l'exécution : son identifiant n'est connu qu'alors). */
  readonly aboutProposal: boolean;
}

const say = (action: string, targetId: Id, aboutProposal = false): Turn => ({ action, targetId, aboutProposal });

/** Destinations écrites ; actions écrites par tick, avec le fait de l'alliance retrouvé dans l'état. */
class ChainScript implements DecisionPolicy {
  readonly #moves = new ScriptedDecisionPolicy({
    destinations: {
      [C.alexandre]: { 0: go(L.jardin, Z.banc) },
      [C.sarah]: { 0: go(L.jardin, Z.banc), 1: go(L.cuisine) },
      [C.lea]: { 0: go(L.cuisine), 4: go(L.salon) },
      [C.thomas]: { 0: go(L.chambres), 4: go(L.salon), 6: go(L.jardin, Z.banc) },
    },
  });
  readonly #turns: Readonly<Record<Id, Readonly<Record<number, Turn>>>> = {
    [C.alexandre]: { 0: say('propose_alliance', C.sarah) },
    // Tick 3 : Sarah n'a pas de tour écrit, c'est son intention différée qui la fait parler.
    [C.lea]: { 5: say('share_secret', C.thomas, true) },
    [C.thomas]: { 7: say('confront', C.alexandre, true) },
  };

  choose(input: Parameters<DecisionPolicy['choose']>[0]): Promise<DecisionResult> {
    const turn = this.#turns[input.actorId]?.[input.state.tick];
    const proposal = Object.values(input.state.facts).find((f) => f.predicate === PROPOSAL)?.id ?? null;
    const chosen: ActionOption | null =
      turn === undefined
        ? null
        : (input.options.find(
            (o) =>
              o.action === turn.action &&
              o.targetId === turn.targetId &&
              o.factId === (turn.aboutProposal ? proposal : null),
          ) ?? null);
    return Promise.resolve({ chosen, rngDraw: null, policy: 'scripted@1' });
  }

  chooseDestination(input: Parameters<DecisionPolicy['chooseDestination']>[0]) {
    return this.#moves.chooseDestination(input);
  }
}

export interface ChainRun {
  readonly state: SimState;
  readonly factId: Id;
  readonly journal: Awaited<ReturnType<typeof snapshotOf>>['journal'];
  readonly relationships: Awaited<ReturnType<typeof snapshotOf>>['liveRelationships'];
  /** Agenda de chaque personnage à la fin de certains ticks. */
  readonly agendaAt: Record<number, SimState['characters'][string]['agenda']>;
}

export async function runChain(storage: EpochHarness['storage']): Promise<ChainRun> {
  const fixture = await seedWorld(storage, aWorld().build());
  const agendaAt: ChainRun['agendaAt'] = {};
  const spy = (ctx: { tick: number; state: SimState }): void => {
    agendaAt[ctx.tick] = structuredClone(ctx.state.characters[C.sarah]?.agenda ?? []);
  };
  const decision = new AgendaDecisionPolicy(new ChainScript());
  const outcome = new ScriptedOutcomeModel({
    propose_alliance: 'accepted',
    share_secret: 'believed',
    confront: 'escalated',
  });
  await interactionScheduler(storage, decision, outcome, fullHooks([spy])).run(runOf(fixture)).done;
  const snap = await snapshotOf(storage, fixture.world.id, 0);
  const state = await loadSimState(storage, fixture.world.id, fixture.season.number);
  const factId = Object.values(state.facts).find((f) => f.predicate === PROPOSAL)?.id ?? '';
  return { state, factId, journal: snap.journal, relationships: snap.liveRelationships, agendaAt };
}

export function chainScenarioSuite(name: string, factory: () => Promise<EpochHarness>): void {
  describe(`scénario chain (${name})`, () => {
    const run = async () => {
      const h = await factory();
      await h.reset();
      return runChain(h.storage).then(async (r) => ({ r, h }));
    };
    const { alexandre, sarah, lea, thomas } = IDS.characters;

    it('la proposition crée un fait vu par ses deux témoins seulement, avec son event d’origine', async () => {
      const { r, h } = await run();
      try {
        const fact = r.state.facts[r.factId];
        expect(fact).toMatchObject({ subjectId: alexandre, objectId: sarah, isTrue: true, sensitivity: 2 });
        const proposal = r.journal.events.find((e) => e.type === 'alliance_formed');
        expect(fact?.originEventId).toBe(proposal?.id);
        const holders = Object.values(r.state.knowledge)
          .filter((k) => k.factId === r.factId && k.sourceType === 'witnessed')
          .map((k) => k.characterId)
          .sort();
        expect(holders).toEqual([alexandre, sarah].sort());
      } finally {
        await h.close();
      }
    }, 60_000);

    it('provenance(Thomas, F1) donne la chaîne complète, relue du stockage', async () => {
      const { r, h } = await run();
      try {
        const chain = await h.storage.tx((s) => s.knowledge.provenance(thomas, r.factId));
        expect(chain.map((k) => [k.characterId, k.sourceType, k.toldById])).toEqual([
          [sarah, 'witnessed', null],
          [lea, 'told', sarah],
          [thomas, 'told', lea],
        ]);
        expect(chain).toEqual(provenance(r.state, thomas, r.factId));
        expect(chain[1]).toMatchObject({ belief: 'believes' });
        // conf_reçue = conf_émetteur × f(trust(récepteur→émetteur)), la confiance étant celle après l'interaction.
        const trust = (a: Id, b: Id) => r.relationships.find((e) => e.sourceId === a && e.targetId === b)?.trust ?? 30;
        expect(chain[1]?.confidence).toBeCloseTo(trustFactor(trust(lea, sarah)), 10);
        expect(chain[2]?.confidence).toBeCloseTo(trustFactor(trust(lea, sarah)) * trustFactor(trust(thomas, lea)), 10);
        expect(chain[2]?.confidence).toBeLessThan(chain[1]?.confidence ?? 0);
        const viaEvents = chain.map((k) => r.journal.events.find((e) => e.id === k.viaEventId)?.type);
        expect(viaEvents).toEqual(['alliance_formed', 'secret_shared', 'secret_shared']);
      } finally {
        await h.close();
      }
    }, 60_000);

    it('l’intention différée de Sarah naît à l’apprentissage, guide son choix, puis disparaît', async () => {
      const { r, h } = await run();
      try {
        expect(r.agendaAt[0]).toEqual([
          expect.objectContaining({ kind: 'tell', targetId: lea, factId: r.factId, locationId: null }),
        ]);
        // Sarah rejoint Léa à la cuisine (tick 3) : l'intention est exécutée par la politique d'agenda.
        const told = r.journal.decisions.find((d) => d.characterId === sarah && d.tick === 3 && d.kind === 'action');
        expect(told).toMatchObject({ policy: 'agenda@1' });
        expect(r.agendaAt[3]).toEqual([]);
        const sharing = r.journal.interactions.find((i) => i.action === 'share_secret' && i.initiatorId === sarah);
        expect(sharing?.tickStart).toBe(3);
      } finally {
        await h.close();
      }
    }, 60_000);

    it('les events forment la chaîne E1 ← E2 ← E3 ← E4 par caused_by (l’event par lequel l’émetteur a appris le fait)', async () => {
      const { r, h } = await run();
      try {
        const byType = (type: string) => r.journal.events.filter((e) => e.type === type);
        const [e1] = byType('alliance_formed');
        const [e2, e3] = byType('secret_shared');
        const [e4] = byType('confrontation');
        expect(byType('secret_shared')).toHaveLength(2);
        expect(e1?.causedByEventId).toBeNull();
        expect(e2?.causedByEventId).toBe(e1?.id);
        expect(e3?.causedByEventId).toBe(e2?.id);
        expect(e4?.causedByEventId).toBe(e3?.id);
        expect(r.state.facts[r.factId]?.originEventId).toBe(e1?.id);
        // Le sujet du fait figure dans l'event quand il n'en est ni l'acteur ni la cible.
        expect(e2?.participants).toContainEqual({ characterId: alexandre, role: 'subject' });
      } finally {
        await h.close();
      }
    }, 60_000);

    it('la confrontation de Thomas apprend à Alexandre d’où vient la fuite et retourne son alliance avec Sarah', async () => {
      const { r, h } = await run();
      try {
        const confrontation = r.journal.events.find((e) => e.type === 'confrontation');
        expect(confrontation?.payload).toMatchObject({
          traitorId: sarah,
          provenance: [
            { characterId: sarah, source: 'witnessed' },
            { characterId: lea, source: 'told', toldById: sarah },
            { characterId: thomas, source: 'told', toldById: lea },
          ],
        });
        // Alexandre garde sa connaissance d'origine et reçoit, via la confrontation, le chemin complet par `parent_knowledge_id`.
        const mine = Object.values(r.state.knowledge).filter(
          (k) => k.characterId === alexandre && k.factId === r.factId,
        );
        const viaThomas = mine.find((k) => k.toldById === thomas);
        expect(mine.find((k) => k.sourceType === 'witnessed')).toBeDefined();
        const path: Id[] = [];
        for (let k = viaThomas; k; k = k.parentKnowledgeId ? r.state.knowledge[k.parentKnowledgeId] : undefined) {
          path.push(k.characterId);
        }
        expect(path).toEqual([alexandre, thomas, lea, sarah]);

        const edge = (a: Id, b: Id) => r.relationships.find((e) => e.sourceId === a && e.targetId === b);
        expect(edge(alexandre, sarah)).toMatchObject({ alliance: 0, acquaintance: 'met' });
        expect(edge(alexandre, sarah)?.rivalry).toBeGreaterThanOrEqual(50);
        expect(edge(alexandre, sarah)?.labels).toContain('rival');
        expect(edge(alexandre, sarah)?.labels).not.toContain('ally');
        expect(edge(sarah, alexandre)?.alliance).toBe(0);
        expect(edge(thomas, alexandre)?.rivalry).toBeGreaterThan(0); // la confrontation elle-même
        const betrayal = r.journal.effects.filter((e) => e.ruleId === 'confront_betrayal');
        expect(betrayal.length).toBeGreaterThan(0);
        expect(betrayal.every((e) => e.eventId === confrontation?.id)).toBe(true);
      } finally {
        await h.close();
      }
    }, 60_000);
  });
}

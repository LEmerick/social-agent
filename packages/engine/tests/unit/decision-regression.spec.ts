/**
 * Non-régression M9 : les scénarios « alliance » et « chain » rejoués avec `UtilityDecisionPolicy` +
 * `ProbabilisticOutcomeModel`. Les originaux dépendent d'issues scriptées (`accepted_conditional`, `believed`,
 * `escalated`) : ici l'issue est tirée, donc on vérifie les mêmes types d'events, les mêmes effets par issue,
 * la même provenance et le rejeu du journal, sur plusieurs graines.
 */
import { describe, expect, it } from 'vitest';
import { relKey } from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { C } from '../helpers/epoch-kit.js';
import { runAllianceUtility, runChainUtility } from '../helpers/decision-scenarios.js';
import { replayedFromJournal } from '../helpers/interaction-kit.js';

const SEEDS = ['s0', 's1', 's2', 's3', 's4', 's5'];
const PROPOSAL_EVENTS = ['alliance_formed', 'alliance_declined', 'alliance_backfired', 'alliance_proposed'];

describe('scénario alliance avec Utility + Probabilistic', () => {
  it('la proposition voulue par la directive est jouée au tick 0 ; event, effets et décisions sont cohérents', async () => {
    let formed = 0;
    for (const seed of SEEDS) {
      const storage = createMemoryStorage();
      const run = await runAllianceUtility(storage, seed);
      const { journal } = run;

      const first = journal.interactions.find((i) => i.initiatorId === C.alexandre && i.action === 'propose_alliance');
      expect(first, seed).toBeDefined();
      expect(first?.tickStart).toBe(0);
      const event = journal.events.find((e) => e.interactionId === first?.id);
      expect(PROPOSAL_EVENTS).toContain(event?.type);
      expect(event?.participants).toEqual(
        expect.arrayContaining([
          { characterId: C.alexandre, role: 'actor' },
          { characterId: C.sarah, role: 'target' },
        ]),
      );

      // Les deux décisions de l'interaction portent leur provenance et leur tirage.
      const decisions = journal.decisions.filter((d) => d.interactionId === first?.id);
      expect(decisions.map((d) => [d.kind, d.policy]).sort()).toEqual([
        ['action', 'utility@1'],
        ['outcome', 'probabilistic@1'],
      ]);
      expect(decisions.every((d) => d.rngDraw !== null)).toBe(true);
      expect(decisions.find((d) => d.kind === 'outcome')?.chosen).toBe(first?.outcome);

      // Mêmes effets que le scénario scripté, selon l'issue tirée.
      const effects = journal.effects.filter((fx) => fx.eventId === event?.id);
      const alliance = effects.find(
        (fx) => fx.characterId === C.alexandre && fx.otherCharacterId === C.sarah && fx.dimension === 'alliance',
      );
      if (first?.outcome === 'accepted' || first?.outcome === 'accepted_conditional') {
        formed += 1;
        expect(event?.type).toBe(first.outcome === 'accepted' ? 'alliance_formed' : 'alliance_proposed');
        expect(alliance?.delta).toBeGreaterThanOrEqual(15);
      } else {
        expect(alliance).toBeUndefined();
      }

      // Le journal rejoué redonne l'état stocké.
      const rebuilt = await replayedFromJournal(storage, run.fixture, run.epoch.id);
      for (const state of run.states) {
        expect(rebuilt.characters[state.characterId]?.credits).toBe(state.credits);
      }
      for (const live of run.liveRelationships) {
        expect(rebuilt.relationships[relKey(live.sourceId, live.targetId)]).toMatchObject({
          alliance: live.alliance,
          trust: live.trust,
        });
      }
    }
    expect(formed).toBeGreaterThan(0);
  }, 60_000);

  it('rejouer la même graine redonne exactement les mêmes events', async () => {
    const a = await runAllianceUtility(createMemoryStorage(), 'rejeu');
    const b = await runAllianceUtility(createMemoryStorage(), 'rejeu');
    expect(a.journal.events).toEqual(b.journal.events);
    expect(a.journal.decisions).toEqual(b.journal.decisions);
  }, 60_000);
});

describe('scénario chain avec Agenda(Utility) + Probabilistic', () => {
  it('le fait de la proposition circule d’Alexandre à Sarah (témoins) puis à Léa (intention différée)', async () => {
    for (const seed of SEEDS) {
      const run = await runChainUtility(createMemoryStorage(), seed);
      expect(run.proposal, seed).toMatchObject({ subjectId: C.alexandre, objectId: C.sarah, isTrue: true });
      expect(run.chainOf(C.lea).map((k) => [k.characterId, k.sourceType, k.toldById])).toEqual([
        [C.sarah, 'witnessed', null],
        [C.lea, 'told', C.sarah],
      ]);
      // Le récit de Sarah à Léa est un secret partagé, décidé par la politique d'agenda puis résolu par le modèle.
      const told = run.journal.interactions.find(
        (i) =>
          i.initiatorId === C.sarah &&
          i.action === 'share_secret' &&
          i.participants.some((p) => p.characterId === C.lea),
      );
      expect(told).toBeDefined();
      const decision = run.journal.decisions.find((d) => d.interactionId === told?.id && d.kind === 'action');
      expect(decision?.policy).toBe('agenda@1');
      expect(run.journal.decisions.find((d) => d.interactionId === told?.id && d.kind === 'outcome')?.policy).toBe(
        'probabilistic@1',
      );
    }
  }, 120_000);
});

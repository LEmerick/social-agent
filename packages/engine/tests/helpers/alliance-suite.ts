import { describe, expect, it } from 'vitest';
import { ScriptedOutcomeModel, relKey, type StoragePort } from '@ai-reality/engine';
import { aWorld, seedWorld } from '@ai-reality/testkit';
import { ScriptedDecisionPolicy } from '../../src/decision/scripted-policy.js';
import { C, Z, L, go, snapshotOf } from './epoch-kit.js';
import { interactionScheduler, replayedFromJournal, runOf } from './interaction-kit.js';

export interface AllianceHarness {
  readonly storage: StoragePort;
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Scénario « alliance » de bout en bout : Alexandre et Sarah au jardin, Alexandre propose une alliance à Sarah,
 * issue `accepted_conditional` imposée. Tout se vérifie en base, sur chaque adaptateur de stockage.
 */
export function allianceSuite(name: string, factory: () => Promise<AllianceHarness>): void {
  describe(`scénario alliance (${name})`, () => {
    it('propose_alliance → accepted_conditional : event, effets, relations, décisions et ledger cohérents', async () => {
      const harness = await factory();
      try {
        const { storage } = harness;
        await harness.reset();
        const fixture = await seedWorld(storage, aWorld().build());
        const decision = new ScriptedDecisionPolicy({
          destinations: { [C.alexandre]: { 0: go(L.jardin, Z.banc) }, [C.sarah]: { 0: go(L.jardin, Z.banc) } },
          actions: {
            [C.alexandre]: {
              0: { action: 'propose_alliance', targetId: C.sarah, factId: null, itemId: null, locationId: null },
            },
          },
        });
        const outcome = new ScriptedOutcomeModel({ propose_alliance: 'accepted_conditional' });
        await interactionScheduler(storage, decision, outcome).run(runOf(fixture)).done;

        const snap = await snapshotOf(storage, fixture.world.id, 0);
        const { journal } = snap;

        // L'event et son interaction.
        const proposed = journal.events.filter((e) => e.type === 'alliance_proposed');
        expect(proposed).toHaveLength(1);
        const event = proposed[0];
        if (!event) throw new Error('event absent');
        expect(event.tick).toBe(0);
        expect(event.payload).toMatchObject({ action: 'propose_alliance', outcome: 'accepted_conditional' });
        expect(event.participants).toEqual(
          expect.arrayContaining([
            { characterId: C.alexandre, role: 'actor' },
            { characterId: C.sarah, role: 'target' },
          ]),
        );
        expect(journal.interactions).toHaveLength(1);
        expect(journal.interactions[0]).toMatchObject({
          id: event.interactionId,
          action: 'propose_alliance',
          outcome: 'accepted_conditional',
          mode: 'summarized',
          initiatorId: C.alexandre,
        });
        expect(journal.utterances).toHaveLength(1);
        expect(journal.utterances[0]).toMatchObject({
          speakerId: C.alexandre,
          addresseeIds: [C.sarah],
          intent: 'propose_alliance',
          volume: 'whisper',
        });

        // Les deux décisions, avec leur provenance.
        expect(journal.decisions.map((d) => [d.kind, d.policy, d.characterId, d.interactionId])).toEqual([
          ['action', 'scripted@1', C.alexandre, event.interactionId],
          ['outcome', 'scripted@1', C.alexandre, event.interactionId],
        ]);
        expect(journal.decisions[1]?.chosen).toBe('accepted_conditional');

        // Effets attendus (règle propose_alliance:accepted_conditional).
        const ruleEffects = journal.effects.filter((fx) => fx.eventId === event.id);
        const find = (kind: string, who: string, other: string | null, dim: string) =>
          ruleEffects.find(
            (fx) =>
              fx.targetKind === kind && fx.characterId === who && fx.otherCharacterId === other && fx.dimension === dim,
          );
        expect(find('relationship', C.alexandre, C.sarah, 'alliance')?.delta).toBe(15);
        expect(find('relationship', C.alexandre, C.sarah, 'trust')?.delta).toBe(4);
        expect(find('relationship', C.sarah, C.alexandre, 'alliance')?.delta).toBeGreaterThan(10);
        expect(find('stat', C.alexandre, null, 'energy')?.delta).toBe(-2);
        expect(find('stat', C.alexandre, null, 'influence')?.delta).toBe(3);
        expect(find('score', C.alexandre, null, 'social')?.delta).toBe(5);
        expect(journal.scoreEntries.filter((e) => e.eventId === event.id).map((e) => [e.characterId, e.score])).toEqual(
          expect.arrayContaining([
            [C.alexandre, 'social'],
            [C.sarah, 'social'],
          ]),
        );

        // Projection en base : rencontre enregistrée, alliance posée, arête relue = arête du snapshot final.
        const edge = snap.liveRelationships.find((r) => r.sourceId === C.alexandre && r.targetId === C.sarah);
        expect(edge).toMatchObject({
          acquaintance: 'met',
          alliance: 15,
          interactionCount: 1,
          firstMetEventId: event.id,
        });
        const back = snap.liveRelationships.find((r) => r.sourceId === C.sarah && r.targetId === C.alexandre);
        expect(back).toMatchObject({ acquaintance: 'met', interactionCount: 1 });

        // Ledger : l'entretien de fin d'époque, pour chacun des quatre ; C_fin = C_début + Σ montants.
        expect(journal.ledger).toHaveLength(4);
        for (const state of snap.states) {
          const sum = journal.ledger
            .filter((l) => l.characterId === state.characterId)
            .reduce((t, l) => t + l.amount, 0);
          expect(state.credits).toBe(100 + sum);
          expect(sum).toBe(-10);
        }

        // Le journal rejoué redonne les projections stockées.
        const rebuilt = await replayedFromJournal(storage, fixture, snap.epoch.id);
        expect(rebuilt.relationships[relKey(C.alexandre, C.sarah)]).toMatchObject({ alliance: 15, trust: 34 });
        for (const state of snap.states) {
          expect(rebuilt.characters[state.characterId]).toMatchObject({
            credits: state.credits,
            stats: state.stats,
            scores: state.scores,
          });
        }
      } finally {
        await harness.close();
      }
    }, 60_000);
  });
}

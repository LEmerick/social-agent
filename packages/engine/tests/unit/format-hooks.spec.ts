/** Hooks de format : annonces, dépôt d'objet, épreuve récompensée, mélange d'équipes, repas. */
import { describe, expect, it } from 'vitest';
import { ScriptedOutcomeModel, loadFormatState, parseSeasonFormat } from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { adventureWorld, seedWorld } from '@ai-reality/testkit';
import { snapshotOf } from '../helpers/epoch-kit.js';
import { formatScheduler, runNumber } from '../helpers/format-run-kit.js';
import { expectInventoryReplayed } from '../helpers/format-invariants.js';
import { ScenarioPolicy } from '../helpers/scenario-policy.js';

const format = parseSeasonFormat({
  format: 'adventure',
  missions: [],
  items: [
    { slug: 'idol', kind: 'resource', count: 0, placement: 'visible' },
    { slug: 'ration', kind: 'resource', count: 3, placement: 'challenge_reward' },
  ],
  schedule: [
    { kind: 'announcement', epoch: 0, tick: 5, params: { text: 'Bienvenue', location: 'salon' } },
    { kind: 'item_drop', epoch: 0, tick: 1, params: { item: 'idol' } },
    { kind: 'meal', epoch: 0, tick: 8, params: { location: 'salon' } },
    { kind: 'challenge', epoch: 0, tick: 12, params: { type: 'skill', reward: 'credits:7', location: 'jardin' } },
    { kind: 'team_shuffle', epoch: 1, tick: 0 },
  ],
});

describe('hooks de format', () => {
  it('annonce, dépôt, repas, épreuve récompensée, mélange d’équipes', async () => {
    const storage = createMemoryStorage();
    const fixture = await seedWorld(storage, adventureWorld({ characters: 8, seed: 'hooks' }));
    const play = async (number: number) => {
      await formatScheduler(storage, new ScenarioPolicy({}), {
        outcome: new ScriptedOutcomeModel(),
        format,
        seasonEpochs: 2,
      }).run(runNumber(fixture, number)).done;
      return snapshotOf(storage, fixture.world.id, number);
    };
    const e0 = await play(0);
    const at = (type: string, tick?: number) =>
      e0.journal.events.filter((e) => e.type === type && (tick === undefined || e.tick === tick));

    // Annonce : connaissance publique chez les participants dès le plan, puis la scène elle-même.
    const fs = await loadFormatState(storage, fixture.season.id);
    const announcement = Object.values(fs.scheduled).find((s) => s.kind === 'announcement');
    const facts = await storage.tx((s) => s.facts.listByWorld(fixture.world.id));
    const knownFact = facts.find((f) => f.objectText === `scheduled:${announcement?.id ?? ''}`);
    const knowledge = await storage.tx((s) => s.knowledge.listByWorld(fixture.world.id));
    expect(knowledge.filter((k) => k.factId === knownFact?.id && k.sourceType === 'public')).toHaveLength(8);
    expect(at('announcement', 5)[0]?.payload).toMatchObject({ text: 'Bienvenue' });

    // Dépôt d'objet : un exemplaire neuf, issu de l'événement planifié.
    const fired = e0.journal.events.find((e) => e.type === 'scheduled_fired' && e.payload['kind'] === 'item_drop');
    expect(at('item_placed', 1)[0]).toMatchObject({ causedByEventId: fired?.id });

    // Repas : les convoqués se réunissent au salon.
    expect(at('meal_shared', 8)).toHaveLength(1);

    // Épreuve : un gagnant (équipe), des crédits, trois rations pour quatre vainqueurs.
    const result = at('team_challenge_resolved', 12)[0];
    expect(result?.payload['reward']).toBe('credits:7');
    const winners = result?.participants.filter((p) => p.role === 'actor').map((p) => p.characterId) ?? [];
    const losers = result?.participants.filter((p) => p.role === 'target').map((p) => p.characterId) ?? [];
    expect(winners).toHaveLength(4);
    expect(losers).toHaveLength(4);
    const credits = (id: string) => e0.states.find((s) => s.characterId === id)?.credits ?? 0;
    expect(credits(winners[0] ?? '')).toBe(credits(losers[0] ?? '') + 7);
    expect(at('item_picked_up').filter((e) => e.tick === 12)).toHaveLength(3);

    // Mélange : les membres sont redistribués à l'époque suivante.
    const e1 = await play(1);
    expect(e1.journal.events.filter((e) => e.type === 'team_member_moved' && e.tick === 0).length).toBeGreaterThan(0);
    await expectInventoryReplayed(storage, fixture);
  });
});

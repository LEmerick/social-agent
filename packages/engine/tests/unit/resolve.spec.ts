/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
import { describe, expect, it } from 'vitest';
import { ScriptedOutcomeModel, resolveInteraction, habituationFactor, habituationKey } from '../../src/rules/index.js';
import { defaultEdge } from '../../src/state/apply-effect.js';
import { relKey } from '../../src/state/types.js';
import { Rng } from '../../src/core/rng.js';
import { idsFor, opt, palmiersState, salonScene } from '../helpers/palmiers.js';
import { deltas } from '../helpers/summary.js';

describe('scénario alliance (niveau pur, Palmiers)', () => {
  it('Alexandre propose une alliance à Sarah : accepted_conditional ⇒ alliance_proposed, effets, acquaintance met', async () => {
    const state = palmiersState();
    const option = opt('propose_alliance', 'sarah');
    expect(state.relationships[relKey('alexandre', 'sarah')]).toBeUndefined();

    const model = new ScriptedOutcomeModel(['accepted_conditional']);
    const decided = await model.resolve({ option, actorId: 'alexandre', state });
    expect(decided).toMatchObject({ outcome: 'accepted_conditional', policy: 'scripted@1', rngDraw: null });

    const res = resolveInteraction(
      state,
      { option, actorId: 'alexandre', outcome: decided.outcome, ctx: salonScene(), witnessIds: ['lea', 'alexandre'] },
      idsFor(state),
    );

    expect(res.event).toMatchObject({
      type: 'alliance_proposed',
      seq: 1,
      tick: 3,
      epochId: 'epoch-0',
      importance: 0.6,
      participants: [
        { characterId: 'alexandre', role: 'actor' },
        { characterId: 'sarah', role: 'target' },
        { characterId: 'lea', role: 'witness' },
      ],
    });
    expect(state.nextEventSeq).toBe(2);
    expect(res.effects[0]).toMatchObject({
      ruleId: 'cost',
      ruleVersion: 1,
      dimension: 'energy',
      delta: -2,
      valueAfter: 98,
    });
    expect(deltas(res.effects)).toMatchObject({
      'rel:sarah>alexandre:trust': 7.6,
      'rel:alexandre>sarah:trust': 4,
      'rel:alexandre>sarah:alliance': 15,
      'rel:sarah>alexandre:alliance': 12.5,
      'stat:alexandre:influence': 3,
    });

    const ab = state.relationships[relKey('alexandre', 'sarah')]!;
    const ba = state.relationships[relKey('sarah', 'alexandre')]!;
    for (const e of [ab, ba]) {
      expect(e.acquaintance).toBe('met');
      expect(e.interactionCount).toBe(1);
      expect(e.firstMetEventId).toBe(res.event.id);
      expect(e.lastInteractionEventId).toBe(res.event.id);
    }
    expect(ab.alliance).toBe(15);
    expect(ba.alliance).toBe(12.5);
    expect(res.relationships.map((e) => relKey(e.sourceId, e.targetId))).toEqual([
      'alexandre>sarah',
      'sarah>alexandre',
    ]);
    expect(res.scoreEntries.map((s) => [s.characterId, s.score, s.impact, s.weight])).toEqual([
      ['alexandre', 'social', 5, 1],
      ['sarah', 'social', 3, 1],
    ]);
    expect(state.dailyCounts[habituationKey('alexandre', 'propose_alliance', 'sarah')]).toBe(1);
    // L'arête renvoyée est une copie : muter la projection n'altère pas l'état.
    res.relationships[0]!.trust = 0;
    expect(ab.trust).toBe(34);
  });

  it('seconde interaction : firstMetEventId conservé, compteur et dernier event mis à jour', () => {
    const state = palmiersState();
    const ids = idsFor(state);
    const a = resolveInteraction(
      state,
      { option: opt('small_talk', 'sarah'), actorId: 'alexandre', outcome: 'accepted' },
      ids,
    );
    const b = resolveInteraction(
      state,
      { option: opt('small_talk', 'alexandre'), actorId: 'sarah', outcome: 'accepted' },
      ids,
    );
    const e = state.relationships[relKey('alexandre', 'sarah')]!;
    expect(e.interactionCount).toBe(2);
    expect(e.firstMetEventId).toBe(a.event.id);
    expect(e.lastInteractionEventId).toBe(b.event.id);
    expect(b.event.seq).toBe(2);
  });

  it('une action cachée non détectée ne fait pas “rencontrer” ; détectée, si', () => {
    const state = palmiersState({ rules: { enabledActions: ['steal'] } });
    const ids = idsFor(state);
    resolveInteraction(
      state,
      { option: opt('steal', 'sarah', { itemId: 'i1' }), actorId: 'alexandre', outcome: 'undetected' },
      ids,
    );
    expect(state.relationships[relKey('alexandre', 'sarah')]).toBeUndefined();
    resolveInteraction(
      state,
      { option: opt('steal', 'sarah', { itemId: 'i1' }), actorId: 'alexandre', outcome: 'detected' },
      ids,
    );
    expect(state.relationships[relKey('alexandre', 'sarah')]!.acquaintance).toBe('met');
  });
});

describe('habituation', () => {
  it('facteurs : ×1, ×1, ×0,5, ×0,25', () => {
    expect([0, 1, 2, 3, 9].map(habituationFactor)).toEqual([1, 1, 0.5, 0.25, 0.25]);
  });

  it('la 3ᵉ flatterie du jour rapporte moins ; une autre cible n’est pas affectée ; effets annotés', () => {
    const state = palmiersState();
    const ids = idsFor(state);
    const gains: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = resolveInteraction(
        state,
        { option: opt('compliment', 'sarah'), actorId: 'alexandre', outcome: 'accepted' },
        ids,
      );
      gains.push(deltas(r.effects)['rel:sarah>alexandre:affection']!);
      if (i === 2) {
        const fx = r.effects.find((e) => e.dimension === 'affection' && e.characterId === 'sarah')!;
        expect(fx.reason).toBe('habituation@1 x0.5');
      }
    }
    expect(gains).toEqual([3.4, 3.4, 1.7, 0.85]);
    const other = resolveInteraction(
      state,
      { option: opt('compliment', 'lea'), actorId: 'alexandre', outcome: 'accepted' },
      ids,
    );
    expect(deltas(other.effects)['rel:lea>alexandre:affection']).toBe(3.4);
    expect(state.dailyCounts[habituationKey('alexandre', 'compliment', 'sarah')]).toBe(4);
  });

  it('le coût en énergie n’est pas atténué', () => {
    const state = palmiersState();
    const ids = idsFor(state);
    for (let i = 0; i < 4; i++) {
      const r = resolveInteraction(
        state,
        { option: opt('compliment', 'sarah'), actorId: 'alexandre', outcome: 'accepted' },
        ids,
      );
      expect(r.effects[0]).toMatchObject({ ruleId: 'cost', delta: -1 });
    }
    expect(state.characters['alexandre']!.stats.energy).toBe(96);
  });
});

describe('bornes', () => {
  it('clamp des axes de base : plafond 100, plancher −100 pour l’affection, valueAfter après clamp', () => {
    const state = palmiersState();
    state.relationships[relKey('sarah', 'alexandre')] = {
      ...defaultEdge('sarah', 'alexandre'),
      trust: 98,
      affection: -99,
    };
    const r = resolveInteraction(
      state,
      { option: opt('express_feelings', 'sarah'), actorId: 'alexandre', outcome: 'refused' },
      idsFor(state),
    );
    expect(state.relationships[relKey('sarah', 'alexandre')]!.affection).toBe(-100);
    const fx = r.effects.find((e) => e.characterId === 'sarah' && e.dimension === 'affection')!;
    expect(fx).toMatchObject({ delta: -1, valueAfter: -100 });
    const up = resolveInteraction(
      state,
      { option: opt('confide', 'sarah'), actorId: 'alexandre', outcome: 'accepted' },
      idsFor(state),
    );
    expect(up.effects.find((e) => e.dimension === 'trust' && e.characterId === 'sarah')!.valueAfter).toBe(100);
  });

  it('extraAxes de saison : bornés à 0..100 ; axe inconnu refusé', () => {
    const state = palmiersState({ rules: { relationshipAxes: ['complicite'] } });
    const extra = (delta: number, dimension = 'complicite') => ({
      targetKind: 'relationship' as const,
      characterId: 'sarah',
      otherCharacterId: 'alexandre',
      dimension,
      delta,
      ruleId: 'saison:complicite',
      ruleVersion: 1,
      reason: null,
    });
    const ids = idsFor(state);
    const a = resolveInteraction(
      state,
      { option: opt('small_talk', 'sarah'), actorId: 'alexandre', outcome: 'accepted', extraEffects: [extra(150)] },
      ids,
    );
    expect(a.effects.at(-1)!.valueAfter).toBe(100);
    resolveInteraction(
      state,
      { option: opt('small_talk', 'sarah'), actorId: 'alexandre', outcome: 'accepted', extraEffects: [extra(-500)] },
      ids,
    );
    expect(state.relationships[relKey('sarah', 'alexandre')]!.extraAxes['complicite']).toBe(0);
    expect(() =>
      resolveInteraction(
        state,
        {
          option: opt('small_talk', 'sarah'),
          actorId: 'alexandre',
          outcome: 'accepted',
          extraEffects: [extra(1, 'inconnu')],
        },
        ids,
      ),
    ).toThrow(/Axe de relation inconnu/);
  });

  it("étiquettes : 'ally' à alliance ≥ 50, 'rival' à rivalité ≥ 50, retirées en dessous", () => {
    const state = palmiersState();
    state.relationships[relKey('alexandre', 'sarah')] = {
      ...defaultEdge('alexandre', 'sarah'),
      alliance: 40,
      labels: ['flirt'],
    };
    state.relationships[relKey('thomas', 'alexandre')] = { ...defaultEdge('thomas', 'alexandre'), rivalry: 45 };
    const ids = idsFor(state);
    const r = resolveInteraction(
      state,
      { option: opt('propose_alliance', 'sarah'), actorId: 'alexandre', outcome: 'accepted' },
      ids,
    );
    expect(state.relationships[relKey('alexandre', 'sarah')]!.labels).toEqual(['flirt', 'ally']);
    expect(r.relationships.find((e) => e.sourceId === 'alexandre')!.labels).toEqual(['flirt', 'ally']);
    resolveInteraction(state, { option: opt('provoke', 'thomas'), actorId: 'alexandre', outcome: 'escalated' }, ids);
    expect(state.relationships[relKey('thomas', 'alexandre')]!.labels).toEqual(['rival']);
    resolveInteraction(
      state,
      { option: opt('break_alliance', 'sarah'), actorId: 'alexandre', outcome: 'accepted' },
      ids,
    );
    expect(state.relationships[relKey('alexandre', 'sarah')]!.labels).toEqual(['flirt']);
  });
});

describe('garde-fous', () => {
  it('refuse issue non autorisée, action hors catalogue, cible invalide, sans époque, payante en restricted', () => {
    const state = palmiersState({ rules: { enabledActions: [] } });
    const ids = idsFor(state);
    const base = { actorId: 'alexandre', outcome: 'accepted' };
    expect(() =>
      resolveInteraction(state, { ...base, option: opt('compliment', 'sarah'), outcome: 'won' }, ids),
    ).toThrow(/non autorisée/);
    expect(() => resolveInteraction(state, { ...base, option: opt('teleport', 'sarah') }, ids)).toThrow(
      /hors catalogue/,
    );
    expect(() => resolveInteraction(state, { ...base, option: opt('compliment', 'alexandre') }, ids)).toThrow(
      /Cible invalide/,
    );
    expect(() => resolveInteraction(state, { ...base, option: opt('compliment', null) }, ids)).toThrow(
      /Cible invalide/,
    );
    expect(() => resolveInteraction(state, { ...base, option: opt('steal', 'sarah') }, ids)).toThrow(/non activée/);
    // préconditions revérifiées si le contexte est fourni
    expect(() =>
      resolveInteraction(state, { ...base, option: opt('confide', 'sarah'), ctx: salonScene() }, ids),
    ).toThrow(/preconditions/);

    state.characters['alexandre']!.status = 'restricted';
    expect(() =>
      resolveInteraction(state, { ...base, option: opt('sabotage', 'sarah'), outcome: 'detected' }, ids),
    ).toThrow(/restricted/);
    expect(state.nextEventSeq).toBe(1);

    const noEpoch = palmiersState();
    noEpoch.epoch = null;
    expect(() => resolveInteraction(noEpoch, { ...base, option: opt('compliment', 'sarah') }, ids)).toThrow(
      /Aucune époque/,
    );
  });

  it('les actions payantes débitent crédits et ledger au prix du catalogue ou imposé', () => {
    const state = palmiersState();
    const ids = idsFor(state);
    const s = resolveInteraction(
      state,
      { option: opt('sabotage', 'sarah'), actorId: 'alexandre', outcome: 'undetected' },
      ids,
    );
    expect(state.characters['alexandre']!.credits).toBe(90);
    expect(s.ledger).toEqual([
      expect.objectContaining({
        characterId: 'alexandre',
        amount: -10,
        category: 'special_action',
        eventId: s.event.id,
      }),
    ]);
    const j = resolveInteraction(
      state,
      { option: opt('join_activity', 'slot-1'), actorId: 'alexandre', outcome: 'accepted', creditCost: 5 },
      ids,
    );
    expect(j.ledger[0]).toMatchObject({ amount: -5, category: 'activity' });
    expect(state.characters['alexandre']!.credits).toBe(85);
  });

  it('rest régénère l’énergie (cost@1 positif), plafonnée à 100', () => {
    const state = palmiersState();
    state.characters['alexandre']!.stats.energy = 40;
    const r = resolveInteraction(
      state,
      { option: opt('rest'), actorId: 'alexandre', outcome: 'accepted' },
      idsFor(state),
    );
    expect(r.effects[0]).toMatchObject({ ruleId: 'cost', delta: 10, valueAfter: 50 });
    state.characters['alexandre']!.stats.energy = 95;
    const r2 = resolveInteraction(
      state,
      { option: opt('rest'), actorId: 'alexandre', outcome: 'accepted' },
      idsFor(state),
    );
    expect(r2.effects[0]!.valueAfter).toBe(100);
  });

  it('même état + mêmes identifiants ⇒ même résolution (pureté)', () => {
    const run = () => {
      const state = palmiersState();
      return resolveInteraction(
        state,
        { option: opt('flirt', 'thomas'), actorId: 'sarah', outcome: 'accepted' },
        idsFor(state),
      );
    };
    expect(run()).toEqual(run());
    expect(new Rng(1).next()).toBe(new Rng(1).next());
  });
});

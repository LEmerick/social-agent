/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
import { describe, expect, it } from 'vitest';
import {
  chargeAction,
  closingBalance,
  refusalReason,
  resolveInteraction,
  settleEpoch,
  availableOptions,
  stateHash,
  replayEffects,
  replayStatuses,
  habituationKey,
} from '../../src/rules/index.js';
import type { EffectRecord, EventRecord, LedgerRecord } from '../../src/state/journal.js';
import { idsFor, opt, palmiersState, salonScene } from '../helpers/palmiers.js';

const epoch = (n: number) => ({ id: `epoch-${String(n)}`, number: n });

describe('chargeAction', () => {
  it('débite les crédits (ledger, effet cost@1) ; rien pour une action gratuite', () => {
    const state = palmiersState();
    const ids = idsFor(state);
    const link = { eventId: 'e1', epochId: 'epoch-0', tick: 3 };
    const free = chargeAction(state, 'alexandre', opt('compliment', 'sarah'), link, ids);
    expect(free).toEqual({ effects: [], ledger: [] });
    const paid = chargeAction(state, 'alexandre', opt('sabotage', 'sarah'), link, ids);
    expect(paid.effects[0]).toMatchObject({
      ruleId: 'cost',
      ruleVersion: 1,
      targetKind: 'credit',
      delta: -10,
      valueAfter: 90,
    });
    expect(paid.ledger[0]).toMatchObject({ amount: -10, category: 'special_action', source: 'system', eventId: 'e1' });
  });

  it('refuse une action payante en restricted ou avec un solde insuffisant', () => {
    const state = palmiersState();
    const ids = idsFor(state);
    const link = { eventId: 'e1', epochId: 'epoch-0', tick: 3 };
    state.characters['alexandre']!.credits = 5;
    expect(() => chargeAction(state, 'alexandre', opt('sabotage', 'sarah'), link, ids)).toThrow(/credits/);
    state.characters['alexandre']!.credits = 100;
    state.characters['alexandre']!.status = 'restricted';
    expect(() => chargeAction(state, 'alexandre', opt('sabotage', 'sarah'), link, ids)).toThrow(/restricted/);
    expect(refusalReason(state, 'alexandre', opt('join_activity', 'slot'), salonScene({ openSlots: ['slot'] }))).toBe(
      'restricted',
    );
    expect(
      availableOptions(state, 'alexandre', salonScene({ openSlots: ['slot'] })).every(
        (o) => o.action !== 'join_activity',
      ),
    ).toBe(true);
  });
});

describe('settleEpoch', () => {
  it('entretien journalier : C_fin = C_début − Σ débits + Σ crédits', () => {
    const state = palmiersState();
    const ids = idsFor(state);
    const opening = state.characters['alexandre']!.credits;
    const spent = resolveInteraction(
      state,
      { option: opt('sabotage', 'sarah'), actorId: 'alexandre', outcome: 'undetected' },
      ids,
    );
    const res = settleEpoch(state, epoch(0), ids);
    const ledger: LedgerRecord[] = [...spent.ledger, ...res.ledger];
    expect(ledger.map((l) => [l.category, l.amount]).filter((_, i) => i < 2)).toEqual([
      ['special_action', -10],
      ['upkeep', -10],
    ]);
    expect(state.characters['alexandre']!.credits).toBe(80);
    expect(closingBalance(opening, ledger, 'alexandre')).toBe(state.characters['alexandre']!.credits);
    // un crédit (récompense) entre dans la formule avec son signe
    const reward: LedgerRecord = { ...ledger[0]!, id: 'r', amount: 25, category: 'reward', source: 'earned' };
    expect(closingBalance(opening, [...ledger, reward], 'alexandre')).toBe(105);
    // chaque personnage actif paie l'entretien, un event upkeep_charged chacun
    expect(res.ledger).toHaveLength(4);
    expect(res.events.filter((e) => e.type === 'upkeep_charged')).toHaveLength(4);
    expect(res.effects.every((e) => e.ruleId === 'upkeep' && e.delta === -10)).toBe(true);
  });

  it('active → restricted → elimination_pending → eliminated, chaque transition = event status_changed + effets', () => {
    const state = palmiersState();
    const c = state.characters['thomas']!;
    c.credits = 25;
    const initial = structuredClone(state);
    const all = { effects: [] as EffectRecord[], events: [] as EventRecord[] };
    const settle = (n: number, eliminate: string[] = []) => {
      state.epoch = epoch(n);
      state.tick = 31;
      const r = settleEpoch(state, epoch(n), idsFor(state, `settle-${String(n)}`), { eliminate });
      all.effects.push(...r.effects);
      all.events.push(...r.events);
      return r;
    };
    const changes = (r: { events: EventRecord[] }) =>
      r.events.filter((e) => e.type === 'status_changed' && e.payload['characterId'] === 'thomas');

    // époque 3 : 25 − 10 = 15 < 20 ⇒ restricted
    let r = settle(3);
    expect(c.status).toBe('restricted');
    expect(c.restrictedSinceEpoch).toBe(3);
    expect(changes(r)).toHaveLength(1);
    expect(changes(r)[0]).toMatchObject({
      importance: 0.5,
      payload: { from: 'active', to: 'restricted', rule: 'survival@1', credits: 15, threshold: 20, epochNumber: 3 },
      participants: [{ characterId: 'thomas', role: 'subject' }],
    });
    expect(r.effects.filter((e) => e.characterId === 'thomas' && e.ruleId.startsWith('survival'))).toMatchObject([
      { dimension: 'survival', delta: -3, ruleId: 'survival:restricted' },
      { dimension: 'morale', delta: -5 },
    ]);
    expect(r.scoreEntries.filter((s) => s.characterId === 'thomas')).toMatchObject([{ score: 'survival', impact: -3 }]);

    // époque 4 : encore dans le délai de grâce (2 époques)
    r = settle(4);
    expect(c.status).toBe('restricted');
    expect(changes(r)).toHaveLength(0);

    // époque 5 : échéance dépassée ⇒ elimination_pending
    r = settle(5);
    expect(c.status).toBe('elimination_pending');
    expect(changes(r)[0]!.payload).toMatchObject({ from: 'restricted', to: 'elimination_pending' });

    // pas d’élimination implicite
    r = settle(6);
    expect(c.status).toBe('elimination_pending');
    expect(changes(r)).toHaveLength(0);

    // règle de saison : élimination explicite
    r = settle(7, ['thomas']);
    expect(c.status).toBe('eliminated');
    expect(changes(r)[0]).toMatchObject({ importance: 1, payload: { from: 'elimination_pending', to: 'eliminated' } });

    // un éliminé ne paie plus rien
    const before = c.credits;
    settle(8);
    expect(c.credits).toBe(before);
    expect(() => settleEpoch(state, epoch(9), idsFor(state), { eliminate: ['sarah'] })).toThrow(/elimination_pending/);

    // rejeu : effets + events de statut reconstruisent l'état de Thomas
    const replayed = replayStatuses(replayEffects(initial, all.effects), all.events);
    expect(replayed.characters['thomas']).toEqual(c);
  });

  it('régularisation : restricted → active dès que le solde repasse au seuil', () => {
    const state = palmiersState();
    const c = state.characters['sarah']!;
    c.credits = 25;
    settleEpoch(state, epoch(0), idsFor(state));
    expect(c.status).toBe('restricted');
    c.credits = 60; // l'intervention du joueur ou des gains rechargent le compte
    const r = settleEpoch(state, epoch(1), idsFor(state, 'b'));
    expect(c.credits).toBe(50);
    expect(c.status).toBe('active');
    expect(c.restrictedSinceEpoch).toBeNull();
    const ev = r.events.find((e) => e.type === 'status_changed')!;
    expect(ev.payload).toMatchObject({ from: 'restricted', to: 'active' });
    expect(r.effects.filter((e) => e.ruleId === 'survival:active').map((e) => [e.dimension, e.delta])).toEqual([
      ['survival', 2],
      ['morale', 5],
    ]);
  });

  it('une seule transition par époque, même avec un solde très bas', () => {
    const state = palmiersState();
    state.characters['lea']!.credits = -50;
    const r = settleEpoch(state, epoch(0), idsFor(state));
    expect(state.characters['lea']!.status).toBe('restricted');
    expect(r.events.filter((e) => e.type === 'status_changed')).toHaveLength(1);
  });

  it('économie désactivée : ni entretien ni transition ; remet à zéro les compteurs d’habituation', () => {
    const state = palmiersState();
    state.dailyCounts[habituationKey('alexandre', 'compliment', 'sarah')] = 3;
    state.characters['lea']!.credits = 0;
    const off = structuredClone(state.season.rules.economy);
    const disabled = palmiersState({ rules: { economy: { ...off, enabled: false } } });
    disabled.characters['lea']!.credits = 0;
    const r = settleEpoch(disabled, epoch(0), idsFor(disabled));
    expect(r).toMatchObject({ ledger: [], events: [], effects: [] });
    expect(disabled.characters['lea']!.status).toBe('active');
    const h = stateHash(state);
    settleEpoch(state, epoch(0), idsFor(state));
    expect(state.dailyCounts).toEqual({});
    expect(stateHash(state)).not.toBe(h);
  });
});

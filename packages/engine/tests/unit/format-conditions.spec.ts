import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/core/errors.js';
import { createFact } from '../../src/knowledge/facts.js';
import { witness } from '../../src/knowledge/transmit.js';
import {
  type Bindings,
  type Condition,
  ConditionSchema,
  evaluate,
  formatOf,
  parseCondition,
  pairKey,
} from '../../src/formats/index.js';
import { defaultEdge } from '../../src/state/apply-effect.js';
import { relKey } from '../../src/state/types.js';
import { A, DEF, L, LEA, S, T, formatKit, must, hears } from '../helpers/format-kit.js';

const itemId = (n: number) => `01960000-0000-7000-8000-${(0x810000 + n).toString(16).padStart(12, '0')}`;

/** État : Léa détient le collier, Sarah une ration, Thomas un faux collier ; Alexandre sait que Léa a le collier (0,8). */
function scene() {
  const { state, fc } = formatKit(4, 8);
  const fs = formatOf(state);
  const put = (n: number, defId: string, holderId: string | null, extra = {}) => {
    fs.items[itemId(n)] = {
      id: itemId(n),
      itemDefId: defId,
      holderId,
      locationId: holderId ? null : L.jardin,
      hidden: false,
      searchDifficulty: null,
      isFake: false,
      fakeOfItemDefId: null,
      state: 'active',
      ...extra,
    };
  };
  put(1, DEF.necklace, LEA);
  put(2, DEF.ration, S);
  put(3, DEF.ration, S);
  put(4, DEF.necklace, T, { isFake: true, fakeOfItemDefId: DEF.necklace });
  const fact = createFact(
    state,
    { subjectId: LEA, predicate: 'holds', objectText: `item:${itemId(1)}`, sensitivity: 3 },
    fc.ids,
  );
  witness(state, { factIds: [fact.id], witnesses: hears(A), viaEventId: null, epoch: 4, tick: 8 }, fc.ids);
  // Confiance 1 par défaut : on l'abaisse pour tester minConfidence.
  for (const k of Object.values(state.knowledge)) state.knowledge[k.id] = { ...k, confidence: 0.8 };
  state.relationships[relKey(S, A)] = { ...defaultEdge(S, A), trust: 65, alliance: 55 };
  state.relationships[relKey(A, S)] = { ...defaultEdge(A, S), trust: 40, alliance: 30 };
  must(state.characters[A]).stats.popularity = 72;
  fs.actionLog.push(
    { actorId: A, action: 'confront', targetId: T, locationId: null, epoch: 3, tick: 2 },
    { actorId: A, action: 'confront', targetId: T, locationId: null, epoch: 3, tick: 9 },
    { actorId: S, action: 'search', targetId: null, locationId: L.jardin, epoch: 3, tick: 4 },
  );
  fs.presence[pairKey(A, S)] = 6;
  return { state, fs, fact };
}

type Case = [name: string, cond: Condition, expected: boolean, bindings?: Bindings];

describe('DSL de conditions : prédicats', () => {
  const { state } = scene();
  const cases: Case[] = [
    // holds
    ['holds : Léa tient le collier', { holds: { who: LEA, item: 'immunity_necklace' } }, true],
    ['holds : le faux collier ne compte pas', { holds: { who: T, item: 'immunity_necklace' } }, false],
    ['holds : n’importe qui (?)', { holds: { who: '?', item: 'immunity_necklace' } }, true],
    ['holds : préfixe item_def:', { holds: { who: LEA, item: 'item_def:immunity_necklace' } }, true],
    ['holds : deux rations chez Sarah', { holds: { who: S, item: 'food_ration', count: { gte: 2 } } }, true],
    ['holds : pas trois rations', { holds: { who: S, item: 'food_ration', count: { gte: 3 } } }, false],
    ['holds : exactement zéro', { holds: { who: A, item: 'food_ration', count: { eq: 0 } } }, true],
    ['holds : $self', { holds: { who: '$self', item: 'food_ration' } }, true, { self: S }],
    ['holds : objet inconnu', { holds: { who: '?', item: 'inconnu' } }, false],
    // knows
    [
      'knows : Alexandre sait que Léa tient le collier',
      { knows: { who: A, fact: { predicate: 'holds', object: 'item_def:immunity_necklace' } } },
      true,
    ],
    [
      'knows : seuil 0,7 atteint',
      { knows: { who: A, fact: { predicate: 'holds', object: 'item_def:immunity_necklace' }, minConfidence: 0.7 } },
      true,
    ],
    [
      'knows : seuil 0,9 non atteint',
      { knows: { who: A, fact: { predicate: 'holds', object: 'item_def:immunity_necklace' }, minConfidence: 0.9 } },
      false,
    ],
    ['knows : sujet précisé', { knows: { who: A, fact: { predicate: 'holds', subject: LEA } } }, true],
    ['knows : mauvais sujet', { knows: { who: A, fact: { predicate: 'holds', subject: S } } }, false],
    ['knows : Sarah ne sait rien', { knows: { who: S, fact: { predicate: 'holds' } } }, false],
    ['knows : $self + ?', { knows: { who: '$self', fact: { predicate: 'holds', subject: '?' } } }, true, { self: A }],
    ['knows : quantifier all sur ?', { knows: { who: '?', quantifier: 'all', fact: { predicate: 'holds' } } }, false],
    // relationship
    ['relationship : confiance S→A ≥ 60', { relationship: { from: S, to: A, axis: 'trust', cmp: { gte: 60 } } }, true],
    ['relationship : confiance A→S < 60', { relationship: { from: A, to: S, axis: 'trust', cmp: { gte: 60 } } }, false],
    [
      'relationship : alliance mutuelle ≥ 50 (A→S = 30)',
      { relationship: { from: A, to: S, axis: 'alliance', cmp: { gte: 50 }, mutual: true } },
      false,
    ],
    [
      'relationship : alliance mutuelle ≥ 30',
      { relationship: { from: A, to: S, axis: 'alliance', cmp: { gte: 30 }, mutual: true } },
      true,
    ],
    [
      'relationship : « cible → moi » avec $self',
      { relationship: { from: '?', to: '$self', axis: 'trust', cmp: { gte: 60 } } },
      true,
      { self: A },
    ],
    [
      'relationship : relation par défaut (alliance 0)',
      { relationship: { from: T, to: LEA, axis: 'alliance', cmp: { lt: 20 } } },
      true,
    ],
    [
      'relationship : jamais avec soi-même',
      { relationship: { from: A, to: A, axis: 'alliance', cmp: { lt: 20 } } },
      false,
    ],
    // stat
    ['stat : popularité ≥ 70', { stat: { who: A, stat: 'popularity', cmp: { gte: 70 } } }, true],
    ['stat : popularité > 72', { stat: { who: A, stat: 'popularity', cmp: { gt: 72 } } }, false],
    ['stat : crédits', { stat: { who: A, stat: 'credits', cmp: { gte: 100 } } }, true],
    ['stat : score', { stat: { who: A, stat: 'drama', cmp: { eq: 0 } } }, true],
    ['stat : stat inconnue', { stat: { who: A, stat: 'charme', cmp: { gte: 0 } } }, false],
    // action_done
    ['action_done : confront envers Thomas', { action_done: { who: A, action: 'confront', target: T } }, true],
    ['action_done : deux fois', { action_done: { who: A, action: 'confront', target: T, count: { gte: 2 } } }, true],
    ['action_done : trois fois', { action_done: { who: A, action: 'confront', target: T, count: { gte: 3 } } }, false],
    ['action_done : mauvaise cible', { action_done: { who: A, action: 'confront', target: S } }, false],
    ['action_done : n’importe qui a fouillé', { action_done: { who: '?', action: 'search' } }, true],
    // present_with
    ['present_with : 6 ticks avec Sarah', { present_with: { who: A, with: S, ticks: 6 } }, true],
    ['present_with : 7 ticks non atteints', { present_with: { who: A, with: S, ticks: 7 } }, false],
    ['present_with : symétrique', { present_with: { who: S, with: A, ticks: 3 } }, true],
    ['present_with : jamais croisés', { present_with: { who: A, with: T, ticks: 1 } }, false],
    // count_active, epoch_gte, before
    ['count_active : 4 en jeu (≤ 4)', { count_active: { lte: 4 } }, true],
    ['count_active : pas ≤ 3', { count_active: { lte: 3 } }, false],
    ['epoch_gte : époque 4 ≥ 4', { epoch_gte: 4 }, true],
    ['epoch_gte : pas ≥ 5', { epoch_gte: 5 }, false],
    ['before : jusqu’à l’époque 4 incluse', { before: { epoch: 4 } }, true],
    ['before : trop tard', { before: { epoch: 3 } }, false],
    ['before : $deadline atteinte', { before: { epoch: '$deadline' } }, true, { deadline: 4 }],
    ['before : $deadline dépassée', { before: { epoch: '$deadline' } }, false, { deadline: 3 }],
  ];
  it.each(cases)('%s', (_name, cond, expected, bindings) => {
    expect(evaluate(cond, state, bindings)).toBe(expected);
  });

  it('vote_result : lit le dernier décompte, avec $self et ?', () => {
    const s = scene();
    const fs = s.fs;
    fs.voteSessions['v1'] = {
      id: 'v1',
      epochId: 'e',
      tick: 1,
      sceneId: null,
      kind: 'elimination',
      electorate: [],
      rules: { tie: 'none', maxRounds: 1, allowSelfVote: false, revealVotes: false, immunityItems: true, round: 1 },
      played: [],
      result: {
        status: 'decided',
        counts: { [T]: 3 },
        nullified: [],
        eliminated: T,
        tied: [T],
        needsRevote: false,
        round: 1,
      },
      eventId: null,
    };
    const check = (c: Condition, b?: Bindings) => evaluate(c, s.state, b);
    expect(check({ vote_result: { eliminated: T } })).toBe(true);
    expect(check({ vote_result: { eliminated: '$self' } }, { self: T })).toBe(true);
    expect(check({ vote_result: { eliminated: '$self' } }, { self: A })).toBe(false);
    expect(check({ vote_result: { eliminated: '?' } })).toBe(true);
    expect(check({ vote_result: { kind: 'public' } })).toBe(false);
    expect(check({ vote_result: { tied: false } })).toBe(true);
    expect(check({ vote_result: { session: 'v1', tied: true } })).toBe(false);
  });

  it('une session sans décompte ne satisfait aucun vote_result', () => {
    const s = scene();
    expect(evaluate({ vote_result: {} }, s.state)).toBe(false);
  });

  it('$team désigne les membres de l’équipe du titulaire à l’époque courante', () => {
    const s = scene();
    s.fs.teams['t1'] = {
      id: 't1',
      slug: 'red',
      name: 'R',
      color: null,
      campLocationId: null,
      createdEpoch: 0,
      dissolvedEpoch: null,
    };
    for (const characterId of [S, LEA]) {
      s.fs.memberships.push({ teamId: 't1', characterId, fromEpoch: 0, toEpoch: null, joinedEventId: null });
    }
    const cond: Condition = { holds: { who: '$team', item: 'food_ration', count: { gte: 2 } } };
    expect(evaluate(cond, s.state, { self: LEA })).toBe(true);
    expect(evaluate(cond, s.state, { self: A })).toBe(false);
    expect(evaluate(cond, s.state, { team: 't1' })).toBe(true);
  });

  it('$self sans titulaire est une erreur', () => {
    const s = scene();
    expect(() => evaluate({ holds: { who: '$self', item: 'x' } }, s.state)).toThrow(DomainError);
  });
});

describe('DSL de conditions : combinateurs', () => {
  const { state } = scene();
  const yes: Condition = { epoch_gte: 1 };
  const no: Condition = { epoch_gte: 99 };
  const cases: Case[] = [
    ['not vrai', { not: yes }, false],
    ['not faux', { not: no }, true],
    ['all vide', { all: [] }, true],
    ['all vrai', { all: [yes, yes] }, true],
    ['all avec un faux', { all: [yes, no] }, false],
    ['any vide', { any: [] }, false],
    ['any avec un vrai', { any: [no, yes] }, true],
    ['any tout faux', { any: [no, no] }, false],
    ['count ≥ 2 sur 3', { count: { of: [yes, no, yes], cmp: { gte: 2 } } }, true],
    ['count = 1 sur 3', { count: { of: [yes, no, yes], cmp: { eq: 1 } } }, false],
    ['count ≤ 0 : aucun', { count: { of: [no, no], cmp: { lte: 0 } } }, true],
    [
      'clés multiples = ET implicite (exemple du document)',
      { not: { holds: { who: T, item: 'immunity_necklace' } }, epoch_gte: 4 },
      true,
    ],
    ['ET implicite : une clé fausse', { not: { holds: { who: LEA, item: 'immunity_necklace' } }, epoch_gte: 4 }, false],
    ['imbrication', { all: [{ any: [no, { not: no }] }, { count: { of: [yes], cmp: { gte: 1 } } }] }, true],
  ];
  it.each(cases)('%s', (_name, cond, expected) => {
    expect(evaluate(cond, state)).toBe(expected);
  });
});

describe('DSL de conditions : validation Zod', () => {
  it('accepte l’objectif de l’exemple du document (§3.2) et les déclencheurs du §7', () => {
    const objective = {
      all: [
        {
          knows: {
            who: '$self',
            fact: { predicate: 'holds', object: 'item_def:immunity_necklace' },
            minConfidence: 0.7,
          },
        },
        { before: { epoch: '$deadline' } },
      ],
    };
    expect(parseCondition(objective)).toEqual(objective);
    expect(ConditionSchema.safeParse({ count_active: { lte: 10 } }).success).toBe(true);
    expect(
      ConditionSchema.safeParse({ not: { holds: { who: '?', item: 'immunity_necklace' } }, epoch_gte: 6 }).success,
    ).toBe(true);
  });

  it.each([
    ['condition vide', {}],
    ['clé inconnue', { vole: {} }],
    ['sous-clé inconnue', { holds: { who: 'a', item: 'b', extra: 1 } }],
    ['confiance hors 0..1', { knows: { who: 'a', fact: { predicate: 'p' }, minConfidence: 1.5 } }],
    ['comparateur inconnu', { count_active: { plus: 3 } }],
    ['ticks négatifs', { present_with: { who: 'a', with: 'b', ticks: 0 } }],
    ['sous-condition invalide', { all: [{ holds: { who: 'a' } }] }],
    ['before avec une valeur libre', { before: { epoch: '$autre' } }],
    ['epoch_gte non entier', { epoch_gte: 1.5 }],
  ])('refuse : %s', (_name, input) => {
    expect(ConditionSchema.safeParse(input).success).toBe(false);
    expect(() => parseCondition(input)).toThrow();
  });
});

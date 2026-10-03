/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
import { describe, expect, it } from 'vitest';
import {
  ACTION_CATALOG,
  assertInCatalog,
  availableOptions,
  refusalReason,
  ACTION_IDS,
  OUTCOMES_BY_ACTION,
} from '../../src/rules/index.js';
import { RULE_TABLE, ruleFor } from '../../src/rules/index.js';
import { palmiersState, salonScene, opt } from '../helpers/palmiers.js';

describe('catalogue', () => {
  it('contient toutes les actions de action-catalog.md §2, avec issues, version et coûts', () => {
    expect(Object.keys(ACTION_CATALOG).sort()).toEqual([...ACTION_IDS].sort());
    for (const def of Object.values(ACTION_CATALOG)) {
      expect(def.outcomes.length).toBeGreaterThan(0);
      expect(def.outcomes).toEqual(OUTCOMES_BY_ACTION[def.id]);
      expect(def.version).toBeGreaterThanOrEqual(1);
    }
    expect(ACTION_CATALOG.sabotage.cost).toEqual({ credits: 10 });
    expect(ACTION_CATALOG.confront.cost).toEqual({ energy: 3 });
  });

  it('chaque couple (action, issue) a une règle versionnée, un type d’event et une importance 0..1', () => {
    for (const def of Object.values(ACTION_CATALOG)) {
      for (const outcome of def.outcomes) {
        const rule = ruleFor(def.id, outcome);
        expect(rule.version).toBeGreaterThanOrEqual(1);
        expect(rule.eventType).toMatch(/^[a-z_]+$/);
        expect(rule.importance).toBeGreaterThanOrEqual(0);
        expect(rule.importance).toBeLessThanOrEqual(1);
      }
    }
    expect(Object.keys(RULE_TABLE)).toHaveLength(Object.values(OUTCOMES_BY_ACTION).flat().length);
    expect(() => ruleFor('propose_alliance', 'won')).toThrow(/non autorisée/);
  });

  it('refuse toute action hors catalogue et les actions gardées non activées par la saison', () => {
    const s = palmiersState();
    expect(() => assertInCatalog(s, 'teleport')).toThrow(/hors catalogue/);
    expect(() => assertInCatalog(s, 'steal')).toThrow(/non activée/);
    expect(() => assertInCatalog(s, 'cast_vote')).toThrow(/non activée/);
    expect(() => assertInCatalog(s, 'spy_camp')).toThrow(/non activée/);
    const on = palmiersState({ rules: { enabledActions: ['steal'] } });
    expect(assertInCatalog(on, 'steal').id).toBe('steal');
  });
});

describe('préconditions (table de cas)', () => {
  const scene = salonScene();
  const s = palmiersState();
  s.relationships['alexandre>sarah'] = {
    sourceId: 'alexandre',
    targetId: 'sarah',
    trust: 45,
    affection: 35,
    rivalry: 0,
    respect: 50,
    fear: 0,
    attraction: 0,
    alliance: 0,
    extraAxes: {},
    acquaintance: 'met',
    interactionCount: 1,
    labels: [],
    firstMetEventId: null,
    lastInteractionEventId: null,
  };
  const why = (a: string, target: string | null, over = {}) =>
    refusalReason(s, 'alexandre', opt(a, target, over), scene);

  it('confide exige trust ≥ 40, express_feelings affection ≥ 30', () => {
    expect(why('confide', 'sarah')).toBeNull();
    expect(why('confide', 'thomas')).toBe('preconditions'); // trust par défaut 30
    expect(why('express_feelings', 'sarah')).toBeNull();
    expect(why('express_feelings', 'thomas')).toBe('preconditions');
  });

  it('comfort exige un moral bas de la cible ; break_alliance une alliance ≥ 50 ; propose_alliance pas déjà alliés', () => {
    expect(why('comfort', 'sarah')).toBe('preconditions');
    const low = structuredClone(s);
    low.characters['sarah']!.stats.morale = 20;
    expect(refusalReason(low, 'alexandre', opt('comfort', 'sarah'), scene)).toBeNull();
    expect(why('break_alliance', 'sarah')).toBe('preconditions');
    const allied = structuredClone(s);
    allied.relationships['alexandre>sarah']!.alliance = 60;
    expect(refusalReason(allied, 'alexandre', opt('break_alliance', 'sarah'), scene)).toBeNull();
    expect(refusalReason(allied, 'alexandre', opt('propose_alliance', 'sarah'), scene)).toBe('preconditions');
    expect(why('propose_alliance', 'sarah')).toBeNull();
  });

  it('apologize exige une interaction négative passée ; la cible doit être dans la scène', () => {
    expect(why('apologize', 'sarah')).toBe('preconditions');
    const bad = structuredClone(s);
    bad.relationships['sarah>alexandre'] = {
      ...bad.relationships['alexandre>sarah']!,
      sourceId: 'sarah',
      targetId: 'alexandre',
      rivalry: 30,
    };
    expect(refusalReason(bad, 'alexandre', opt('apologize', 'sarah'), scene)).toBeNull();
    expect(why('compliment', 'inconnu')).toBe('preconditions');
    expect(why('compliment', 'alexandre')).toBe('preconditions');
  });

  it('share_secret exige de connaître le fait ; challenge un créneau ; negotiate_vote un vote à venir', () => {
    const k = structuredClone(s);
    k.knowledge['k1'] = {
      id: 'k1',
      characterId: 'alexandre',
      factId: 'f1',
      sourceType: 'seeded',
      toldById: null,
      viaEventId: null,
      parentKnowledgeId: null,
      learnedEpoch: 0,
      learnedTick: 0,
      confidence: 1,
      belief: 'believes',
    };
    expect(refusalReason(k, 'alexandre', opt('share_secret', 'sarah', { factId: 'f1' }), scene)).toBeNull();
    expect(refusalReason(k, 'alexandre', opt('share_secret', 'sarah', { factId: 'f2' }), scene)).toBe('preconditions');
    expect(why('challenge', 'thomas')).toBe('preconditions');
    expect(
      refusalReason(s, 'alexandre', opt('challenge', 'thomas'), salonScene({ activityAvailable: true })),
    ).toBeNull();
    const vote = palmiersState({ rules: { enabledActions: ['negotiate_vote'] } });
    expect(refusalReason(vote, 'alexandre', opt('negotiate_vote', 'sarah'), scene)).toBe('preconditions');
    expect(
      refusalReason(vote, 'alexandre', opt('negotiate_vote', 'sarah'), salonScene({ voteUpcoming: true })),
    ).toBeNull();
  });

  it('eavesdrop : même lieu, autre zone ; move_to : route existante', () => {
    const zones = {
      members: [
        { characterId: 'alexandre', locationId: 'jardin', zoneId: 'banc' },
        { characterId: 'sarah', locationId: 'jardin', zoneId: 'piscine' },
        { characterId: 'lea', locationId: 'jardin', zoneId: 'banc' },
      ],
    };
    expect(refusalReason(s, 'alexandre', opt('eavesdrop', 'sarah'), zones)).toBeNull();
    expect(refusalReason(s, 'alexandre', opt('eavesdrop', 'lea'), zones)).toBe('preconditions');
    expect(why('move_to', null, { locationId: 'jardin' })).toBeNull();
    expect(why('move_to', null, { locationId: 'chambres' })).toBe('preconditions');
  });
});

describe('availableOptions', () => {
  it('énumère le catalogue de base sans actions gardées, dans un ordre stable', () => {
    const s = palmiersState();
    const options = availableOptions(s, 'alexandre', salonScene());
    expect(options).toEqual(availableOptions(s, 'alexandre', salonScene()));
    const actions = new Set(options.map((o) => o.action));
    expect(actions.has('small_talk')).toBe(true);
    expect(actions.has('rest')).toBe(true);
    expect(actions.has('sabotage')).toBe(true);
    for (const gated of ['steal', 'search', 'cast_vote', 'spy_camp', 'give']) expect(actions.has(gated)).toBe(false);
    expect(options.filter((o) => o.action === 'small_talk').map((o) => o.targetId)).toEqual(['sarah', 'lea', 'thomas']);
  });

  it('en restricted : actions payantes et spéciales refusées, gratuites permises', () => {
    const s = palmiersState({ rules: { enabledActions: [] } });
    s.characters['alexandre']!.status = 'restricted';
    const options = availableOptions(s, 'alexandre', salonScene({ openSlots: ['slot-1'] }));
    const actions = new Set(options.map((o) => o.action));
    expect(actions.has('sabotage')).toBe(false);
    expect(actions.has('join_activity')).toBe(false);
    expect(actions.has('small_talk')).toBe(true);
    expect(refusalReason(s, 'alexandre', opt('sabotage', 'sarah'), salonScene())).toBe('restricted');
    const active = palmiersState();
    expect(
      availableOptions(active, 'alexandre', salonScene({ openSlots: ['slot-1'] })).some(
        (o) => o.action === 'join_activity',
      ),
    ).toBe(true);
  });

  it('aucun statut autre qu’active/restricted n’a d’option ; crédits et énergie insuffisants refusent', () => {
    for (const status of ['elimination_pending', 'eliminated', 'paused'] as const) {
      const s = palmiersState();
      s.characters['alexandre']!.status = status;
      expect(availableOptions(s, 'alexandre', salonScene())).toEqual([]);
    }
    const poor = palmiersState();
    poor.characters['alexandre']!.credits = 5;
    expect(refusalReason(poor, 'alexandre', opt('sabotage', 'sarah'), salonScene())).toBe('credits');
    const tired = palmiersState();
    tired.characters['alexandre']!.stats.energy = 2;
    expect(refusalReason(tired, 'alexandre', opt('confront', 'sarah'), salonScene())).toBe('energy');
    expect(refusalReason(tired, 'alexandre', opt('rest'), salonScene())).toBeNull();
    expect(refusalReason(tired, 'alexandre', opt('teleport'), salonScene())).toBe('not_in_catalog');
  });

  it('économie désactivée : les crédits ne coûtent rien et ne restreignent pas', () => {
    const s = palmiersState({ rules: { economy: { ...palmiersState().season.rules.economy, enabled: false } } });
    s.characters['alexandre']!.credits = 0;
    expect(refusalReason(s, 'alexandre', opt('sabotage', 'sarah'), salonScene())).toBeNull();
    s.characters['alexandre']!.status = 'restricted';
    expect(
      refusalReason(s, 'alexandre', opt('join_activity', 'slot-1'), salonScene({ openSlots: ['slot-1'] })),
    ).toBeNull();
  });
});

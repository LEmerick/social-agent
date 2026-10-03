import { describe, expect, it } from 'vitest';
import { ACTION_CATALOG, resolveInteraction } from '../../src/rules/index.js';
import { relKey } from '../../src/state/types.js';
import { defaultEdge } from '../../src/state/apply-effect.js';
import { idsFor, opt, palmiersState } from '../helpers/palmiers.js';
import { deltas } from '../helpers/summary.js';

interface Case {
  name: string;
  action: string;
  outcome: string;
  target?: string;
  traits?: Record<string, Record<string, number>>;
  /** Axes à poser avant la résolution : `sarah>alexandre` → { trust: 70 }. */
  rel?: Record<string, Record<string, number>>;
  expected: Record<string, number>;
}

const CASES: Case[] = [
  {
    name: 'compliment accepté, acteur charismatique (85)',
    action: 'compliment',
    outcome: 'accepted',
    expected: {
      'rel:sarah>alexandre:affection': 3.4,
      'rel:sarah>alexandre:trust': 1,
      'rel:alexandre>sarah:affection': 0.5,
      'mood:sarah:joy': 1,
      'score:alexandre:social': 1,
    },
  },
  {
    name: 'compliment accepté, acteur peu charismatique (15)',
    action: 'compliment',
    outcome: 'accepted',
    traits: { alexandre: { charisma: 15 } },
    expected: {
      'rel:sarah>alexandre:affection': 0.6,
      'rel:sarah>alexandre:trust': 1,
      'rel:alexandre>sarah:affection': 0.5,
      'mood:sarah:joy': 1,
      'score:alexandre:social': 1,
    },
  },
  {
    name: 'confide accepté, cible empathique (65)',
    action: 'confide',
    outcome: 'accepted',
    expected: {
      'rel:sarah>alexandre:trust': 4.9,
      'rel:sarah>alexandre:affection': 3,
      'rel:alexandre>sarah:trust': 3,
      'rel:alexandre>sarah:affection': 2,
      'score:alexandre:social': 2,
      'score:sarah:social': 2,
    },
  },
  {
    name: 'confide accepté, cible peu empathique (20)',
    action: 'confide',
    outcome: 'accepted',
    traits: { sarah: { empathy: 20 } },
    expected: {
      'rel:sarah>alexandre:trust': 2.2,
      'rel:sarah>alexandre:affection': 3,
      'rel:alexandre>sarah:trust': 3,
      'rel:alexandre>sarah:affection': 2,
      'score:alexandre:social': 2,
      'score:sarah:social': 2,
    },
  },
  {
    name: 'propose_alliance conditionnelle (exemple §9), relation par défaut',
    action: 'propose_alliance',
    outcome: 'accepted_conditional',
    expected: {
      'rel:sarah>alexandre:trust': 7.6,
      'rel:alexandre>sarah:trust': 4,
      'rel:alexandre>sarah:alliance': 15,
      'rel:sarah>alexandre:alliance': 12.5,
      'stat:alexandre:influence': 3,
      'mood:alexandre:hope': 0.3,
      'score:alexandre:social': 5,
      'score:sarah:social': 3,
    },
  },
  {
    name: 'propose_alliance conditionnelle, Sarah se méfie peu : trust(S→A)=70 et loyauté 20',
    action: 'propose_alliance',
    outcome: 'accepted_conditional',
    traits: { sarah: { loyalty: 20 } },
    rel: { 'sarah>alexandre': { trust: 70 } },
    expected: {
      'rel:sarah>alexandre:trust': 9.6,
      'rel:alexandre>sarah:trust': 4,
      'rel:alexandre>sarah:alliance': 15,
      'rel:sarah>alexandre:alliance': 7,
      'stat:alexandre:influence': 3,
      'mood:alexandre:hope': 0.3,
      'score:alexandre:social': 5,
      'score:sarah:social': 3,
    },
  },
  {
    name: 'propose_alliance refusée',
    action: 'propose_alliance',
    outcome: 'refused',
    expected: { 'rel:sarah>alexandre:trust': -1, 'rel:alexandre>sarah:affection': -2, 'stat:alexandre:morale': -2 },
  },
  {
    name: 'lie démasqué, menteur habile (manipulation 80)',
    action: 'lie',
    outcome: 'detected',
    expected: {
      'rel:sarah>alexandre:trust': -13.5,
      'rel:sarah>alexandre:respect': -8,
      'rel:sarah>alexandre:rivalry': 5,
      'stat:alexandre:reputation': -3,
      'score:alexandre:drama': 3,
    },
  },
  {
    name: 'lie démasqué, menteur maladroit (manipulation 20)',
    action: 'lie',
    outcome: 'detected',
    traits: { alexandre: { manipulation: 20 } },
    expected: {
      'rel:sarah>alexandre:trust': -16.5,
      'rel:sarah>alexandre:respect': -8,
      'rel:sarah>alexandre:rivalry': 5,
      'stat:alexandre:reputation': -3,
      'score:alexandre:drama': 3,
    },
  },
  {
    name: 'provoke dégénère contre un compétitif (Thomas 85)',
    action: 'provoke',
    outcome: 'escalated',
    target: 'thomas',
    expected: {
      'rel:thomas>alexandre:rivalry': 8.8,
      'rel:thomas>alexandre:affection': -4,
      'rel:alexandre>thomas:rivalry': 3,
      'rel:thomas>alexandre:respect': -2,
      'stat:thomas:morale': -2,
      'score:alexandre:drama': 3,
      'score:thomas:drama': 2,
    },
  },
  {
    name: 'provoke dégénère contre une cible placide (Léa 35)',
    action: 'provoke',
    outcome: 'escalated',
    target: 'lea',
    expected: {
      'rel:lea>alexandre:rivalry': 4.8,
      'rel:lea>alexandre:affection': -4,
      'rel:alexandre>lea:rivalry': 3,
      'rel:lea>alexandre:respect': -2,
      'stat:lea:morale': -2,
      'score:alexandre:drama': 3,
      'score:lea:drama': 2,
    },
  },
  {
    name: 'insult = provoke × 1.4',
    action: 'insult',
    outcome: 'escalated',
    target: 'lea',
    expected: {
      'rel:lea>alexandre:rivalry': 6.72,
      'rel:lea>alexandre:affection': -5.6,
      'rel:alexandre>lea:rivalry': 4.2,
      'rel:lea>alexandre:respect': -2.8,
      'stat:lea:morale': -2.8,
      'score:alexandre:drama': 4.2,
      'score:lea:drama': 2.8,
    },
  },
  {
    name: 'threaten accepté, acteur charismatique (85)',
    action: 'threaten',
    outcome: 'accepted',
    expected: {
      'rel:sarah>alexandre:fear': 10.1,
      'rel:sarah>alexandre:trust': -6,
      'rel:sarah>alexandre:affection': -4,
      'rel:alexandre>sarah:respect': -1,
      'score:alexandre:influence': 2,
    },
  },
  {
    name: 'apologize accepté, cible empathique (Sarah 65)',
    action: 'apologize',
    outcome: 'accepted',
    expected: {
      'rel:sarah>alexandre:trust': 4.75,
      'rel:sarah>alexandre:rivalry': -5,
      'rel:sarah>alexandre:affection': 2,
      'stat:alexandre:morale': 2,
    },
  },
  {
    name: 'break_alliance escalade',
    action: 'break_alliance',
    outcome: 'escalated',
    expected: {
      'rel:alexandre>sarah:alliance': -60,
      'rel:sarah>alexandre:alliance': -60,
      'rel:sarah>alexandre:trust': -15,
      'rel:sarah>alexandre:rivalry': 12,
      'rel:alexandre>sarah:rivalry': 6,
      'stat:alexandre:reputation': -2,
      'score:alexandre:drama': 4,
      'score:sarah:drama': 4,
    },
  },
  {
    name: 'challenge gagné',
    action: 'challenge',
    outcome: 'won',
    target: 'thomas',
    expected: {
      'stat:alexandre:popularity': 2,
      'stat:alexandre:morale': 3,
      'stat:thomas:morale': -3,
      'rel:thomas>alexandre:respect': 3,
      'rel:thomas>alexandre:rivalry': 3,
      'score:alexandre:popularity': 3,
      'score:alexandre:drama': 1,
    },
  },
  {
    name: 'challenge perdu : les bénéfices vont à la cible',
    action: 'challenge',
    outcome: 'lost',
    target: 'thomas',
    expected: {
      'stat:thomas:popularity': 2,
      'stat:thomas:morale': 3,
      'stat:alexandre:morale': -3,
      'rel:alexandre>thomas:respect': 3,
      'rel:alexandre>thomas:rivalry': 3,
      'score:thomas:popularity': 3,
      'score:thomas:drama': 1,
    },
  },
  {
    name: 'sabotage détecté',
    action: 'sabotage',
    outcome: 'detected',
    expected: {
      'rel:sarah>alexandre:trust': -20,
      'rel:sarah>alexandre:rivalry': 15,
      'rel:sarah>alexandre:respect': -8,
      'stat:alexandre:reputation': -5,
      'score:alexandre:drama': 4,
      'score:sarah:drama': 2,
    },
  },
];

const round = (v: number): number => Math.round(v * 1e6) / 1e6;

function run(c: Case) {
  const state = palmiersState({ traits: c.traits ?? {}, rules: { enabledActions: ['steal'] } });
  for (const [key, axes] of Object.entries(c.rel ?? {})) {
    const [s, t] = key.split('>') as [string, string];
    state.relationships[relKey(s, t)] = { ...defaultEdge(s, t), ...axes };
  }
  const res = resolveInteraction(
    state,
    { option: opt(c.action, c.target ?? 'sarah'), actorId: 'alexandre', outcome: c.outcome },
    idsFor(state),
  );
  return { state, res };
}

describe('règles de résolution : traits × relation ⇒ deltas', () => {
  it.each(CASES)('$name', (c) => {
    const { res } = run(c);
    const got = Object.fromEntries(Object.entries(deltas(res.effects)).map(([k, v]) => [k, round(v)]));
    expect(got).toEqual(c.expected);
  });
});

describe('chaque règle du catalogue', () => {
  const pairs = Object.values(ACTION_CATALOG).flatMap((def) => def.outcomes.map((o) => [def.id, o] as const));

  it.each(pairs)('%s / %s : effets cohérents, versionnés et bornés', (action, outcome) => {
    const state = palmiersState({ rules: { enabledActions: Object.keys(ACTION_CATALOG), relationshipAxes: [] } });
    const def = ACTION_CATALOG[action];
    const res = resolveInteraction(
      state,
      {
        option: opt(action, def.target === 'character' || def.target === 'characters' ? 'sarah' : null),
        actorId: 'alexandre',
        outcome,
      },
      idsFor(state),
    );
    expect(res.event.payload).toMatchObject({ action, outcome, ruleId: `${action}:${outcome}`, ruleVersion: 1 });
    for (const fx of res.effects) {
      expect(Number.isFinite(fx.delta)).toBe(true);
      expect(fx.delta).not.toBe(0);
      expect(['alexandre', 'sarah']).toContain(fx.characterId);
      expect(fx.eventId).toBe(res.event.id);
      expect(fx.ruleVersion).toBe(1);
      expect(fx.valueAfter).not.toBeNull();
      if (fx.ruleId !== 'cost') expect(fx.ruleId).toBe(`${action}:${outcome}`);
    }
    for (const e of Object.values(state.relationships)) {
      for (const axis of ['trust', 'rivalry', 'respect', 'fear', 'attraction', 'alliance'] as const) {
        expect(e[axis]).toBeGreaterThanOrEqual(0);
        expect(e[axis]).toBeLessThanOrEqual(100);
      }
      expect(Math.abs(e.affection)).toBeLessThanOrEqual(100);
    }
  });
});

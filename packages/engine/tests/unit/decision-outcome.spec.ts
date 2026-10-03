import { describe, expect, it } from 'vitest';
import { ACTION_CATALOG, Rng } from '@ai-reality/engine';
import { PROBABILISTIC_OUTCOME_POLICY, ProbabilisticOutcomeModel } from '../../src/decision/model/index.js';
import { A, S, chiSquare, opt, palmiersAtSalon, setEdge } from '../helpers/decision-kit.js';

const model = new ProbabilisticOutcomeModel();

/** Un état où Sarah a une arête vers Alexandre, dont on fait varier un axe. */
const withAxis = (axis: string, value: number) => {
  const state = palmiersAtSalon();
  setEdge(state, S, A, { [axis]: value });
  return state;
};

describe('ProbabilisticOutcomeModel', () => {
  it('somme à 1 sur les seules issues autorisées de chaque action du catalogue', () => {
    const state = palmiersAtSalon();
    const gated = { ...state.season.rules, enabledActions: Object.keys(ACTION_CATALOG) };
    (state.season as { rules: unknown }).rules = gated;
    for (const def of Object.values(ACTION_CATALOG)) {
      const d = model.distribution(state, A, opt(def.id, def.target === 'character' ? S : null));
      expect(Object.keys(d)).toEqual([...def.outcomes]);
      expect(Object.values(d).reduce((s, p) => s + p, 0)).toBeCloseTo(1, 9);
    }
  });

  it('plus de confiance de la cible ⇒ plus d’acceptation (propose_alliance, small_talk, share_secret)', () => {
    for (const [action, best] of [
      ['propose_alliance', 'accepted'],
      ['small_talk', 'accepted'],
      ['share_secret', 'believed'],
    ] as const) {
      let previous = -1;
      for (const trust of [0, 20, 40, 60, 80, 100]) {
        const p = model.distribution(withAxis('trust', trust), A, opt(action, S))[best] ?? 0;
        expect(p).toBeGreaterThan(previous);
        previous = p;
      }
    }
  });

  it('monotone dans chaque axe de l’arête cible → acteur, au sens des issues cumulées', () => {
    const axes: readonly (readonly [string, 1 | -1])[] = [
      ['trust', 1],
      ['affection', 1],
      ['alliance', 1],
      ['rivalry', -1],
    ];
    for (const [axis, sign] of axes) {
      const low = axis === 'affection' ? -80 : 0;
      const at = (v: number) => model.distribution(withAxis(axis, v), A, opt('propose_alliance', S));
      const lo = at(low);
      const hi = at(80);
      const favourable = (d: Record<string, number>) => (d['accepted'] ?? 0) + (d['accepted_conditional'] ?? 0);
      if (sign === 1) expect(favourable(hi)).toBeGreaterThan(favourable(lo));
      else expect(favourable(hi)).toBeLessThan(favourable(lo));
    }
  });

  it('la peur de la cible rend la menace plus efficace', () => {
    const at = (fear: number) => model.distribution(withAxis('fear', fear), A, opt('threaten', S))['accepted'] ?? 0;
    expect(at(80)).toBeGreaterThan(at(0));
  });

  it('un acteur manipulateur réussit mieux ses actions furtives qu’un acteur franc', () => {
    const state = palmiersAtSalon();
    const sneaky = model.distribution(state, A, opt('eavesdrop', S))['undetected'] ?? 0; // Alexandre : manipulation 80
    const honest = model.distribution(state, S, opt('eavesdrop', A))['undetected'] ?? 0; // Sarah : manipulation 25
    expect(sneaky).toBeGreaterThan(honest);
  });

  it('resolve : policy probabilistic@1, distribution et rngDraw ; rien à tirer pour une issue unique', async () => {
    const state = palmiersAtSalon();
    const r = await model.resolve({ option: opt('propose_alliance', S), actorId: A, state, rng: new Rng(1) });
    expect(r.policy).toBe(PROBABILISTIC_OUTCOME_POLICY);
    expect(r.policy).toBe('probabilistic@1');
    expect(r.rngDraw).not.toBeNull();
    expect(Object.keys(r.distribution ?? {})).toContain(r.outcome);
    const rest = await model.resolve({ option: opt('rest'), actorId: A, state, rng: new Rng(1) });
    expect(rest).toMatchObject({ outcome: 'accepted', rngDraw: null });
  });

  it('10⁴ tirages : les fréquences observées collent à la distribution annoncée (χ², p > 0,01)', async () => {
    const state = palmiersAtSalon();
    setEdge(state, S, A, { trust: 55, alliance: 10 });
    const option = opt('propose_alliance', S);
    const dist = model.distribution(state, A, option);
    const keys = Object.keys(dist);
    const rng = new Rng(77);
    const counts = new Map<string, number>();
    for (let i = 0; i < 10_000; i++) {
      const { outcome } = await model.resolve({ option, actorId: A, state, rng });
      counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    }
    const { p } = chiSquare(
      keys.map((k) => counts.get(k) ?? 0),
      keys.map((k) => (dist[k] ?? 0) * 10_000),
    );
    expect(p).toBeGreaterThan(0.01);
  });
});

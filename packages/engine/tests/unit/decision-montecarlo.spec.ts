import { describe, expect, it } from 'vitest';
import { Rng } from '@ai-reality/engine';
import { MonteCarloDecisionPolicy, estimateOptions, optionsForPlayer } from '../../src/decision/model/index.js';
import { A, L, S, T, opt, optionsOf, palmiersAtSalon } from '../helpers/decision-kit.js';

/** Exemple chiffré de action-catalog.md §9.2 : P(Sarah accepte) = 0,62 ; Sarah → Léa 0,55 ; Léa → Thomas 0,30. */
const example = {
  outcome: ({ option }: { option: { action: string } }) =>
    option.action === 'propose_alliance' ? { accepted: 0.62, refused: 0.38 } : undefined,
  tell: (from: string, to: string) => (from === S && to === L ? 0.55 : from === L && to === T ? 0.3 : 0),
};

describe('Monte Carlo : exemple chiffré de action-catalog §9', () => {
  const propose = opt('propose_alliance', S);

  it('P(Thomas l’apprend) converge vers 0,62 × 0,55 × 0,30 ± 2 %, P(succès) vers 0,62', () => {
    const state = palmiersAtSalon();
    const [est] = estimateOptions(state, A, [propose], new Rng(1), {
      rollouts: 5000,
      horizon: 4,
      overrides: example,
    });
    expect(est?.pLearn[T]).toBeCloseTo(0.62 * 0.55 * 0.3, 1);
    expect(Math.abs((est?.pLearn[T] ?? 0) - 0.62 * 0.55 * 0.3)).toBeLessThan(0.02);
    expect(Math.abs((est?.pLearn[L] ?? 0) - 0.62 * 0.55)).toBeLessThan(0.025);
    expect(Math.abs((est?.pSuccess ?? 0) - 0.62)).toBeLessThan(0.02);
  });

  it('un horizon de 2 ne voit pas Thomas : un impulsif n’anticipe pas la chaîne', () => {
    const [est] = estimateOptions(palmiersAtSalon(), A, [propose], new Rng(2), {
      rollouts: 2000,
      horizon: 2,
      overrides: example,
    });
    expect(est?.pLearn[T] ?? 0).toBe(0);
    expect(est?.pLearn[L]).toBeGreaterThan(0.25);
  });

  it('même graine ⇒ même distribution ; autre graine ⇒ autre estimation', () => {
    const state = palmiersAtSalon();
    const run = (seed: number) =>
      estimateOptions(state, A, optionsOf(state, A).slice(0, 5), new Rng(seed), { rollouts: 60 });
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it('ne modifie jamais l’état d’origine', () => {
    const state = palmiersAtSalon();
    const before = structuredClone(state);
    estimateOptions(state, A, optionsOf(state, A), new Rng(3), { rollouts: 20 });
    expect(state).toEqual(before);
  });

  it('une proposition acceptée a une valeur moyenne positive, une confrontation hostile une valeur plus basse', () => {
    const state = palmiersAtSalon();
    const [prop, conf] = estimateOptions(state, A, [propose, opt('confront', T)], new Rng(4), {
      rollouts: 400,
      horizon: 4,
      overrides: { outcome: example.outcome },
    });
    expect(prop?.meanValue).toBeGreaterThan(0);
    expect(prop?.meanValue).toBeGreaterThan(conf?.meanValue ?? 0);
    expect(prop?.risk).toBeGreaterThan(0);
  });
});

describe('Monte Carlo : horizon et rollouts selon les traits', () => {
  it('le manipulateur ambitieux voit plus loin et simule plus que l’impulsif', async () => {
    const state = palmiersAtSalon();
    const probe = (actorId: string) => estimateOptions(state, actorId, [opt('small_talk', S)], new Rng(1), {})[0];
    expect(probe(A)?.horizon).toBeGreaterThan(probe(T)?.horizon ?? 99);
    expect(probe(A)?.rollouts).toBeGreaterThan(probe(T)?.rollouts ?? 0);
  });
});

describe('MonteCarloDecisionPolicy et options du joueur', () => {
  it('choisit parmi les options, trace distribution et rngDraw, policy montecarlo@1', async () => {
    const state = palmiersAtSalon();
    const options = optionsOf(state, A);
    const result = await new MonteCarloDecisionPolicy({ rollouts: 40 }).choose({
      actorId: A,
      state,
      options,
      rng: new Rng(5),
    });
    expect(result.policy).toBe('montecarlo@1');
    expect(result.chosen).not.toBeNull();
    expect(options.some((o) => JSON.stringify(o) === JSON.stringify(result.chosen))).toBe(true);
    expect(result.rngDraw).not.toBeNull();
    const total = result.distribution?.reduce((s, d) => s + d.p, 0) ?? 0;
    expect(total).toBeCloseTo(1, 9);
  });

  it('optionsForPlayer : tableau chiffré trié par valeur moyenne, déterministe', () => {
    const state = palmiersAtSalon();
    const options = optionsOf(state, A);
    const table = optionsForPlayer(state, A, options, new Rng(9), { rollouts: 80, horizon: 4, overrides: example });
    expect(table.length).toBeLessThanOrEqual(12);
    for (let i = 1; i < table.length; i++) {
      expect(table[i - 1]?.meanValue ?? 0).toBeGreaterThanOrEqual(table[i]?.meanValue ?? 0);
    }
    for (const row of table) {
      expect(row.pSuccess).toBeGreaterThanOrEqual(0);
      expect(row.pSuccess).toBeLessThanOrEqual(1);
    }
    expect(optionsForPlayer(state, A, options, new Rng(9), { rollouts: 80, horizon: 4, overrides: example })).toEqual(
      table,
    );
  });
});

describe('Monte Carlo : performance', () => {
  it('500 rollouts d’horizon 4 en moins de 50 ms', () => {
    const state = palmiersAtSalon();
    const option = opt('propose_alliance', S);
    const run = () => {
      const t0 = performance.now();
      estimateOptions(state, A, [option], new Rng(1), { rollouts: 500, horizon: 4 });
      return performance.now() - t0;
    };
    run(); // échauffement du JIT
    const best = Math.min(run(), run(), run(), run(), run());
    console.log(`bench : 500 rollouts d'horizon 4 = ${best.toFixed(1)} ms`);
    expect(best).toBeLessThan(50);
  });
});

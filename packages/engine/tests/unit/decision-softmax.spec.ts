import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Rng } from '@ai-reality/engine';
import { sampleIndex, softmax, temperatureOf } from '../../src/decision/model/index.js';
import { chiSquare } from '../helpers/decision-kit.js';

describe('softmax', () => {
  it('somme à 1 et reste dans [0, 1], quelle que soit la température', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -20, max: 20, noNaN: true }), { minLength: 1, maxLength: 12 }),
        fc.double({ min: 0, max: 5, noNaN: true }),
        (values, t) => {
          const p = softmax(values, t);
          expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
          for (const x of p) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });

  it('température → 0 : tout le poids sur le maximum', () => {
    const values = [0.2, 1.5, -0.3, 1.4];
    expect(softmax(values, 0)).toEqual([0, 1, 0, 0]);
    const nearZero = softmax(values, 1e-4);
    expect(nearZero[1]).toBeCloseTo(1, 9);
    // Le tirage est alors déterministe quel que soit le rng.
    const rng = new Rng(3);
    for (let i = 0; i < 50; i++) expect(sampleIndex(softmax(values, 0), rng.next())).toBe(1);
  });

  it('température élevée : tend vers l’uniforme ; l’ordre des valeurs est conservé', () => {
    const p = softmax([0, 1, 2], 1000);
    expect(p[0]).toBeCloseTo(1 / 3, 2);
    expect(p[0] ?? 1).toBeLessThan(p[1] ?? 0);
    expect(p[1] ?? 1).toBeLessThan(p[2] ?? 0);
  });

  it('une valeur −∞ (option interdite) n’est jamais tirée ; tout interdit ⇒ uniforme', () => {
    expect(softmax([1, -Infinity, 1], 0.5)[1]).toBe(0);
    expect(softmax([-Infinity, -Infinity], 0.5)).toEqual([0.5, 0.5]);
  });

  it('température liée à l’impulsivité : croissante, bornée', () => {
    expect(temperatureOf(0)).toBeCloseTo(0.15);
    expect(temperatureOf(1)).toBeCloseTo(1);
    expect(temperatureOf(0.3)).toBeLessThan(temperatureOf(0.7));
    expect(temperatureOf(0.5, { fixed: 0 })).toBe(0);
  });
});

describe('statistiques du tirage', () => {
  it('10⁴ tirages : les fréquences collent aux probabilités annoncées (χ², p > 0,01)', () => {
    const probs = softmax([1.2, 0.4, 0.9, -0.5, 0], 0.6);
    const rng = new Rng(2026);
    const counts = probs.map(() => 0);
    for (let i = 0; i < 10_000; i++) {
      const at = sampleIndex(probs, rng.next());
      counts[at] = (counts[at] ?? 0) + 1;
    }
    const { p } = chiSquare(
      counts,
      probs.map((x) => x * 10_000),
    );
    expect(p).toBeGreaterThan(0.01);
  });
});

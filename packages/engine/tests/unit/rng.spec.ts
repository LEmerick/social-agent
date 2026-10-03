import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';

const drawSequence = (rng: Rng, n: number): number[] => Array.from({ length: n }, () => rng.next());

describe('Rng', () => {
  it('même graine ⇒ même suite', () => {
    expect(drawSequence(new Rng(42), 1000)).toEqual(drawSequence(new Rng(42), 1000));
  });

  it('graines différentes ⇒ suites différentes', () => {
    expect(drawSequence(new Rng(1), 50)).not.toEqual(drawSequence(new Rng(2), 50));
  });

  it("Rng.derive est stable et dépend de chaque partie, dans l'ordre", () => {
    const a = drawSequence(Rng.derive('palmiers-test', 3, 17, 'alexandre'), 20);
    const b = drawSequence(Rng.derive('palmiers-test', 3, 17, 'alexandre'), 20);
    expect(a).toEqual(b);
    expect(drawSequence(Rng.derive('palmiers-test', 3, 18, 'alexandre'), 20)).not.toEqual(a);
    expect(drawSequence(Rng.derive('palmiers-test', 3, 17, 'sarah'), 20)).not.toEqual(a);
    expect(drawSequence(Rng.derive('palmiers-test', 'alexandre', 3, 17), 20)).not.toEqual(a);
  });

  it('les flottants sont dans [0, 1)', () => {
    const rng = new Rng(7);
    for (const x of drawSequence(rng, 10_000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('distribution uniforme : test du χ² sur 10⁵ tirages dans 10 classes', () => {
    const buckets = 10;
    const draws = 100_000;
    const rng = Rng.derive('palmiers-test', 'uniformite');
    const counts = new Array<number>(buckets).fill(0);
    for (let i = 0; i < draws; i++) {
      const bucket = rng.int(buckets);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    const expected = draws / buckets;
    const chi2 = counts.reduce((acc, observed) => acc + (observed - expected) ** 2 / expected, 0);
    // df = 9 ; valeur critique à p = 0.001 : 27.88
    expect(chi2).toBeLessThan(27.88);
  });

  it('int() respecte la borne exclusive', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(7);
      expect(Number.isInteger(v) && v >= 0 && v < 7).toBe(true);
    }
  });

  it('rejette les bornes invalides', () => {
    const rng = new Rng(1);
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.int(1.5)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});

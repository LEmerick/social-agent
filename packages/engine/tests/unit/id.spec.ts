import { describe, expect, it } from 'vitest';
import { ManualClock } from '../../src/core/clock.js';
import { createIdFactory, uuidV7 } from '../../src/core/id.js';
import { Rng } from '../../src/core/rng.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidV7', () => {
  it('produit un UUID v7 valide', () => {
    expect(uuidV7(1_700_000_000_000, new Rng(1))).toMatch(UUID_V7);
  });

  it("encode l'horodatage dans les 48 premiers bits", () => {
    const id = uuidV7(0x0123_4567_89ab, new Rng(1));
    expect(id.slice(0, 8) + id.slice(9, 13)).toBe('0123456789ab');
  });

  it('les identifiants créés plus tard trient après ceux créés plus tôt', () => {
    const rng = new Rng(5);
    const earlier = uuidV7(1_000_000, rng);
    const later = uuidV7(1_000_001, rng);
    expect(earlier < later).toBe(true);
  });

  it('même graine et même horloge ⇒ mêmes identifiants (rejeu)', () => {
    const make = () => {
      const clock = new ManualClock(1_000);
      const factory = createIdFactory(clock, new Rng(3));
      return [factory.next(), factory.next(), factory.next()];
    };
    expect(make()).toEqual(make());
  });

  it('rejette un horodatage hors plage', () => {
    expect(() => uuidV7(-1, new Rng(1))).toThrow(RangeError);
    expect(() => uuidV7(2 ** 48, new Rng(1))).toThrow(RangeError);
  });
});

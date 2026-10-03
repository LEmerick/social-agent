/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ACTION_CATALOG, HeuristicOutcomeModel, ScriptedOutcomeModel, orderedLogit } from '../../src/rules/index.js';
import { Rng } from '../../src/core/rng.js';
import { optionKey } from '../../src/decision/ports.js';
import { defaultEdge } from '../../src/state/apply-effect.js';
import { relKey } from '../../src/state/types.js';
import { P, opt, palmiersFixture } from '../helpers/palmiers.js';

describe('ScriptedOutcomeModel', () => {
  const state = palmiersFixture();
  const input = (action: string, target = P.sarah) => ({ option: opt(action, target), actorId: P.alexandre, state });

  it('tableau : issues consommées dans l’ordre, puis première issue autorisée', async () => {
    const m = new ScriptedOutcomeModel(['refused', 'backfired']);
    expect((await m.resolve(input('propose_alliance'))).outcome).toBe('refused');
    expect(await m.resolve(input('propose_alliance'))).toEqual({
      outcome: 'backfired',
      rngDraw: null,
      policy: 'scripted@1',
    });
    expect((await m.resolve(input('propose_alliance'))).outcome).toBe('accepted');
  });

  it('objet : par optionKey puis par action ; fonction : calculée', async () => {
    const o = opt('propose_alliance', P.sarah);
    const m = new ScriptedOutcomeModel({ [optionKey(o)]: 'accepted_conditional', compliment: 'refused' });
    expect((await m.resolve(input('propose_alliance'))).outcome).toBe('accepted_conditional');
    expect((await m.resolve(input('compliment'))).outcome).toBe('refused');
    expect((await m.resolve(input('compliment', P.lea))).outcome).toBe('refused');
    const f = new ScriptedOutcomeModel(({ option }) => (option.action === 'lie' ? 'detected' : undefined));
    expect((await f.resolve(input('lie'))).outcome).toBe('detected');
    expect((await f.resolve(input('lie', P.lea))).outcome).toBe('detected');
  });

  it('rejette une issue hors vocabulaire de l’action et une action hors catalogue', async () => {
    await expect(new ScriptedOutcomeModel(['won']).resolve(input('compliment'))).rejects.toThrow(/non autorisée/);
    await expect(new ScriptedOutcomeModel().resolve(input('teleport'))).rejects.toThrow(/hors catalogue/);
  });
});

describe('orderedLogit', () => {
  it('somme à 1, positive, et déplace la masse vers la meilleure issue quand s augmente', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.double({ min: -8, max: 8, noNaN: true }),
        fc.double({ min: 0, max: 4, noNaN: true }),
        (n, s, ds) => {
          const lo = orderedLogit(s, n);
          const hi = orderedLogit(s + ds, n);
          expect(lo.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
          expect(lo.every((p) => p >= -1e-12)).toBe(true);
          // P(au moins aussi favorable que k) croît avec s
          let cLo = 0;
          let cHi = 0;
          for (let k = 0; k < n; k++) {
            cLo += lo[k]!;
            cHi += hi[k]!;
            expect(cHi).toBeGreaterThanOrEqual(cLo - 1e-12);
          }
        },
      ),
    );
  });
});

describe('HeuristicOutcomeModel', () => {
  const model = new HeuristicOutcomeModel();

  it('distribution : somme 1 et uniquement des issues autorisées, pour chaque action du catalogue', () => {
    const state = palmiersFixture({ rules: { enabledActions: Object.keys(ACTION_CATALOG) } });
    for (const def of Object.values(ACTION_CATALOG)) {
      const d = model.distribution(state, P.alexandre, opt(def.id, P.sarah));
      expect(Object.keys(d)).toEqual([...def.outcomes]);
      expect(Object.values(d).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
  });

  it('monotone : plus de confiance (cible→acteur) ⇒ plus d’acceptation, pour toutes les actions coopératives', () => {
    const cooperative = [
      'small_talk',
      'compliment',
      'confide',
      'comfort',
      'flirt',
      'propose_alliance',
      'request_favor',
      'apologize',
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...cooperative),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (action, t1, t2) => {
          const [lo, hi] = t1 <= t2 ? [t1, t2] : [t2, t1];
          const at = (trust: number) => {
            const s = palmiersFixture();
            s.relationships[relKey(P.sarah, P.alexandre)] = { ...defaultEdge(P.sarah, P.alexandre), trust };
            return model.distribution(s, P.alexandre, opt(action, P.sarah))['accepted']!;
          };
          expect(at(hi)).toBeGreaterThanOrEqual(at(lo) - 1e-12);
        },
      ),
    );
  });

  it('les traits comptent : un menteur habile est plus souvent cru', () => {
    const at = (manipulation: number) =>
      model.distribution(
        palmiersFixture({ traits: { [P.alexandre]: { manipulation } } }),
        P.alexandre,
        opt('lie', P.sarah),
      )['believed']!;
    expect(at(90)).toBeGreaterThan(at(10));
  });

  it('tirage déterministe via le Rng fourni ; rngDraw ∈ [0,1) cohérent avec l’issue', async () => {
    const state = palmiersFixture();
    const option = opt('propose_alliance', P.sarah);
    const a = await model.resolve({ option, actorId: P.alexandre, state, rng: new Rng(7) });
    const b = await model.resolve({ option, actorId: P.alexandre, state, rng: new Rng(7) });
    expect(a).toEqual(b);
    expect(a.policy).toBe('heuristic@1');
    expect(a.rngDraw).toBeGreaterThanOrEqual(0);
    expect(a.rngDraw).toBeLessThan(1);
    const order = Object.keys(a.distribution!);
    let cumulative = 0;
    for (const o of order) {
      const lower = cumulative;
      cumulative += a.distribution![o]!;
      if (o === a.outcome) {
        expect(a.rngDraw!).toBeGreaterThanOrEqual(lower - 1e-12);
        expect(a.rngDraw!).toBeLessThan(cumulative + 1e-12);
      }
    }
  });

  it('les fréquences observées suivent la distribution', async () => {
    const state = palmiersFixture();
    const option = opt('propose_alliance', P.sarah);
    const rng = new Rng(2026);
    const counts: Record<string, number> = {};
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const r = await model.resolve({ option, actorId: P.alexandre, state, rng });
      counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    }
    const d = model.distribution(state, P.alexandre, option);
    for (const [o, p] of Object.entries(d)) expect((counts[o] ?? 0) / n).toBeCloseTo(p, 1);
  });

  it('une action à issue unique ne consomme pas le Rng', async () => {
    const state = palmiersFixture();
    const rng = new Rng(3);
    const r = await model.resolve({ option: opt('rest'), actorId: P.alexandre, state, rng });
    expect(r).toMatchObject({ outcome: 'accepted', rngDraw: null, distribution: { accepted: 1 } });
    expect(rng.next()).toBe(new Rng(3).next());
  });
});

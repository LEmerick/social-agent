import { describe, expect, it } from 'vitest';
import { Rng, type SimState, optionKey } from '@ai-reality/engine';
import { IDS } from '@ai-reality/testkit';
import {
  UTILITY_POLICY,
  UtilityDecisionPolicy,
  chooseDestinationByScore,
  destinationScores,
  utilitiesOf,
  utilityBreakdown,
  utilityDistribution,
  utilityOf,
} from '../../src/decision/model/index.js';
import { A, L, S, T, character, must, opt, optionsOf, palmiersAtSalon, setEdge } from '../helpers/decision-kit.js';

const frequencies = async (
  policy: UtilityDecisionPolicy,
  state: SimState,
  actorId: string,
  draws: number,
  seed: number,
): Promise<Map<string, number>> => {
  const options = optionsOf(state, actorId);
  const rng = new Rng(seed);
  const counts = new Map<string, number>();
  for (let i = 0; i < draws; i++) {
    const r = await policy.choose({ actorId, state, options, rng });
    const key = r.chosen?.action ?? 'none';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

/** Alexandre et Sarah alliés (alliance 70 dans les deux sens), le trait de loyauté d'Alexandre fixé. */
const allied = (loyalty: number): SimState =>
  palmiersAtSalon((s) => {
    for (const [from, to] of [
      [A, S],
      [S, A],
    ] as const) {
      setEdge(s, from, to, { alliance: 70, trust: 70, affection: 30, acquaintance: 'close' });
    }
    (s.characters[A] as { traits: Record<string, number> }).traits['loyalty'] = loyalty;
  });

describe('UtilityDecisionPolicy', () => {
  it('trace utility@1, une distribution qui somme à 1 et le tirage ; même graine ⇒ même choix', async () => {
    const state = palmiersAtSalon();
    const options = optionsOf(state, A);
    const policy = new UtilityDecisionPolicy();
    const run = (seed: number) => policy.choose({ actorId: A, state, options, rng: new Rng(seed) });
    const r = await run(11);
    expect(r.policy).toBe(UTILITY_POLICY);
    expect(r.policy).toBe('utility@1');
    expect(r.rngDraw).toBeGreaterThanOrEqual(0);
    expect(r.rngDraw).toBeLessThan(1);
    expect(r.distribution).toHaveLength(options.length);
    expect(r.distribution?.reduce((s, d) => s + d.p, 0)).toBeCloseTo(1, 9);
    expect(options.map(optionKey)).toContain(optionKey(must(r.chosen)));
    expect(await run(11)).toEqual(r);
  });

  it('sans option, ne fait rien', async () => {
    const r = await new UtilityDecisionPolicy().choose({
      actorId: A,
      state: palmiersAtSalon(),
      options: [],
      rng: new Rng(1),
    });
    expect(r.chosen).toBeNull();
  });

  it('température → 0 : toujours l’option d’utilité maximale', async () => {
    const state = palmiersAtSalon();
    const options = optionsOf(state, A);
    const policy = new UtilityDecisionPolicy({ temperature: { fixed: 0 } });
    const best = utilityDistribution(state, A, options, { temperature: { fixed: 0 } }).reduce((a, b) =>
      b.utility > a.utility ? b : a,
    );
    for (let seed = 0; seed < 20; seed++) {
      const r = await policy.choose({ actorId: A, state, options, rng: new Rng(seed) });
      expect(optionKey(must(r.chosen))).toBe(optionKey(best.option));
    }
  });

  it('un impulsif (température haute) disperse davantage ses choix qu’un posé', () => {
    const entropy = (actorTraits: number): number => {
      const state = palmiersAtSalon((s) => {
        (s.characters[A] as { traits: Record<string, number> }).traits['impulsivity'] = actorTraits;
      });
      const d = utilityDistribution(state, A, optionsOf(state, A));
      return -d.reduce((h, x) => h + (x.p > 0 ? x.p * Math.log(x.p) : 0), 0);
    };
    expect(entropy(95)).toBeGreaterThan(entropy(5));
  });

  it('un personnage loyal choisit break_alliance nettement moins souvent qu’un déloyal', async () => {
    const draws = 4000;
    const policy = new UtilityDecisionPolicy();
    const loyal = await frequencies(policy, allied(95), A, draws, 1);
    const disloyal = await frequencies(policy, allied(5), A, draws, 1);
    const pLoyal = (loyal.get('break_alliance') ?? 0) / draws;
    const pDisloyal = (disloyal.get('break_alliance') ?? 0) / draws;
    expect(pDisloyal).toBeGreaterThan(0.01);
    expect(pLoyal).toBeLessThan(pDisloyal / 3);
    // Test de proportions à deux échantillons : z > 3.
    const pooled = (pLoyal + pDisloyal) / 2;
    const z = (pDisloyal - pLoyal) / Math.sqrt(pooled * (1 - pooled) * (2 / draws));
    expect(z).toBeGreaterThan(3);
    // 8000 décisions complètes : quelques secondes, davantage sur une machine chargée.
  }, 30_000);

  it('la directive oriente : forbid exclut, prefer et biais d’action/cible relèvent l’utilité', async () => {
    const state = palmiersAtSalon((s) => {
      (s.characters[A] as { directive: unknown }).directive = {
        actions: { propose_alliance: 1.5, confront: -2 },
        targets: { [S]: 1.2, [T]: -1 },
        prefer: ['join_activity'],
        forbid: ['small_talk'],
      };
    });
    const plain = palmiersAtSalon();
    expect(utilityBreakdown(state, A, opt('small_talk', S)).forbidden).toBe(true);
    expect(utilityBreakdown(state, A, opt('propose_alliance', S)).terms.directive).toBeCloseTo(2.7);
    expect(utilityBreakdown(state, A, opt('confront', T)).terms.directive).toBeCloseTo(-3);
    expect(utilityBreakdown(plain, A, opt('propose_alliance', S)).terms.directive).toBe(0);
    const counts = await frequencies(new UtilityDecisionPolicy(), state, A, 500, 4);
    expect(counts.get('small_talk') ?? 0).toBe(0);
  });

  it('la fatigue pousse au repos ; une intention talk_to oriente vers sa cible', () => {
    const rested = palmiersAtSalon();
    const tired = palmiersAtSalon((s) => {
      character(s, A).stats.energy = 8;
    });
    const rest = (s: SimState) => utilityBreakdown(s, A, opt('rest')).total;
    expect(rest(tired)).toBeGreaterThan(rest(rested) + 1.5);

    const talk = palmiersAtSalon((s) => {
      character(s, A).agenda.push({
        kind: 'talk_to',
        targetId: T,
        goal: null,
        factId: null,
        locationId: null,
        priority: 0.9,
      });
    });
    const gap = (s: SimState) =>
      utilityBreakdown(s, A, opt('small_talk', T)).total - utilityBreakdown(s, A, opt('small_talk', L)).total;
    expect(gap(talk) - gap(rested)).toBeCloseTo(0.9);
  });

  it('options ne différant que par le fait : un seul calcul, une seule « part » dans la distribution', () => {
    const FACTS = ['f1', 'f2', 'f3', 'f4'];
    const state = palmiersAtSalon();
    const shares = FACTS.map((factId) => opt('share_secret', S, { factId }));
    const options = [...shares, opt('small_talk', S)];
    const { utilities, groupSizes } = utilitiesOf(state, A, options);
    options.forEach((o, i) => expect(utilities[i]).toBeCloseTo(utilityOf(state, A, o)));
    expect(groupSizes).toEqual([4, 4, 4, 4, 1]);
    // À utilités égales, quatre faits ne pèsent pas quatre fois plus qu'une option seule.
    const alone = utilityDistribution(state, A, [must(shares[0]), opt('small_talk', S)]);
    const grouped = utilityDistribution(state, A, options);
    const massOfShares = grouped.slice(0, 4).reduce((s, d) => s + d.p, 0);
    expect(massOfShares).toBeCloseTo(alone[0]?.p ?? -1, 9);
  });

  it('la répétition du jour est pénalisée (habituation)', () => {
    const state = palmiersAtSalon((s) => {
      s.dailyCounts[`${A}|small_talk|${S}`] = 3;
    });
    expect(utilityBreakdown(state, A, opt('small_talk', S)).terms.habituation).toBeCloseTo(-1.2);
  });
});

describe('chooseDestination (fonction de score déterministe)', () => {
  const at = (s: SimState, who: string, locationId: string) => {
    s.positions[who] = { kind: 'at', locationId, zoneId: null };
  };

  it('ne consomme aucun tirage et rend toujours le même choix', async () => {
    const state = palmiersAtSalon();
    const policy = new UtilityDecisionPolicy();
    const rng = new Rng(5);
    const a = await policy.chooseDestination({ actorId: A, state, rng });
    const b = await policy.chooseDestination({ actorId: A, state, rng });
    expect(a).toEqual(b);
    expect(rng.next()).toBe(new Rng(5).next());
  });

  it('va retrouver, au dernier lieu où il l’a vu, la cible d’une intention', () => {
    const state = palmiersAtSalon((s) => {
      at(s, A, IDS.locations.cuisine);
      at(s, T, IDS.locations.jardin);
      character(s, A).agenda.push({
        kind: 'tell',
        targetId: T,
        goal: null,
        factId: IDS.facts.sarahSecret,
        locationId: IDS.locations.jardin,
        priority: 1,
      });
    });
    const choice = chooseDestinationByScore(state, A);
    expect(choice).toEqual({ kind: 'go', locationId: IDS.locations.jardin, zoneId: null });
    expect(destinationScores(state, A)[0]?.locationId).toBe(IDS.locations.jardin);
  });

  it('reste avec ses alliés quand ils sont là, et fuit l’objet d’une intention avoid', () => {
    const state = palmiersAtSalon((s) => {
      for (const [from, to] of [
        [A, S],
        [S, A],
      ] as const) {
        setEdge(s, from, to, { alliance: 80, trust: 80 });
      }
    });
    expect(chooseDestinationByScore(state, A)).toEqual({ kind: 'stay' });
    const avoid = palmiersAtSalon((s) => {
      character(s, A).agenda.push({
        kind: 'avoid',
        targetId: T,
        goal: null,
        factId: null,
        locationId: IDS.locations.salon,
        priority: 1,
      });
    });
    const choice = chooseDestinationByScore(avoid, A);
    expect(choice.kind).toBe('go');
  });

  it('depuis le hors-jeu (début d’époque), choisit un lieu', () => {
    const state = palmiersAtSalon();
    state.positions[A] = { kind: 'offstage', reason: 'initial', lastLocationId: null };
    expect(chooseDestinationByScore(state, A).kind).toBe('go');
  });
});

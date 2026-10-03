/** Règles de vraisemblance (M8c), une par défaut observé : préconditions, pénalité de répétition, faits non dupliqués. */
import { describe, expect, it } from 'vitest';
import { habituationKey, lastKey, refusalReason } from '../../src/rules/index.js';
import { REPETITION_WINDOW, utilityBreakdown } from '../../src/decision/model/index.js';
import { C, L, Z, go } from '../helpers/epoch-kit.js';
import { A, S, T, opt, optionsOf, palmiersAtSalon, sceneOf, setEdge } from '../helpers/decision-kit.js';
import { knowledgeOf, option, runMini } from '../helpers/knowledge-kit.js';
import type { KnowledgeEdge, SimState } from '../../src/state/types.js';

const FACT = 'fact-1';
const edgeOf = (characterId: string, over: Partial<KnowledgeEdge> = {}): KnowledgeEdge => ({
  id: `k-${characterId}-${String(Math.random())}`,
  characterId,
  factId: FACT,
  sourceType: 'witnessed',
  toldById: null,
  viaEventId: null,
  parentKnowledgeId: null,
  learnedEpoch: 0,
  learnedTick: 0,
  confidence: 1,
  belief: 'believes',
  ...over,
});
const withFact = (s: SimState, edges: KnowledgeEdge[], over: Partial<SimState['facts'][string]> = {}): void => {
  s.facts[FACT] = {
    id: FACT,
    subjectId: C.thomas,
    predicate: 'a menacé',
    objectId: C.lea,
    objectText: null,
    isTrue: true,
    sensitivity: 2,
    originEventId: 'e0',
    inventedById: null,
    ...over,
  };
  for (const e of edges) s.knowledge[e.id] = e;
};
const why = (s: SimState, o: ReturnType<typeof opt>) => refusalReason(s, A, o, sceneOf(s));

describe('share_secret : on ne répète pas une confidence', () => {
  const share = opt('share_secret', S, { factId: FACT });

  it('proposée tant que la cible ne sait pas', () => {
    const s = palmiersAtSalon((st) => withFact(st, [edgeOf(A, { sourceType: 'told', toldById: T, viaEventId: 'e1' })]));
    expect(why(s, share)).toBeNull();
  });

  it('refusée si l’émetteur le lui a déjà dit', () => {
    const s = palmiersAtSalon((st) =>
      withFact(st, [
        edgeOf(A, { sourceType: 'told', toldById: T, viaEventId: 'e1' }),
        edgeOf(S, { sourceType: 'told', toldById: A, viaEventId: 'e2' }),
      ]),
    );
    expect(why(s, share)).toBe('preconditions');
    expect(optionsOf(s, A).some((o) => o.action === 'share_secret' && o.targetId === S)).toBe(false);
  });

  it('refusée s’il l’a vue l’apprendre (témoin du même event)', () => {
    const s = palmiersAtSalon((st) => withFact(st, [edgeOf(A, { viaEventId: 'e1' }), edgeOf(S, { viaEventId: 'e1' })]));
    expect(why(s, share)).toBe('preconditions');
  });

  it('refusée si la cible en est le sujet ou l’objet (c’est une confrontation, pas une confidence)', () => {
    const asObject = palmiersAtSalon((st) => withFact(st, [edgeOf(A, { viaEventId: 'e1' })], { objectId: S }));
    expect(why(asObject, share)).toBe('preconditions');
    const asSubject = palmiersAtSalon((st) => withFact(st, [edgeOf(A, { viaEventId: 'e1' })], { subjectId: S }));
    expect(why(asSubject, share)).toBe('preconditions');
  });

  it('un tiers qui a seulement soupçonné le fait (même event, mais non témoin) ne bloque pas la confidence', () => {
    const s = palmiersAtSalon((st) =>
      withFact(st, [edgeOf(A, { viaEventId: 'e1' }), edgeOf(S, { sourceType: 'inferred', viaEventId: 'e1' })]),
    );
    expect(why(s, share)).toBeNull();
  });
});

describe('propose_alliance : une proposition par cible et par jour', () => {
  it('n’est plus proposée à qui a déjà reçu (ou refusé) la proposition aujourd’hui', () => {
    const fresh = palmiersAtSalon();
    expect(why(fresh, opt('propose_alliance', S))).toBeNull();
    const asked = palmiersAtSalon((s) => {
      s.dailyCounts[habituationKey(A, 'propose_alliance', S)] = 1;
    });
    expect(why(asked, opt('propose_alliance', S))).toBe('preconditions');
    expect(why(asked, opt('propose_alliance', T))).toBeNull();
  });

  it('ni à un allié', () => {
    const allied = palmiersAtSalon((st) => setEdge(st, A, S, { alliance: 60 }));
    expect(why(allied, opt('propose_alliance', S))).toBe('preconditions');
  });
});

describe('rumeurs et mensonges : toujours à propos d’un tiers', () => {
  it('spread_rumor et lie exigent un personnage hors acteur et cible', () => {
    const s = palmiersAtSalon((st) => {
      for (const id of [C.lea, C.thomas]) {
        const gone = st.characters[id];
        if (gone) gone.status = 'eliminated';
      }
    });
    expect(why(s, opt('spread_rumor', S))).toBe('preconditions');
    expect(why(s, opt('lie', S))).toBe('preconditions');
    expect(why(palmiersAtSalon(), opt('spread_rumor', S))).toBeNull();
    expect(why(palmiersAtSalon(), opt('lie', S))).toBeNull();
  });
});

describe('confront / accuse : pas à propos de ce qu’on a fait soi-même', () => {
  it('l’option avec fait est écartée si l’acteur en est le sujet', () => {
    const s = palmiersAtSalon((st) =>
      withFact(st, [edgeOf(A, { viaEventId: 'e1' })], { subjectId: A, predicate: 'a flirté avec', objectId: T }),
    );
    expect(optionsOf(s, A).filter((o) => o.action === 'confront' && o.factId === FACT)).toEqual([]);
    const other = palmiersAtSalon((st) =>
      withFact(st, [edgeOf(A, { viaEventId: 'e1' })], { subjectId: T, predicate: 'a menacé', objectId: S }),
    );
    expect(optionsOf(other, A).some((o) => o.action === 'confront' && o.targetId === T && o.factId === FACT)).toBe(
      true,
    );
  });
});

describe('utilité : pénalité de répétition', () => {
  const at = (tick: number, lastTick: number | null) =>
    palmiersAtSalon((s) => {
      s.tick = tick;
      if (lastTick !== null) s.dailyCounts[lastKey(A, 'confront', T)] = lastTick + 1;
    });
  const repetition = (s: SimState, target = T) => utilityBreakdown(s, A, opt('confront', target)).terms.repetition;

  it('nulle sans précédent, pleine au tick suivant, décroissante, nulle hors fenêtre', () => {
    expect(repetition(at(10, null))).toBe(0);
    const next = repetition(at(10, 9));
    const later = repetition(at(10, 7));
    expect(next).toBeCloseTo(-1);
    expect(later).toBeGreaterThan(next);
    expect(later).toBeLessThan(0);
    expect(repetition(at(20, 20 - REPETITION_WINDOW - 1))).toBe(0);
  });

  it('ne vaut que pour la même cible', () => {
    expect(repetition(at(10, 9), S)).toBe(0);
  });

  it('baisse l’utilité totale', () => {
    const fresh = utilityBreakdown(at(10, null), A, opt('confront', T)).total;
    const repeated = utilityBreakdown(at(10, 9), A, opt('confront', T)).total;
    expect(repeated).toBeCloseTo(fresh - 1);
  });
});

describe('faits notables : réutilisés, pas dupliqués', () => {
  const GARDEN = {
    [C.alexandre]: { 0: go(L.jardin, Z.banc) },
    [C.thomas]: { 0: go(L.jardin, Z.banc) },
  };

  it('répéter une action notable réutilise le fait ; la connaissance s’ajoute via un nouvel event', async () => {
    const r = await runMini({
      destinations: GARDEN,
      actions: { [C.alexandre]: { 0: option('flirt', C.thomas), 1: option('flirt', C.thomas) } },
    });
    const flirts = Object.values(r.state.facts).filter((f) => f.predicate === 'a flirté avec');
    expect(flirts).toHaveLength(1);
    const edges = knowledgeOf(r.state, C.thomas, flirts[0]?.id ?? '');
    expect(edges).toHaveLength(2);
    expect(new Set(edges.map((k) => k.viaEventId)).size).toBe(2);
    expect(r.journal.events.filter((e) => e.type === 'flirted')).toHaveLength(2);
  });

  it('une rumeur répétée réutilise aussi le fait faux', async () => {
    const r = await runMini({
      destinations: GARDEN,
      actions: { [C.alexandre]: { 0: option('spread_rumor', C.thomas), 1: option('spread_rumor', C.thomas) } },
      outcomes: { spread_rumor: 'believed' },
    });
    const rumors = Object.values(r.state.facts).filter((f) => !f.isTrue);
    expect(rumors).toHaveLength(1);
    expect(knowledgeOf(r.state, C.alexandre, rumors[0]?.id ?? '')).toHaveLength(1);
  });
});

describe('confrontation : on ne raconte pas à un protagoniste ce qu’il a vécu avec soi', () => {
  it('Thomas confronte Alexandre sur leur flirt : Alexandre, témoin direct, n’en est pas « informé » par Thomas', async () => {
    const destinations = {
      [C.alexandre]: { 0: go(L.jardin, Z.banc) },
      [C.thomas]: { 0: go(L.jardin, Z.banc) },
    };
    const first = await runMini({ destinations, actions: { [C.alexandre]: { 0: option('flirt', C.thomas) } } });
    const flirt = Object.values(first.state.facts).find((f) => f.predicate === 'a flirté avec');
    expect(flirt).toBeDefined();
    const r = await runMini({
      destinations,
      actions: {
        [C.alexandre]: { 0: option('flirt', C.thomas) },
        [C.thomas]: { 1: option('confront', C.alexandre, flirt?.id ?? null) },
      },
    });
    expect(r.journal.events.some((e) => e.type === 'confrontation')).toBe(true);
    const mine = knowledgeOf(r.state, C.alexandre, flirt?.id ?? '');
    expect(mine.map((k) => k.sourceType)).toEqual(['witnessed']);
  });
});

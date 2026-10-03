import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import {
  type VoteKind,
  type VoteRules,
  castVote,
  decide,
  fakeItem,
  findItem,
  formatOf,
  injectPublic,
  openRevote,
  openVote,
  placeItem,
  playItem,
  tally,
  votesOf,
  DEFAULT_VOTE_RULES,
} from '../../src/formats/index.js';
import { relKey } from '../../src/state/types.js';
import { A, DEF, L, LEA, S, T, formatKit, must } from '../helpers/format-kit.js';

function council(over: { kind?: VoteKind; rules?: Partial<VoteRules>; electorate?: string[] } = {}) {
  const kit = formatKit();
  const opened = openVote(kit.state, kit.fc, {
    kind: over.kind ?? 'elimination',
    ...(over.electorate ? { electorate: over.electorate } : {}),
    ...(over.rules ? { rules: over.rules } : {}),
  });
  const vote = (voter: string, target: string) =>
    castVote(kit.state, { sessionId: opened.session.id, voterId: voter, targetId: target });
  return { kit, session: opened.session, vote, opened };
}

describe('VoteService : décompte', () => {
  it('le plus voté est éliminé : événements vote_tallied puis status_changed, statut mis à jour', () => {
    const { kit, session, vote } = council();
    vote(A, T);
    vote(S, T);
    vote(LEA, T);
    vote(T, A);
    const out = tally(kit.state, kit.fc, session.id);
    expect(out.result).toMatchObject({
      status: 'decided',
      eliminated: T,
      counts: { [T]: 3, [A]: 1 },
      tied: [T],
      needsRevote: false,
    });
    expect(out.events.map((e) => e.type)).toEqual(['vote_tallied', 'status_changed']);
    expect(out.events[1]?.causedByEventId).toBe(out.events[0]?.id);
    expect(kit.state.characters[T]?.status).toBe('eliminated');
    expect(out.statusChanges).toEqual([{ characterId: T, to: 'eliminated' }]);
    expect(session.eventId).toBe(out.events[0]?.id);
    expect(session.result).toBe(out.result);
  });

  it('une désignation ne change pas le statut', () => {
    const { kit, session, vote } = council({ kind: 'designation' });
    vote(A, T);
    vote(S, T);
    const out = tally(kit.state, kit.fc, session.id);
    expect(out.result.eliminated).toBe(T);
    expect(kit.state.characters[T]?.status).toBe('active');
    expect(out.statusChanges).toEqual([]);
  });

  it('un bulletin par votant, électeur et candidat valides, pas de vote pour soi', () => {
    const { kit, session, vote } = council({ electorate: [A, S, LEA] });
    vote(A, T);
    expect(() => vote(A, S)).toThrow(/déjà voté/);
    expect(() => vote(T, A)).toThrow(/électorat/);
    expect(() => vote(S, S)).toThrow(/soi-même/);
    expect(() => castVote(kit.state, { sessionId: session.id, voterId: S, targetId: 'inconnu' })).toThrow(/candidat/);
    expect(votesOf(kit.state, session.id)).toHaveLength(1);
    tally(kit.state, kit.fc, session.id);
    expect(() => vote(LEA, T)).toThrow(/close/);
    expect(() => tally(kit.state, kit.fc, session.id)).toThrow(/déjà décomptée/);
  });

  it('personne n’a voté : no_votes', () => {
    const { kit, session } = council();
    const out = tally(kit.state, kit.fc, session.id);
    expect(out.result).toMatchObject({ status: 'no_votes', eliminated: null });
    expect(out.events.map((e) => e.type)).toEqual(['vote_tallied']);
  });

  it('les bulletins révélés coûtent de la confiance et créent de la rivalité envers le votant', () => {
    const { kit, session, vote } = council({ rules: { revealVotes: true } });
    vote(A, T);
    vote(S, T);
    vote(T, A);
    const out = tally(kit.state, kit.fc, session.id);
    const edge = kit.state.relationships[relKey(T, A)];
    expect(edge?.trust).toBe(30 - 8);
    expect(edge?.rivalry).toBe(5);
    expect(out.effects.filter((e) => e.targetKind === 'relationship')).toHaveLength(6);
    expect(votesOf(kit.state, session.id).every((v) => v.revealed)).toBe(true);
  });
});

describe('VoteService : égalité et révote', () => {
  const tied = () => {
    const c = council();
    c.vote(A, T);
    c.vote(S, T);
    c.vote(LEA, A);
    c.vote(T, A);
    return c;
  };

  it('égalité en tête : révote demandé, personne n’est éliminé', () => {
    const { kit, session } = tied();
    const out = tally(kit.state, kit.fc, session.id);
    expect(out.result).toMatchObject({
      status: 'tie',
      eliminated: null,
      tied: [A, T].sort(),
      needsRevote: true,
      round: 1,
    });
    expect(kit.state.characters[T]?.status).toBe('active');
  });

  it('openRevote ouvre un 2e tour restreint aux ex æquo, mêmes électeurs ; au 2e tour le tirage départage', () => {
    const { kit, session } = tied();
    tally(kit.state, kit.fc, session.id);
    const second = openRevote(kit.state, kit.fc, session.id).session;
    expect(second.rules).toMatchObject({ round: 2, previousSessionId: session.id, candidates: [A, T].sort() });
    expect(second.electorate).toEqual(session.electorate);
    expect(() => castVote(kit.state, { sessionId: second.id, voterId: S, targetId: LEA })).toThrow(/candidat/);
    castVote(kit.state, { sessionId: second.id, voterId: S, targetId: T });
    castVote(kit.state, { sessionId: second.id, voterId: LEA, targetId: T });
    castVote(kit.state, { sessionId: second.id, voterId: A, targetId: T });
    castVote(kit.state, { sessionId: second.id, voterId: T, targetId: A });
    const out = tally(kit.state, kit.fc, second.id);
    expect(out.result).toMatchObject({ status: 'decided', eliminated: T, round: 2 });
  });

  it('une égalité persistante au dernier tour est tranchée par tirage (règle revote)', () => {
    const { kit, session } = tied();
    tally(kit.state, kit.fc, session.id);
    const second = openRevote(kit.state, kit.fc, session.id).session;
    castVote(kit.state, { sessionId: second.id, voterId: S, targetId: T });
    castVote(kit.state, { sessionId: second.id, voterId: LEA, targetId: A });
    const out = tally(kit.state, kit.fc, second.id, Rng.derive('seed', 1));
    expect(out.result.status).toBe('decided');
    expect([A, T]).toContain(out.result.eliminated);
  });

  it('sans graine, le tirage est refusé', () => {
    const { kit, session } = council({ rules: { tie: 'random' } });
    castVote(kit.state, { sessionId: session.id, voterId: A, targetId: T });
    castVote(kit.state, { sessionId: session.id, voterId: S, targetId: A });
    expect(() => tally(kit.state, kit.fc, session.id)).toThrow(/tirage/);
    const out = tally(kit.state, kit.fc, session.id, Rng.derive('seed', 2));
    expect([A, T]).toContain(out.result.eliminated);
  });

  it('tie = none : personne, sans révote', () => {
    const { kit, session } = council({ rules: { tie: 'none' } });
    castVote(kit.state, { sessionId: session.id, voterId: A, targetId: T });
    castVote(kit.state, { sessionId: session.id, voterId: S, targetId: A });
    const out = tally(kit.state, kit.fc, session.id);
    expect(out.result).toMatchObject({ status: 'tie', eliminated: null, needsRevote: false });
    expect(() => openRevote(kit.state, kit.fc, session.id)).toThrow(/révote/);
  });

  it('decide : table de cas', () => {
    const r = (over: Partial<VoteRules>): VoteRules => ({ ...DEFAULT_VOTE_RULES, ...over });
    const rng = Rng.derive('d', 1);
    expect(decide({}, r({}), []).status).toBe('no_votes');
    expect(decide({ a: 0 }, r({}), []).status).toBe('no_votes');
    expect(decide({ a: 2, b: 1 }, r({}), [])).toMatchObject({ status: 'decided', eliminated: 'a' });
    expect(decide({ a: 2, b: 2 }, r({}), [])).toMatchObject({ status: 'tie', needsRevote: true });
    expect(decide({ a: 2, b: 2 }, r({ round: 2 }), [], rng).status).toBe('decided');
    expect(decide({ a: 2, b: 2 }, r({ maxRounds: 1 }), [], rng).status).toBe('decided');
    expect(decide({ a: 2, b: 2 }, r({ tie: 'none' }), [])).toMatchObject({ status: 'tie', needsRevote: false });
  });
});

describe('VoteService : le collier annule les votes contre son porteur', () => {
  /** Léa trouve le collier ; tout le monde (sauf elle) vote contre elle, Thomas reçoit un vote. */
  function necklaceCouncil(opts: { fake?: boolean } = {}) {
    const c = council();
    const { kit } = c;
    const placed = placeItem(kit.state, kit.fc, { itemDefId: DEF.necklace, locationId: L.jardin, hidden: true });
    const item = opts.fake
      ? fakeItem(kit.state, kit.fc, { itemDefId: DEF.necklace, actorId: LEA }).item
      : findItem(kit.state, kit.fc, { actorId: LEA, itemId: placed.item.id }).item;
    c.vote(A, LEA);
    c.vote(S, LEA);
    c.vote(T, LEA);
    c.vote(LEA, T);
    return { ...c, item };
  }

  it('sans jouer le collier, Léa est éliminée', () => {
    const { kit, session } = necklaceCouncil();
    expect(tally(kit.state, kit.fc, session.id).result.eliminated).toBe(LEA);
  });

  it('collier joué : les 3 voix contre Léa sont annulées, Thomas (1 voix) est éliminé, le collier est consommé', () => {
    const { kit, session, item } = necklaceCouncil();
    const played = playItem(kit.state, kit.fc, session.id, LEA, item.id);
    expect(played.played).toEqual({ itemId: item.id, holderId: LEA });
    expect(played.events.map((e) => e.type)).toEqual(['item_used']);
    expect(item.state).toBe('used');
    const out = tally(kit.state, kit.fc, session.id);
    expect(out.result).toMatchObject({ status: 'decided', eliminated: T, counts: { [T]: 1 }, nullified: [LEA] });
    expect(kit.state.characters[LEA]?.status).toBe('active');
    expect(kit.state.characters[T]?.status).toBe('eliminated');
  });

  it('faux collier joué : aucun effet, Léa est éliminée', () => {
    const { kit, session, item } = necklaceCouncil({ fake: true });
    expect(playItem(kit.state, kit.fc, session.id, LEA, item.id).played).toBeNull();
    expect(tally(kit.state, kit.fc, session.id).result.eliminated).toBe(LEA);
  });

  it('on ne joue que ce qu’on possède, et pas après le décompte', () => {
    const { kit, session, item } = necklaceCouncil();
    expect(() => playItem(kit.state, kit.fc, session.id, T, item.id)).toThrow(/ne possède pas/);
    tally(kit.state, kit.fc, session.id);
    expect(() => playItem(kit.state, kit.fc, session.id, LEA, item.id)).toThrow(/close/);
  });

  it('immunityItems = false : le collier joué est ignoré au décompte', () => {
    const c = council({ rules: { immunityItems: false } });
    const placed = placeItem(c.kit.state, c.kit.fc, { itemDefId: DEF.necklace, locationId: L.jardin, hidden: true });
    const item = findItem(c.kit.state, c.kit.fc, { actorId: LEA, itemId: placed.item.id }).item;
    c.vote(A, LEA);
    c.vote(S, LEA);
    playItem(c.kit.state, c.kit.fc, c.session.id, LEA, item.id);
    expect(tally(c.kit.state, c.kit.fc, c.session.id).result.eliminated).toBe(LEA);
  });

  it('en cas de révote, le collier joué reste actif pour le tour suivant s’il n’est pas consommé', () => {
    const { kit, session } = council();
    const fs = formatOf(kit.state);
    fs.itemDefs[DEF.necklace] = { ...must(fs.itemDefs[DEF.necklace]), effects: { nullify_votes_against_holder: true } };
    const placed = placeItem(kit.state, kit.fc, { itemDefId: DEF.necklace, locationId: L.jardin, hidden: true });
    const item = findItem(kit.state, kit.fc, { actorId: LEA, itemId: placed.item.id }).item;
    castVote(kit.state, { sessionId: session.id, voterId: A, targetId: T });
    castVote(kit.state, { sessionId: session.id, voterId: S, targetId: A });
    castVote(kit.state, { sessionId: session.id, voterId: T, targetId: LEA });
    playItem(kit.state, kit.fc, session.id, LEA, item.id);
    const first = tally(kit.state, kit.fc, session.id);
    expect(first.result).toMatchObject({ needsRevote: true, nullified: [LEA] });
    expect(openRevote(kit.state, kit.fc, session.id).session.played).toEqual([{ itemId: item.id, holderId: LEA }]);
  });
});

describe('VoteService : vote du public', () => {
  const publicSession = () => council({ kind: 'public', rules: { tie: 'random' } });

  it('le résultat injecté élimine le plus voté ; les candidats sont tous les personnages en jeu', () => {
    const { kit, session } = publicSession();
    expect(session.electorate).toEqual([]);
    const out = injectPublic(kit.state, kit.fc, session.id, { tallies: { [A]: 120, [S]: 40, [LEA]: 10, [T]: 300 } });
    expect(out.result).toMatchObject({ status: 'decided', eliminated: T, counts: { [A]: 120, [T]: 300 } });
    expect(kit.state.characters[T]?.status).toBe('eliminated');
    expect(out.events.map((e) => e.type)).toEqual(['vote_tallied', 'status_changed']);
    expect(session.eventId).toBe(out.events[0]?.id);
  });

  it('eliminate_bottom sort le moins voté ; none ne sort personne', () => {
    const a = publicSession();
    const bottom = injectPublic(a.kit.state, a.kit.fc, a.session.id, {
      tallies: { [A]: 50, [S]: 5, [LEA]: 20, [T]: 30 },
      mode: 'eliminate_bottom',
    });
    expect(bottom.result.eliminated).toBe(S);
    const b = publicSession();
    const none = injectPublic(b.kit.state, b.kit.fc, b.session.id, { tallies: { [A]: 50 }, mode: 'none' });
    expect(none.result.eliminated).toBeNull();
    expect(b.kit.state.characters[A]?.status).toBe('active');
  });

  it('égalité du public : tirage seedé ; sans graine, refus', () => {
    const a = publicSession();
    expect(() => injectPublic(a.kit.state, a.kit.fc, a.session.id, { tallies: { [A]: 10, [S]: 10 } })).toThrow(
      /tirage/,
    );
    const out = injectPublic(
      a.kit.state,
      a.kit.fc,
      a.session.id,
      { tallies: { [A]: 10, [S]: 10 } },
      Rng.derive('p', 1),
    );
    expect([A, S]).toContain(out.result.eliminated);
  });

  it('refuse : candidats inconnus, voix négatives, session non publique, double injection, vote ordinaire sur session publique', () => {
    const a = publicSession();
    expect(() => injectPublic(a.kit.state, a.kit.fc, a.session.id, { tallies: { inconnu: 3 } })).toThrow(/candidat/);
    expect(() => injectPublic(a.kit.state, a.kit.fc, a.session.id, { tallies: { [A]: -1 } })).toThrow(/invalide/);
    expect(() => castVote(a.kit.state, { sessionId: a.session.id, voterId: A, targetId: S })).toThrow(/injecté/);
    expect(() => tally(a.kit.state, a.kit.fc, a.session.id)).toThrow(/injectPublic/);
    injectPublic(a.kit.state, a.kit.fc, a.session.id, { tallies: { [A]: 1 } });
    expect(() => injectPublic(a.kit.state, a.kit.fc, a.session.id, { tallies: { [A]: 1 } })).toThrow(/déjà close/);
    const b = council();
    expect(() => injectPublic(b.kit.state, b.kit.fc, b.session.id, { tallies: {} })).toThrow(/public/);
  });
});

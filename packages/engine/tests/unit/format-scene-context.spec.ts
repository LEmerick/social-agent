import { describe, expect, it } from 'vitest';
import {
  castVote,
  createTeam,
  evaluate,
  formatOf,
  moveCharacter,
  openVote,
  pairKey,
  placeItem,
  pickUp,
  recordAction,
  trackPresence,
  withFormatContext,
} from '../../src/formats/index.js';
import { availableOptions } from '../../src/rules/index.js';
import { A, DEF, L, LEA, S, T, formatKit } from '../helpers/format-kit.js';

const members = (...ids: string[]) => ids.map((characterId) => ({ characterId, locationId: L.jardin, zoneId: null }));

describe('suivi : présences communes et historique d’actions', () => {
  it('trackPresence compte un tick par paire présente ensemble ; present_with le lit', () => {
    const { state } = formatKit();
    trackPresence(state, [[A, S, LEA], [T]]);
    trackPresence(state, [
      [A, S],
      [LEA, T],
    ]);
    const fs = formatOf(state);
    expect(fs.presence[pairKey(A, S)]).toBe(2);
    expect(fs.presence[pairKey(S, A)]).toBe(2);
    expect(fs.presence[pairKey(A, LEA)]).toBe(1);
    expect(fs.presence[pairKey(A, T)]).toBeUndefined();
    expect(evaluate({ present_with: { who: A, with: S, ticks: 2 } }, state)).toBe(true);
    expect(evaluate({ present_with: { who: A, with: LEA, ticks: 2 } }, state)).toBe(false);
  });

  it('recordAction alimente action_done', () => {
    const { state } = formatKit();
    expect(evaluate({ action_done: { who: A, action: 'accuse', target: T } }, state)).toBe(false);
    recordAction(state, { actorId: A, action: 'accuse', targetId: T, locationId: null, epoch: 3, tick: 8 });
    expect(evaluate({ action_done: { who: A, action: 'accuse', target: T } }, state)).toBe(true);
  });
});

describe('withFormatContext : ce que voit le catalogue d’actions', () => {
  it('objets au sol, inventaires, non transférables, votes ouverts et camps ennemis', () => {
    const kit = formatKit();
    const { state, fc } = kit;
    const ration = placeItem(state, fc, { itemDefId: DEF.ration, locationId: L.jardin, hidden: false }).item;
    placeItem(state, fc, { itemDefId: DEF.necklace, locationId: L.jardin, hidden: true });
    const statue = placeItem(state, fc, { itemDefId: DEF.statue, locationId: L.salon, hidden: false }).item;
    pickUp(state, fc, { actorId: S, itemId: ration.id });
    const red = createTeam(state, fc, { slug: 'red', name: 'R', campLocationId: L.jardin }).team;
    const yellow = createTeam(state, fc, { slug: 'yellow', name: 'J', campLocationId: L.cuisine }).team;
    moveCharacter(state, fc, A, red.id);
    moveCharacter(state, fc, T, yellow.id);
    const base = { members: members(A, S, LEA, T) };

    let ctx = withFormatContext(state, base, A);
    expect(ctx.itemsHere).toEqual([]);
    expect(ctx.inventory?.[S]).toEqual([ration.id]);
    expect(ctx.untransferable).toEqual([statue.id]);
    expect(ctx.enemyCamps).toEqual([L.cuisine]);
    expect(ctx.voteOpen).toBe(false);

    const { session } = openVote(state, fc, { kind: 'elimination', electorate: [A, S] });
    ctx = withFormatContext(state, base, A);
    expect([ctx.voteOpen, ctx.voteUpcoming]).toEqual([true, true]);
    expect(ctx.voteCandidates).toEqual([A, S, LEA, T].sort());
    expect(withFormatContext(state, base, T).voteOpen).toBe(false);
    castVote(state, { sessionId: session.id, voterId: A, targetId: T });
  });

  it('les actions d’objet et de vote ne sont proposées que si le format les active', () => {
    const kit = formatKit();
    const { state, fc } = kit;
    placeItem(state, fc, { itemDefId: DEF.ration, locationId: L.jardin, hidden: false });
    openVote(state, fc, { kind: 'elimination' });
    const ctx = withFormatContext(state, { members: members(A, S, LEA, T) }, A);
    const actions = (s: typeof state) => new Set(availableOptions(s, A, ctx).map((o) => o.action));
    expect(actions(state).has('pick_up')).toBe(false);
    expect(actions(state).has('cast_vote')).toBe(false);
    const enabled = structuredClone(state);
    (enabled.season.rules as { enabledActions: readonly string[] }).enabledActions = ['pick_up', 'cast_vote'];
    expect(actions(enabled).has('pick_up')).toBe(true);
    expect(actions(enabled).has('cast_vote')).toBe(true);
  });
});

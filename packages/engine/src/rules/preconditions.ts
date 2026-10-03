/**
 * Préconditions pures du catalogue (action-catalog.md §2, colonne « Prérequis »).
 * Toutes lisent un `SimState` sans le modifier.
 */
import { defaultEdge } from '../state/apply-effect.js';
import { relKey, type Id, type RelationshipEdge, type SimState } from '../state/types.js';
import type { Precondition, SceneContext, SceneMember } from './types.js';

/** Arête source→cible, ou arête par défaut si elles ne se connaissent pas encore (sans l'insérer). */
export const relOf = (state: Readonly<SimState>, sourceId: Id, targetId: Id): Readonly<RelationshipEdge> =>
  state.relationships[relKey(sourceId, targetId)] ?? defaultEdge(sourceId, targetId);

export const memberOf = (ctx: SceneContext, characterId: Id): SceneMember | undefined =>
  ctx.members.find((m) => m.characterId === characterId);

const inGame = (state: Readonly<SimState>, id: Id): boolean => {
  const c = state.characters[id];
  return c !== undefined && c.status !== 'eliminated' && c.status !== 'paused';
};

/** La cible est un autre personnage présent dans la scène de l'acteur. */
export const sceneTarget: Precondition = (state, actorId, option, ctx) =>
  option.targetId !== null &&
  option.targetId !== actorId &&
  memberOf(ctx, option.targetId) !== undefined &&
  inGame(state, option.targetId);

/** Interaction négative passée : la cible nous en veut (méfiance, rancune ou affection négative). */
export const hasNegativePast = (state: Readonly<SimState>, actorId: Id, targetId: Id): boolean => {
  const back = relOf(state, targetId, actorId);
  const forth = relOf(state, actorId, targetId);
  return back.trust < 30 || back.rivalry >= 20 || back.affection < 0 || forth.rivalry >= 20;
};

const ownsItem = (ctx: SceneContext, characterId: Id, itemId: Id | null): boolean =>
  itemId !== null && (ctx.inventory?.[characterId] ?? []).includes(itemId);

export const PRE = {
  scene: sceneTarget,
  anyCharacter: (state, actorId, o) => o.targetId !== null && o.targetId !== actorId && inGame(state, o.targetId),
  always: () => true,
  confide: (s, a, o, c) => sceneTarget(s, a, o, c) && relOf(s, a, o.targetId ?? '').trust >= 40,
  comfort: (s, a, o, c) => sceneTarget(s, a, o, c) && (s.characters[o.targetId ?? '']?.stats.morale ?? 100) < 40,
  expressFeelings: (s, a, o, c) => sceneTarget(s, a, o, c) && relOf(s, a, o.targetId ?? '').affection >= 30,
  apologize: (s, a, o, c) => sceneTarget(s, a, o, c) && hasNegativePast(s, a, o.targetId ?? ''),
  proposeAlliance: (s, a, o, c) =>
    sceneTarget(s, a, o, c) &&
    relOf(s, a, o.targetId ?? '').alliance < 50 &&
    relOf(s, o.targetId ?? '', a).alliance < 50,
  breakAlliance: (s, a, o, c) => sceneTarget(s, a, o, c) && relOf(s, a, o.targetId ?? '').alliance >= 50,
  negotiateVote: (s, a, o, c) => sceneTarget(s, a, o, c) && c.voteUpcoming === true,
  shareSecret: (s, a, o, c) =>
    sceneTarget(s, a, o, c) &&
    o.factId !== null &&
    Object.values(s.knowledge).some((k) => k.characterId === a && k.factId === o.factId && k.belief !== 'disbelieves'),
  challenge: (s, a, o, c) => sceneTarget(s, a, o, c) && c.activityAvailable === true,
  sabotage: (s, a, o, c) => sceneTarget(s, a, o, c) && s.characters[a]?.status === 'active',
  moveTo: (s, a, o) => {
    const pos = s.positions[a];
    return (
      o.locationId !== null &&
      pos?.kind === 'at' &&
      s.routes.some((r) => r.fromLocationId === pos.locationId && r.toLocationId === o.locationId)
    );
  },
  eavesdrop: (s, a, o, c) => {
    const me = memberOf(c, a);
    const other = o.targetId === null ? undefined : memberOf(c, o.targetId);
    return (
      me !== undefined &&
      other !== undefined &&
      o.targetId !== a &&
      inGame(s, o.targetId ?? '') &&
      me.locationId === other.locationId &&
      me.zoneId !== other.zoneId
    );
  },
  joinActivity: (_s, _a, o, c) => o.targetId !== null && (c.openSlots ?? []).includes(o.targetId),
  here: (_s, a, o, c) => {
    const me = memberOf(c, a);
    return me !== undefined && (o.locationId === null || o.locationId === me.locationId);
  },
  pickUp: (_s, _a, o, c) => o.itemId !== null && (c.itemsHere ?? []).includes(o.itemId),
  give: (s, a, o, c) =>
    sceneTarget(s, a, o, c) && ownsItem(c, a, o.itemId) && !(c.untransferable ?? []).includes(o.itemId ?? ''),
  steal: (s, a, o, c) => sceneTarget(s, a, o, c) && ownsItem(c, o.targetId ?? '', o.itemId),
  hide: (_s, a, o, c) => ownsItem(c, a, o.itemId) && memberOf(c, a) !== undefined,
  showItem: (s, a, o, c) => sceneTarget(s, a, o, c) && ownsItem(c, a, o.itemId),
  useItem: (_s, a, o, c) => ownsItem(c, a, o.itemId),
  castVote: (s, a, o, c) =>
    c.voteOpen === true &&
    o.targetId !== null &&
    o.targetId !== a &&
    inGame(s, o.targetId) &&
    (c.voteCandidates === undefined || c.voteCandidates.includes(o.targetId)),
  spyCamp: (_s, _a, o, c) => o.locationId !== null && (c.enemyCamps ?? []).includes(o.locationId),
} satisfies Record<string, Precondition>;

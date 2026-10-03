/**
 * Préconditions pures du catalogue (action-catalog.md §2, colonne « Prérequis »).
 * Toutes lisent un `SimState` sans le modifier.
 */
import { defaultEdge } from '../state/apply-effect.js';
import { dailyCount, habituationKey } from '../resolution/habituation.js';
import { relKey, type Id, type KnowledgeEdge, type RelationshipEdge, type SimState } from '../state/types.js';
import type { Precondition, SceneContext, SceneParticipant } from './types.js';

const MAX_DEFAULT_EDGES = 10_000;
/** Arêtes par défaut figées, une par paire : lire une relation absente n'alloue plus. */
const defaultEdges = new Map<string, Readonly<RelationshipEdge>>();

const frozenDefault = (key: string, sourceId: Id, targetId: Id): Readonly<RelationshipEdge> => {
  const known = defaultEdges.get(key);
  if (known) return known;
  const fresh = defaultEdge(sourceId, targetId);
  Object.freeze(fresh.extraAxes);
  Object.freeze(fresh.labels);
  Object.freeze(fresh);
  if (defaultEdges.size >= MAX_DEFAULT_EDGES) defaultEdges.clear();
  defaultEdges.set(key, fresh);
  return fresh;
};

/**
 * Arête source→cible, ou arête par défaut si elles ne se connaissent pas encore (sans l'insérer). L'arête par défaut est
 * partagée et figée : la lire n'alloue rien, et toute tentative de la modifier échoue au lieu de fuir d'un appel à l'autre.
 */
export const relOf = (state: Readonly<SimState>, sourceId: Id, targetId: Id): Readonly<RelationshipEdge> => {
  const key = relKey(sourceId, targetId);
  return state.relationships[key] ?? frozenDefault(key, sourceId, targetId);
};

export const memberOf = (ctx: SceneContext, characterId: Id): SceneParticipant | undefined =>
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

/**
 * Personnage hors acteur et cible, en jeu, qui maximise `score` (à égalité, l'identifiant le plus petit), ou `null`.
 * Sert à choisir de qui parle une rumeur ou un mensonge : jamais l'interlocuteur, à qui on ne « raconte » pas sa propre vie.
 */
const thirdParty = (state: Readonly<SimState>, actorId: Id, targetId: Id, score: (id: Id) => number): Id | null =>
  Object.keys(state.characters)
    .sort()
    .filter((id) => id !== actorId && id !== targetId && inGame(state, id))
    .reduce<Id | null>((best, id) => (best === null || score(id) > score(best) ? id : best), null);

/** Sujet d'une rumeur : le tiers que l'acteur déteste le plus (rivalité la plus haute). */
export const rumorSubject = (state: Readonly<SimState>, actorId: Id, targetId: Id): Id | null =>
  thirdParty(state, actorId, targetId, (id) => relOf(state, actorId, id).rivalry);

/** Complice prétendu d'un mensonge « l'acteur est secrètement allié à X » : le tiers qu'il apprécie le plus. */
export const liePartner = (state: Readonly<SimState>, actorId: Id, targetId: Id): Id | null =>
  thirdParty(state, actorId, targetId, (id) => relOf(state, actorId, id).affection);

const believesFact = (state: Readonly<SimState>, characterId: Id, factId: Id): boolean =>
  Object.values(state.knowledge).some(
    (k) => k.characterId === characterId && k.factId === factId && k.belief !== 'disbelieves',
  );

/**
 * L'émetteur sait que la cible connaît déjà ce fait : il le lui a dit (connaissance `told` de la cible dont il est
 * l'émetteur) ou il l'a vue l'apprendre, c'est-à-dire qu'elle en a été témoin direct lors d'un event par lequel il l'a lui-même appris.
 */
export const targetKnowsFromSender = (state: Readonly<SimState>, senderId: Id, targetId: Id, factId: Id): boolean => {
  const mine = new Set<Id | null>();
  const theirs: KnowledgeEdge[] = [];
  for (const k of Object.values(state.knowledge)) {
    if (k.factId !== factId) continue;
    if (k.characterId === senderId && k.viaEventId !== null) mine.add(k.viaEventId);
    else if (k.characterId === targetId) theirs.push(k);
  }
  return theirs.some(
    (k) => k.toldById === senderId || (k.sourceType === 'witnessed' && k.viaEventId !== null && mine.has(k.viaEventId)),
  );
};

/** Un fait qu'on peut confier à la cible : elle n'en est ni le sujet ni l'objet (sinon : `confront`) et ne le sait pas. */
const tellable = (state: Readonly<SimState>, senderId: Id, targetId: Id, factId: Id): boolean => {
  const fact = state.facts[factId];
  return (
    fact?.subjectId !== targetId &&
    fact?.objectId !== targetId &&
    !targetKnowsFromSender(state, senderId, targetId, factId)
  );
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
    relOf(s, o.targetId ?? '', a).alliance < 50 &&
    // Une seule proposition par cible et par jour : déjà acceptée (alliés de fait) ou refusée (insister est vain).
    dailyCount(s, habituationKey(a, 'propose_alliance', o.targetId)) === 0,
  breakAlliance: (s, a, o, c) => sceneTarget(s, a, o, c) && relOf(s, a, o.targetId ?? '').alliance >= 50,
  negotiateVote: (s, a, o, c) => sceneTarget(s, a, o, c) && c.voteUpcoming === true,
  shareSecret: (s, a, o, c) =>
    sceneTarget(s, a, o, c) &&
    o.factId !== null &&
    believesFact(s, a, o.factId) &&
    tellable(s, a, o.targetId ?? '', o.factId),
  /** Une rumeur parle d'un tiers : il faut un sujet possible hors acteur et cible. */
  spreadRumor: (s, a, o, c) => sceneTarget(s, a, o, c) && rumorSubject(s, a, o.targetId ?? '') !== null,
  lie: (s, a, o, c) => sceneTarget(s, a, o, c) && liePartner(s, a, o.targetId ?? '') !== null,
  /** Confrontation : avec un fait, l'accusateur doit le tenir pour vrai ou douteux (jamais un fait qu'il sait faux). */
  confront: (s, a, o, c) => sceneTarget(s, a, o, c) && (o.factId === null || believesFact(s, a, o.factId)),
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

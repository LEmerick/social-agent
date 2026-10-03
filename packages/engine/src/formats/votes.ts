/**
 * VoteService pur (game-formats.md §5) : ouverture d'un conseil, bulletins, objets joués, décompte.
 * Règles du décompte : un objet joué qui annule les votes contre son porteur (collier d'immunité) retire ces
 * voix ; l'égalité en tête donne un révote (jusqu'à `maxRounds`), un tirage ou personne selon `rules.tie`.
 * Le vote du public (`kind = 'public'`) est injecté de l'extérieur entre deux époques.
 */
import { DomainError } from '../core/errors.js';
import type { Rng } from '../core/rng.js';
import { applyEffect } from '../state/apply-effect.js';
import {
  formatOf,
  peekFormat,
  type PlayedItem,
  type VoteKind,
  type VoteNode,
  type VoteResult,
  type VoteRules,
  type VoteSessionNode,
} from '../state/format-state.js';
import type { Id, SimState } from '../state/types.js';
import { useItem } from './inventory-use.js';
import { emitEffect, emitEvent, emptyOutput, mergeOutput, type FormatContext, type FormatOutput } from './output.js';

const RULE = 'vote';

export const DEFAULT_VOTE_RULES: VoteRules = {
  tie: 'revote',
  maxRounds: 2,
  allowSelfVote: false,
  revealVotes: false,
  immunityItems: true,
  round: 1,
};

const inGame = (state: Readonly<SimState>): Id[] =>
  Object.values(state.characters)
    .filter((c) => c.status !== 'eliminated' && c.status !== 'paused')
    .map((c) => c.id)
    .sort();

function requireSession(state: SimState, sessionId: Id): VoteSessionNode {
  const session = formatOf(state).voteSessions[sessionId];
  if (!session) throw new DomainError('NOT_FOUND', `Session de vote ${sessionId} inconnue`);
  return session;
}

/** Candidats éligibles d'une session. */
export const candidatesOf = (state: Readonly<SimState>, session: VoteSessionNode): Id[] =>
  [...(session.rules.candidates ?? inGame(state))].sort();

export interface OpenVoteInput {
  readonly kind: VoteKind;
  readonly sceneId?: Id | null;
  /** Électeurs ; par défaut tous les personnages en jeu. Ignoré pour un vote du public. */
  readonly electorate?: readonly Id[];
  readonly rules?: Partial<VoteRules>;
  readonly sessionId?: Id;
  readonly causedByEventId?: Id | null;
}

export function openVote(
  state: SimState,
  fc: FormatContext,
  input: OpenVoteInput,
): FormatOutput & { readonly session: VoteSessionNode } {
  const fs = formatOf(state);
  const rules: VoteRules = { ...DEFAULT_VOTE_RULES, ...input.rules };
  if (!Number.isInteger(rules.maxRounds) || rules.maxRounds < 1) {
    throw new DomainError('INVALID_VOTE', 'maxRounds doit être un entier ≥ 1');
  }
  const electorate = input.kind === 'public' ? [] : [...(input.electorate ?? inGame(state))].sort();
  for (const id of [...electorate, ...(rules.candidates ?? [])]) {
    if (!state.characters[id]) throw new DomainError('NOT_FOUND', `Personnage ${id} absent du SimState`);
  }
  const session: VoteSessionNode = {
    id: input.sessionId ?? fc.ids.next(),
    epochId: fc.epochId,
    tick: fc.tick,
    sceneId: input.sceneId ?? null,
    kind: input.kind,
    electorate,
    rules,
    played: [],
    result: null,
    eventId: null,
  };
  if (fs.voteSessions[session.id]) throw new DomainError('DUPLICATE', `Session ${session.id} déjà présente`);
  fs.voteSessions[session.id] = session;
  const out = emptyOutput();
  emitEvent(state, fc, out, {
    type: 'vote_opened',
    sceneId: session.sceneId,
    importance: 0.5,
    payload: { sessionId: session.id, kind: session.kind, round: rules.round, electorate },
    causedByEventId: input.causedByEventId ?? null,
  });
  return { ...out, session };
}

export interface CastInput {
  readonly sessionId: Id;
  readonly voterId: Id;
  readonly targetId: Id;
  readonly decisionId?: Id | null;
  readonly revealed?: boolean;
}

/** Enregistre un bulletin (un par votant et par session). L'événement `vote_cast` vient de la résolution de l'action. */
export function castVote(state: SimState, input: CastInput): VoteNode {
  const session = requireSession(state, input.sessionId);
  if (session.kind === 'public') throw new DomainError('INVALID_VOTE', 'Le vote du public est injecté, pas voté');
  if (session.result !== null) throw new DomainError('VOTE_CLOSED', `La session ${session.id} est close`);
  if (!session.electorate.includes(input.voterId)) {
    throw new DomainError('NOT_ELECTOR', `${input.voterId} ne fait pas partie de l'électorat`);
  }
  if (!candidatesOf(state, session).includes(input.targetId)) {
    throw new DomainError('NOT_CANDIDATE', `${input.targetId} n'est pas candidat`);
  }
  if (input.voterId === input.targetId && !session.rules.allowSelfVote) {
    throw new DomainError('SELF_VOTE', 'Voter pour soi-même est interdit');
  }
  const fs = formatOf(state);
  if (fs.votes.some((v) => v.voteSessionId === session.id && v.voterId === input.voterId)) {
    throw new DomainError('ALREADY_VOTED', `${input.voterId} a déjà voté`);
  }
  const vote: VoteNode = {
    voteSessionId: session.id,
    voterId: input.voterId,
    targetId: input.targetId,
    decisionId: input.decisionId ?? null,
    revealed: input.revealed ?? false,
  };
  fs.votes.push(vote);
  return vote;
}

export const votesOf = (state: Readonly<SimState>, sessionId: Id): VoteNode[] =>
  peekFormat(state)
    .votes.filter((v) => v.voteSessionId === sessionId)
    .sort((a, b) => (a.voterId < b.voterId ? -1 : 1));

/**
 * Un porteur joue son objet pendant le conseil (`use_item`). Si l'objet annule les votes contre lui
 * (`effects.nullify_votes_against_holder`), il est retenu pour le décompte.
 */
export function playItem(
  state: SimState,
  fc: FormatContext,
  sessionId: Id,
  holderId: Id,
  itemId: Id,
): FormatOutput & { readonly played: PlayedItem | null } {
  const session = requireSession(state, sessionId);
  if (session.result !== null) throw new DomainError('VOTE_CLOSED', `La session ${session.id} est close`);
  const used = useItem(state, fc, { actorId: holderId, itemId });
  const out = emptyOutput();
  mergeOutput(out, used);
  const nullifies = used.defEffects['nullify_votes_against_holder'] === true;
  if (!nullifies) return { ...out, played: null };
  const played: PlayedItem = { itemId, holderId };
  session.played.push(played);
  return { ...out, played };
}

/** Détermine le résultat d'un tableau de voix. `rng` n'est lu que pour `tie = 'random'` à la limite des tours. */
export function decide(
  counts: Readonly<Record<Id, number>>,
  rules: VoteRules,
  nullified: readonly Id[],
  rng?: Rng,
): VoteResult {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  const base = { counts, nullified: [...nullified].sort(), round: rules.round };
  if (entries.length === 0) {
    return { ...base, status: 'no_votes', eliminated: null, tied: [], needsRevote: false };
  }
  const top = Math.max(...entries.map(([, n]) => n));
  const tied = entries
    .filter(([, n]) => n === top)
    .map(([id]) => id)
    .sort();
  const [only] = tied;
  if (tied.length === 1 && only) return { ...base, status: 'decided', eliminated: only, tied, needsRevote: false };
  if (rules.tie === 'revote' && rules.round < rules.maxRounds) {
    return { ...base, status: 'tie', eliminated: null, tied, needsRevote: true };
  }
  if (rules.tie === 'random' || rules.tie === 'revote') {
    if (!rng) throw new DomainError('RNG_REQUIRED', 'Un tirage est nécessaire pour départager les égalités');
    return { ...base, status: 'decided', eliminated: rng.pick(tied), tied, needsRevote: false };
  }
  return { ...base, status: 'tie', eliminated: null, tied, needsRevote: false };
}

function conclude(
  state: SimState,
  fc: FormatContext,
  out: FormatOutput,
  session: VoteSessionNode,
  result: VoteResult,
  causedBy: Id | null,
): void {
  session.result = result;
  const event = emitEvent(state, fc, out, {
    type: 'vote_tallied',
    sceneId: session.sceneId,
    importance: 0.8,
    payload: { sessionId: session.id, kind: session.kind, ...result },
    causedByEventId: causedBy,
    participants: result.eliminated ? [{ characterId: result.eliminated, role: 'subject' }] : [],
  });
  session.eventId = event.id;
  const eliminated = result.eliminated;
  if (session.kind !== 'designation' && eliminated) {
    const character = state.characters[eliminated];
    if (character && character.status !== 'eliminated') {
      character.status = 'eliminated';
      emitEvent(state, fc, out, {
        type: 'status_changed',
        importance: 0.9,
        payload: { characterId: eliminated, to: 'eliminated', reason: 'vote', sessionId: session.id },
        causedByEventId: event.id,
        participants: [{ characterId: eliminated, role: 'subject' }],
      });
      out.statusChanges.push({ characterId: eliminated, to: 'eliminated' });
    }
  }
}

/** Effets d'un bulletin révélé : la cible en veut au votant (confiance −8, rivalité +5). */
function revealVotes(
  state: SimState,
  fc: FormatContext,
  out: FormatOutput,
  eventId: Id,
  votes: readonly VoteNode[],
): void {
  for (const v of votes) {
    if (v.voterId === v.targetId) continue;
    v.revealed = true;
    for (const [dimension, delta] of [
      ['trust', -8],
      ['rivalry', 5],
    ] as const) {
      const valueAfter = applyEffect(state, {
        targetKind: 'relationship',
        characterId: v.targetId,
        otherCharacterId: v.voterId,
        dimension,
        delta,
        ruleId: RULE,
        ruleVersion: 1,
        reason: 'vote_against',
      });
      emitEffect(fc, out, eventId, {
        targetKind: 'relationship',
        characterId: v.targetId,
        otherCharacterId: v.voterId,
        dimension,
        delta,
        ruleId: RULE,
        valueAfter,
      });
    }
  }
}

/**
 * Décompte d'un conseil. Les voix contre un porteur d'objet protecteur joué sont annulées ; l'issue suit
 * `decide`. Une élimination (`kind = 'elimination'`) change le statut du personnage (`status_changed`).
 * En cas de `needsRevote`, `openRevote` ouvre le tour suivant.
 */
export function tally(
  state: SimState,
  fc: FormatContext,
  sessionId: Id,
  rng?: Rng,
): FormatOutput & { readonly result: VoteResult } {
  const session = requireSession(state, sessionId);
  if (session.kind === 'public') throw new DomainError('INVALID_VOTE', 'Un vote du public se termine par injectPublic');
  if (session.result !== null) throw new DomainError('VOTE_CLOSED', `La session ${session.id} est déjà décomptée`);
  const votes = votesOf(state, sessionId);
  const protectedIds = session.rules.immunityItems ? [...new Set(session.played.map((p) => p.holderId))] : [];
  const counts: Record<Id, number> = {};
  for (const v of votes) {
    if (protectedIds.includes(v.targetId)) continue;
    counts[v.targetId] = (counts[v.targetId] ?? 0) + 1;
  }
  const nullified = protectedIds.filter((id) => votes.some((v) => v.targetId === id));
  const result = decide(counts, session.rules, nullified, rng);
  const out = emptyOutput();
  conclude(state, fc, out, session, result, null);
  if (session.rules.revealVotes && session.eventId) revealVotes(state, fc, out, session.eventId, votes);
  return { ...out, result };
}

/** Ouvre le tour de départage d'une égalité : mêmes électeurs, candidats = ex æquo, objets joués conservés. */
export function openRevote(
  state: SimState,
  fc: FormatContext,
  sessionId: Id,
): FormatOutput & { readonly session: VoteSessionNode } {
  const previous = requireSession(state, sessionId);
  if (!previous.result?.needsRevote)
    throw new DomainError('NO_REVOTE', `La session ${previous.id} n'appelle pas de révote`);
  const opened = openVote(state, fc, {
    kind: previous.kind,
    sceneId: previous.sceneId,
    electorate: previous.electorate,
    rules: {
      ...previous.rules,
      candidates: previous.result.tied,
      round: previous.rules.round + 1,
      previousSessionId: previous.id,
    },
    causedByEventId: previous.eventId,
  });
  opened.session.played = previous.played.filter((p) => formatOf(state).items[p.itemId]?.state === 'active');
  return opened;
}

export interface PublicVoteInput {
  /** Voix du public par personnage (fournies par l'API, entre deux époques). */
  readonly tallies: Readonly<Record<Id, number>>;
  /** `eliminate_top` : le plus voté est sorti (défaut) ; `eliminate_bottom` : le moins voté ; `none` : simple classement. */
  readonly mode?: 'eliminate_top' | 'eliminate_bottom' | 'none';
}

/** Injecte le résultat du vote du public dans sa session (`kind = 'public'`). */
export function injectPublic(
  state: SimState,
  fc: FormatContext,
  sessionId: Id,
  input: PublicVoteInput,
  rng?: Rng,
): FormatOutput & { readonly result: VoteResult } {
  const session = requireSession(state, sessionId);
  if (session.kind !== 'public')
    throw new DomainError('INVALID_VOTE', 'Seul un vote du public reçoit un résultat injecté');
  if (session.result !== null) throw new DomainError('VOTE_CLOSED', `La session ${session.id} est déjà close`);
  const mode = input.mode ?? 'eliminate_top';
  const eligible = candidatesOf(state, session);
  for (const [id, n] of Object.entries(input.tallies)) {
    if (!eligible.includes(id)) throw new DomainError('NOT_CANDIDATE', `${id} n'est pas candidat`);
    if (!Number.isFinite(n) || n < 0) throw new DomainError('INVALID_VOTE', `Nombre de voix invalide pour ${id}`);
  }
  const counts = Object.fromEntries(eligible.map((id) => [id, input.tallies[id] ?? 0]));
  let result: VoteResult;
  if (mode === 'eliminate_bottom') {
    const max = Math.max(0, ...Object.values(counts));
    // Le moins voté devient le plus « voté pour sortir » : on inverse les voix.
    const inverted = Object.fromEntries(Object.entries(counts).map(([id, n]) => [id, max - n + 1]));
    result = {
      ...decide(inverted, { ...session.rules, tie: session.rules.tie === 'none' ? 'none' : 'random' }, [], rng),
      counts,
    };
  } else {
    result = decide(counts, { ...session.rules, tie: session.rules.tie === 'none' ? 'none' : 'random' }, [], rng);
  }
  if (mode === 'none') result = { ...result, eliminated: null };
  const out = emptyOutput();
  conclude(state, fc, out, session, result, null);
  return { ...out, result };
}

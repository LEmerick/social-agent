/**
 * Conseil de bout en bout (game-formats.md §5) : jeu des objets (chaque porteur décide via sa `DecisionPolicy`),
 * bulletins (option `cast_vote`), décompte avec annulation par le collier, égalité et révote, conséquences
 * (`status_changed → eliminated`, effets « il a voté contre moi » si le vote est révélé). Les discussions préalables
 * sont les interactions normales des ticks de rassemblement. Le vote du public est seulement ouvert : le résultat
 * est injecté de l'extérieur entre deux époques.
 */
import type { TickContext } from '../epoch/types.js';
import { formatOf, type ScheduledEventNode, type VoteSessionNode } from '../state/format-state.js';
import type { Id } from '../state/types.js';
import { ask, optionOf } from './ceremony-kit.js';
import { absorb, formatContextOf } from './hook-kit.js';
import { emitEvent, emptyOutput, type FormatOutput } from './output.js';
import type { SeasonFormat } from './season-format.js';
import { candidatesOf, castVote, openRevote, openVote, playItem, tally } from './votes.js';

export interface CouncilPlace {
  readonly sceneId: Id | null;
  readonly locationId: Id | null;
}

const unique = (ids: readonly Id[]): Id[] => [...new Set(ids)].sort();

/** Personnages immunisés par une épreuve de cette époque (récompense `immunity_team` : l'équipe gagnante ou le vainqueur). */
export function immuneIds(ctx: TickContext): Id[] {
  return unique(
    Object.values(formatOf(ctx.state).scheduled)
      .filter((s) => s.kind === 'challenge' && s.epoch === ctx.epochNumber && s.firedEventId !== null)
      .flatMap((s) => (s.params['result'] as { immuneIds?: Id[] } | undefined)?.immuneIds ?? []),
  );
}

/** Le jeu des objets : chaque électeur qui porte un objet de conseil décide de le jouer ou non. */
async function playItems(ctx: TickContext, session: VoteSessionNode): Promise<void> {
  const fs = formatOf(ctx.state);
  const fc = formatContextOf(ctx);
  for (const voter of session.electorate) {
    if (ctx.state.characters[voter]?.status === 'eliminated') continue;
    const held = Object.values(fs.items)
      .filter(
        (i) =>
          i.holderId === voter && i.state === 'active' && fs.itemDefs[i.itemDefId]?.effects['on'] === 'vote_session',
      )
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const { chosen } = await ask(
      ctx,
      voter,
      held.map((i) => optionOf('use_item', { itemId: i.id })),
      'council-item',
    );
    if (chosen?.itemId) absorb(ctx, playItem(ctx.state, fc, session.id, voter, chosen.itemId));
  }
}

/** Un bulletin par électeur ; l'abstention (`null`) ne laisse aucun bulletin. */
async function collectBallots(ctx: TickContext, session: VoteSessionNode): Promise<void> {
  const fc = formatContextOf(ctx);
  const candidates = candidatesOf(ctx.state, session);
  for (const voter of session.electorate) {
    const options = candidates
      .filter((t) => t !== voter || session.rules.allowSelfVote)
      .map((t) => optionOf('cast_vote', { targetId: t }));
    const { chosen, decisionId } = await ask(ctx, voter, options, `council-vote-${String(session.rules.round)}`);
    if (!chosen?.targetId) continue;
    castVote(ctx.state, { sessionId: session.id, voterId: voter, targetId: chosen.targetId, decisionId });
    const out = emptyOutput();
    emitEvent(ctx.state, fc, out, {
      type: 'vote_cast',
      sceneId: session.sceneId,
      importance: 0.5,
      payload: { sessionId: session.id, round: session.rules.round, voterId: voter, targetId: chosen.targetId },
      participants: [
        { characterId: voter, role: 'actor' },
        { characterId: chosen.targetId, role: 'target' },
      ],
    });
    absorb(ctx, out);
  }
}

export interface CouncilOutcome {
  readonly sessionIds: Id[];
  readonly eliminated: Id | null;
}

/**
 * Conseil d'élimination ou de désignation. `electorate` : les électeurs présents ; `candidates` : les cibles possibles
 * (par défaut l'électorat moins les équipes immunisées). Chaîne les révotes jusqu'à une décision.
 */
export async function runCouncil(
  ctx: TickContext,
  format: SeasonFormat,
  s: ScheduledEventNode,
  electorate: readonly Id[],
  place: CouncilPlace,
  causedByEventId: Id,
  kind: 'elimination' | 'designation' = 'elimination',
  candidates?: readonly Id[],
): Promise<CouncilOutcome> {
  const fc = formatContextOf(ctx);
  const immune = new Set(immuneIds(ctx));
  const pool = candidates ?? electorate.filter((id) => !immune.has(id));
  const opened = openVote(ctx.state, fc, {
    kind,
    sceneId: place.sceneId,
    electorate: unique(electorate),
    rules: { ...format.vote, round: 1, candidates: unique(pool) },
    causedByEventId,
  });
  absorb(ctx, opened);
  let session = opened.session;
  const sessionIds = [session.id];
  await playItems(ctx, session);
  for (;;) {
    await collectBallots(ctx, session);
    const done = tally(ctx.state, fc, session.id, ctx.rng('council-tie', session.id));
    absorb(ctx, done);
    if (!done.result.needsRevote) {
      (s.params as Record<string, unknown>)['sessionId'] = session.id;
      return { sessionIds, eliminated: done.result.eliminated };
    }
    const revote = openRevote(ctx.state, fc, session.id);
    absorb(ctx, revote);
    session = revote.session;
    sessionIds.push(session.id);
  }
}

/** Vote du public : la session est ouverte, son résultat sera injecté par l'API entre deux époques. */
export function openPublicVote(
  ctx: TickContext,
  format: SeasonFormat,
  place: CouncilPlace,
  causedByEventId: Id,
  candidates: readonly Id[],
): FormatOutput {
  return openVote(ctx.state, formatContextOf(ctx), {
    kind: 'public',
    sceneId: place.sceneId,
    rules: { ...format.vote, round: 1, candidates: unique(candidates) },
    causedByEventId,
  });
}

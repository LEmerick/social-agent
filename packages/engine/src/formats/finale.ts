/** Finale (game-formats.md §6) : le jury (les éliminés) désigne le vainqueur parmi les finalistes encore en jeu. */
import type { TickContext } from '../epoch/types.js';
import type { Id } from '../state/types.js';
import { ask, optionOf } from './ceremony-kit.js';
import { absorb, formatContextOf, inGameIds } from './hook-kit.js';
import { emitEvent, emptyOutput } from './output.js';
import type { SeasonFormat } from './season-format.js';
import { castVote, openVote, tally } from './votes.js';

export async function runFinal(ctx: TickContext, format: SeasonFormat, causedByEventId: Id): Promise<Id | null> {
  const { state } = ctx;
  const fc = formatContextOf(ctx);
  const finalists = inGameIds(state);
  const jury = Object.values(state.characters)
    .filter((c) => c.status === 'eliminated')
    .map((c) => c.id)
    .sort();
  const electorate = jury.length > 0 ? jury : finalists;
  const opened = openVote(state, fc, {
    kind: 'designation',
    electorate,
    rules: { ...format.vote, round: 1, tie: 'random', candidates: finalists },
    causedByEventId,
  });
  absorb(ctx, opened);
  for (const voter of electorate) {
    const options = finalists.filter((f) => f !== voter).map((t) => optionOf('cast_vote', { targetId: t }));
    const { chosen, decisionId } = await ask(ctx, voter, options, 'final-vote');
    if (chosen?.targetId) {
      castVote(state, { sessionId: opened.session.id, voterId: voter, targetId: chosen.targetId, decisionId });
    }
  }
  const done = tally(state, fc, opened.session.id, ctx.rng('final-tie'));
  absorb(ctx, done);
  const out = emptyOutput();
  emitEvent(state, fc, out, {
    type: 'season_final',
    importance: 1,
    payload: { sessionId: opened.session.id, winnerId: done.result.eliminated, finalists },
    causedByEventId: done.events[0]?.id ?? causedByEventId,
    participants: done.result.eliminated ? [{ characterId: done.result.eliminated, role: 'subject' }] : [],
  });
  absorb(ctx, out);
  return done.result.eliminated;
}

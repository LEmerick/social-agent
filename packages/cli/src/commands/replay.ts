import { replaySeason } from '@ai-reality/engine';
import { openContext, preplay } from '../context.js';
import { EXIT, type CliIo, emit } from '../io.js';
import type { Parsed } from '../options.js';

/** `replay --season <n> [--world]` : reconstruit la saison depuis le journal et la compare aux projections. */
export async function replay(args: Parsed, io: CliIo): Promise<number> {
  const ctx = await openContext(args, io);
  try {
    await preplay(ctx, args);
    const { ok, stateHash, journalHash, epochs, diffs } = await replaySeason(
      ctx.storage,
      ctx.worldId,
      ctx.seasonNumber,
    );
    const result = { ok, stateHash, journalHash, epochs, diffs };
    const lines = result.ok
      ? [
          `Rejeu de la saison ${String(ctx.seasonNumber)} (${String(result.epochs)} époque(s)) : OK`,
          '  L’état reconstruit depuis le journal est identique aux projections stockées.',
        ]
      : [
          `Rejeu de la saison ${String(ctx.seasonNumber)} (${String(result.epochs)} époque(s)) : ÉCART`,
          `  ${String(result.diffs.length)} différence(s) entre le journal et les projections :`,
          ...result.diffs.map((d) => `  - ${d.message}`),
        ];
    lines.push(`  Empreinte de l’état : ${result.stateHash}`, `  Empreinte du journal : ${result.journalHash}`);
    emit(io, args.json, result, lines);
    return result.ok ? EXIT.ok : EXIT.diff;
  } finally {
    await ctx.close();
  }
}

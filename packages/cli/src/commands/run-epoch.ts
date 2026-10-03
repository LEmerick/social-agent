import { loadSimState } from '@ai-reality/engine';
import { type Context, openContext } from '../context.js';
import { namesOf } from '../fr.js';
import { EXIT, type CliIo, CliError, emit } from '../io.js';
import type { Parsed } from '../options.js';
import { playEpoch } from '../play.js';
import { summarizeEpoch, summaryLines } from '../summary.js';

const POLICY_FR = {
  utility: 'utilité + issues probabilistes',
  random: 'tirage uniforme + issues heuristiques',
} as const;

/** `run-epoch --world <slug|id> --season <n> --epoch <n> [--seed] [--policy utility|random] [--db <url>|--memory]` */
export async function runEpoch(args: Parsed, io: CliIo): Promise<number> {
  if (args.epoch === undefined && !args.memory) throw new CliError('run-epoch exige --epoch <n>.');
  const target = args.epoch ?? 0;
  if (!args.memory && args.seed !== undefined) {
    io.err('Avertissement : --seed n’a d’effet qu’avec --memory (la graine d’un monde en base est celle du monde).\n');
  }
  const ctx = await openContext(args, io);
  try {
    // En mémoire, le monde est neuf : les époques précédentes sont jouées d'abord.
    const first = ctx.memory ? 0 : target;
    let resumed = false;
    for (let number = first; number <= target; number++) {
      resumed = (await playEpoch(ctx, number, args.policy)).resumed;
    }
    emit(io, args.json, ...(await report(ctx, target, args, resumed)));
    return EXIT.ok;
  } finally {
    await ctx.close();
  }
}

async function report(
  ctx: Context,
  target: number,
  args: Parsed,
  resumed: boolean,
): Promise<[payload: unknown, lines: string[]]> {
  const summary = await summarizeEpoch(ctx.storage, ctx.worldId, target);
  const state = await loadSimState(ctx.storage, ctx.worldId, ctx.seasonNumber, { epochNumber: target + 1 });
  const verb = resumed ? 'reprise et terminée' : 'jouée';
  const header = `Monde « ${ctx.world.name} » · saison ${String(ctx.seasonNumber)} · graine ${ctx.world.seed} · politique : ${POLICY_FR[args.policy]}${ctx.memory ? ' · mémoire' : ''}`;
  return [
    {
      world: { id: ctx.worldId, name: ctx.world.name, seed: ctx.world.seed },
      season: ctx.seasonNumber,
      resumed,
      ...summary,
    },
    [
      header,
      `Époque ${String(target)} ${verb}.`,
      ...summaryLines(summary, namesOf(state.characters), state.world.config.ticksPerEpoch),
    ],
  ];
}

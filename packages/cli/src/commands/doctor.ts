import { auditSeason } from '@ai-reality/engine';
import { openContext, preplay } from '../context.js';
import { EXIT, type CliIo, emit } from '../io.js';
import type { Parsed } from '../options.js';

/** `doctor` : détecte les époques corrompues (non reprises, trous, effets sans event, présences incomplètes…). */
export async function doctor(args: Parsed, io: CliIo): Promise<number> {
  const ctx = await openContext(args, io);
  try {
    await preplay(ctx, args);
    const report = await auditSeason(ctx.storage, ctx.worldId, ctx.seasonNumber);
    const lines = report.ok
      ? [`Saison ${String(ctx.seasonNumber)} : aucune anomalie (${String(report.epochs)} époque(s) vérifiée(s)).`]
      : [
          `Saison ${String(ctx.seasonNumber)} : ${String(report.issues.length)} anomalie(s) sur ${String(report.epochs)} époque(s).`,
          ...report.issues.map((i) => `  - [${i.kind}] ${i.message}`),
        ];
    emit(io, args.json, report, lines);
    return report.ok ? EXIT.ok : EXIT.diff;
  } finally {
    await ctx.close();
  }
}

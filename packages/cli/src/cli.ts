/** Point d'entrée testable : `run(argv, io)` renvoie le code de sortie, sans jamais terminer le processus. */
import { DomainError } from '@ai-reality/engine';
import { doctor } from './commands/doctor.js';
import { inspect } from './commands/inspect.js';
import { replay } from './commands/replay.js';
import { runEpoch } from './commands/run-epoch.js';
import { type CliIo, CliError, EXIT } from './io.js';
import { parse } from './options.js';

const HELP = `ai-reality — outils de la simulation (rejeu, inspection, diagnostic)

Usage : ai-reality <commande> [options]

Commandes
  run-epoch --epoch <n>              joue (ou reprend) une époque
  replay                             rejoue la saison depuis le journal et la compare aux projections
  inspect character <slug>           stats, relations sortantes et connaissances (option --epoch <n>)
  inspect scene <id>                 présences, interactions et répliques d'une scène
  inspect provenance <perso> <fait>  chaîne de provenance d'une connaissance
  inspect epoch <n>                  résumé d'une époque et événements importants
  doctor                             détecte les époques corrompues

Options
  --world <slug|id>   monde (obligatoire s'il y en a plusieurs en base)
  --season <n>        saison (défaut 1)
  --db <url>          base Postgres (défaut : variable DATABASE_URL)
  --memory            monde des Palmiers en mémoire ; replay, inspect et doctor y pré-jouent --epochs <n> époques (défaut 1)
  --seed <graine>     graine du monde en mémoire
  --policy <p>        utility (défaut) ou random
  --json              sortie JSON
  -h, --help          cette aide

Codes de sortie : 0 succès, 1 écart ou anomalie détectés, 2 erreur d'usage ou d'exécution.
`;

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const args = parse(argv);
    if (args.help || args.command === undefined || args.command === 'help') {
      io.out(HELP);
      return args.command === undefined && !args.help ? EXIT.error : EXIT.ok;
    }
    switch (args.command) {
      case 'run-epoch':
        return await runEpoch(args, io);
      case 'replay':
        return await replay(args, io);
      case 'inspect':
        return await inspect(args, io);
      case 'doctor':
        return await doctor(args, io);
      default:
        throw new CliError(`Commande inconnue : « ${args.command} ». Voir --help.`);
    }
  } catch (error) {
    io.err(
      `Erreur : ${error instanceof DomainError ? `${error.code} — ${error.message}` : error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT.error;
  }
}

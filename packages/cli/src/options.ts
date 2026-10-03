/** Options de la ligne de commande (`node:util` `parseArgs`, aucune dépendance). */
import { parseArgs } from 'node:util';
import { CliError } from './io.js';

const OPTIONS = {
  json: { type: 'boolean' },
  db: { type: 'string' },
  memory: { type: 'boolean' },
  world: { type: 'string' },
  season: { type: 'string' },
  epoch: { type: 'string' },
  epochs: { type: 'string' },
  seed: { type: 'string' },
  policy: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

export interface Parsed {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly json: boolean;
  readonly memory: boolean;
  readonly help: boolean;
  readonly db: string | undefined;
  readonly world: string | undefined;
  readonly season: number;
  /** `--epoch` : numéro d'époque, `undefined` si absent. */
  readonly epoch: number | undefined;
  /** `--epochs` : nombre d'époques à pré-jouer en mémoire (défaut 1). */
  readonly epochs: number;
  readonly seed: string | undefined;
  readonly policy: 'utility' | 'random';
}

function integer(raw: string | undefined, name: string, min: number): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new CliError(`--${name} attend un entier ≥ ${String(min)} (reçu « ${raw} »).`);
  }
  return value;
}

export function parse(argv: readonly string[]): Parsed {
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  const policy = values.policy ?? 'utility';
  if (policy !== 'utility' && policy !== 'random') {
    throw new CliError(`--policy attend « utility » ou « random » (reçu « ${policy} »).`);
  }
  const [command, ...rest] = positionals;
  return {
    command,
    positionals: rest,
    json: values.json ?? false,
    memory: values.memory ?? false,
    help: values.help ?? false,
    db: values.db,
    world: values.world,
    season: integer(values.season, 'season', 1) ?? 1,
    epoch: integer(values.epoch, 'epoch', 0),
    epochs: integer(values.epochs, 'epochs', 1) ?? 1,
    seed: values.seed,
    policy,
  };
}

import { type CliIo, run } from '../src/index.js';

export interface Captured {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** Appelle la CLI en capturant ses sorties (aucun sous-processus). */
export async function cli(argv: readonly string[], env: Record<string, string | undefined> = {}): Promise<Captured> {
  let out = '';
  let err = '';
  const io: CliIo = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    env,
  };
  const code = await run(argv, io);
  return { code, out, err };
}

/** Appelle la CLI avec `--json` et décode la sortie. */
export async function cliJson<T = Record<string, unknown>>(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): Promise<{ code: number; data: T }> {
  const { code, out, err } = await cli([...argv, '--json'], env);
  if (out === '') throw new Error(`sortie vide (code ${String(code)}) : ${err}`);
  return { code, data: JSON.parse(out) as T };
}

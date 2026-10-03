/** Entrées/sorties injectées dans la CLI : les tests appellent `run(argv, io)` sans sous-processus. */
export interface CliIo {
  /** Sortie standard (un texte, retour à la ligne final compris). */
  out(text: string): void;
  /** Sortie d'erreur. */
  err(text: string): void;
  /** Variables d'environnement lues par la CLI (`DATABASE_URL`). */
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** Codes de sortie : 0 tout va bien, 1 le rejeu ou l'audit a trouvé un écart, 2 erreur d'usage ou d'exécution. */
export const EXIT = { ok: 0, diff: 1, error: 2 } as const;

/** Erreur d'usage ou d'exécution attendue : le message est affiché tel quel, sans pile. */
export class CliError extends Error {}

/** Affiche soit le JSON (`--json`), soit les lignes de texte. */
export function emit(io: CliIo, json: boolean, payload: unknown, lines: readonly string[]): void {
  io.out(json ? `${JSON.stringify(payload, null, 2)}\n` : `${lines.join('\n')}\n`);
}

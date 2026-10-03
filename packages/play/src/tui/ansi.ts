/** Styles ANSI minimaux (pas de dépendance). Désactivés par `NO_COLOR` ou hors terminal. */
export interface Style {
  readonly enabled: boolean;
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  blue(s: string): string;
  magenta(s: string): string;
  cyan(s: string): string;
}

const wrap =
  (enabled: boolean, open: number, close: number) =>
  (s: string): string =>
    enabled ? `\u001b[${String(open)}m${s}\u001b[${String(close)}m` : s;

export function createStyle(enabled: boolean): Style {
  return {
    enabled,
    bold: wrap(enabled, 1, 22),
    dim: wrap(enabled, 2, 22),
    red: wrap(enabled, 31, 39),
    green: wrap(enabled, 32, 39),
    yellow: wrap(enabled, 33, 39),
    blue: wrap(enabled, 34, 39),
    magenta: wrap(enabled, 35, 39),
    cyan: wrap(enabled, 36, 39),
  };
}

/** `NO_COLOR` (même vide, selon la convention no-color.org quand non vide) coupe tout ; `FORCE_COLOR` active hors terminal. */
export function colorEnabled(env: Readonly<Record<string, string | undefined>>, isTTY: boolean): boolean {
  if ((env['NO_COLOR'] ?? '') !== '') return false;
  if ((env['FORCE_COLOR'] ?? '') !== '' && env['FORCE_COLOR'] !== '0') return true;
  return isTTY;
}

export const CLEAR_SCREEN = '\u001b[2J\u001b[H';

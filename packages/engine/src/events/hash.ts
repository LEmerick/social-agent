/** Hachages stables (JSON canonique à clés triées + sha256) pour comparer des états et des journaux. */
import { createHash } from 'node:crypto';
import type { EventRecord } from '../state/journal.js';
import type { SimState } from '../state/types.js';

/** JSON canonique : clés d'objet triées récursivement, `undefined` omis, `-0` normalisé. */
export function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, normalize(x)]),
      );
    }
    return typeof v === 'number' && Object.is(v, -0) ? 0 : v;
  };
  return JSON.stringify(normalize(value));
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export const stateHash = (state: Readonly<SimState>): string => sha256(canonicalJson(state));

/** Hachage d'un journal d'events, dans l'ordre fourni (l'ordre fait partie de l'identité du journal). */
export const journalHash = (events: readonly EventRecord[]): string => sha256(canonicalJson(events));

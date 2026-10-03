/** Hachages stables (JSON canonique à clés triées + sha256) pour comparer des états et des journaux. */
import { createHash } from 'node:crypto';
import { canonicalJson } from '../core/canonical-json.js';
import type { EventRecord } from '../state/journal.js';
import type { SimState } from '../state/types.js';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export const stateHash = (state: Readonly<SimState>): string => sha256(canonicalJson(state));

/** Hachage d'un journal d'events, dans l'ordre fourni (l'ordre fait partie de l'identité du journal). */
export const journalHash = (events: readonly EventRecord[]): string => sha256(canonicalJson(events));

/** Rendu français d'un fait pour les prompts : prédicats connus traduits, repli lisible pour les autres. */
import type { Id, SimState } from '../state/types.js';

export interface RenderableFact {
  readonly subjectId: Id | null;
  readonly predicate: string;
  readonly objectId: Id | null;
  readonly objectText: string | null;
}

type Phrase = (subject: string | null, object: string | null) => string;

const clean = (s: string | null): string | null => (s === null || s.trim() === '' ? null : s.trim());
const join = (...parts: (string | null)[]): string => parts.filter((p): p is string => p !== null).join(' ');

/** Phrases des prédicats produits par le moteur, les formats et les fixtures. L'objet est déjà résolu (prénom ou texte). */
const PHRASES: Readonly<Record<string, Phrase>> = {
  hides: (s, o) => join(s ?? 'Quelqu’un', 'cache', o ? `un secret : « ${o} »` : 'un secret'),
  proposed_alliance_to: (s, o) => join(s ?? 'Quelqu’un', 'a proposé une alliance à', o ?? 'quelqu’un'),
  allied_with: (s, o) => join(s ?? 'Quelqu’un', 'est allié(e) avec', o ?? 'quelqu’un'),
  criticized: (s, o) => join(s ?? 'Quelqu’un', 'a critiqué', o ?? 'quelqu’un'),
  holds: (s, o) => join(s ?? 'Quelqu’un', 'détient', o ?? 'un objet'),
  item_at: (_s, o) => join('Un objet se trouve', o ?? 'quelque part'),
  mission: (s) => join(s ?? 'Quelqu’un', 'a reçu une mission'),
  scheduled: () => 'Un événement est programmé',
};

/** `snake_case` ou `camelCase` → mots séparés par des espaces (repli pour un prédicat inconnu). */
const humanize = (predicate: string): string =>
  predicate
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();

/** Les références techniques posées en `objectText` (`item:…`, `item_def:…`, `item:…@lieu`) deviennent un texte lisible. */
function readableObject(state: Readonly<SimState>, text: string | null): string | null {
  const t = clean(text);
  if (t === null) return null;
  const at = /^item:[^@]+@(.+)$/.exec(t);
  if (at) return `à ${state.locations[at[1] as Id]?.name ?? 'un lieu inconnu'}`;
  if (t.startsWith('item_def:')) return `un objet (${humanize(t.slice('item_def:'.length))})`;
  if (t.startsWith('item:')) return 'un objet';
  return t;
}

/**
 * Phrase lisible d'un fait. Les prédicats connus ont une tournure française ; un prédicat déjà rédigé en clair
 * (contenant un espace) est gardé tel quel ; sinon il est « humanisé » (`foo_bar` → `foo bar`).
 */
export function renderFactText(state: Readonly<SimState>, fact: RenderableFact): string {
  const subject = fact.subjectId === null ? null : (state.characters[fact.subjectId]?.firstName ?? null);
  const objectName = fact.objectId === null ? null : (state.characters[fact.objectId]?.firstName ?? null);
  const object = objectName ?? readableObject(state, fact.objectText);
  const known = PHRASES[fact.predicate];
  if (known) return known(subject, object);
  const predicate = fact.predicate.includes(' ') ? fact.predicate : humanize(fact.predicate);
  return join(subject, predicate, object);
}

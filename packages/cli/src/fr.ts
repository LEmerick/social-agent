/** Vocabulaire français de la CLI : uniquement de la mise en mots. */
import type { CharacterNode, Id } from '@ai-reality/engine';

export const STATUS_FR: Readonly<Record<string, string>> = {
  active: 'actif',
  restricted: 'restreint',
  elimination_pending: 'élimination en attente',
  eliminated: 'éliminé',
  paused: 'en pause',
};

export const EPOCH_STATUS_FR: Readonly<Record<string, string>> = {
  pending: 'en attente',
  running: 'en cours',
  completed: 'terminée',
  failed: 'en échec',
};

export const AXIS_FR: Readonly<Record<string, string>> = {
  trust: 'confiance',
  affection: 'affection',
  rivalry: 'rivalité',
  respect: 'respect',
  fear: 'peur',
  attraction: 'attirance',
  alliance: 'alliance',
};

export const STAT_FR: Readonly<Record<string, string>> = {
  energy: 'énergie',
  morale: 'moral',
  popularity: 'popularité',
  influence: 'influence',
  reputation: 'réputation',
};

export const SCORE_FR: Readonly<Record<string, string>> = {
  social: 'social',
  drama: 'drame',
  popularity: 'popularité',
  survival: 'survie',
  influence: 'influence',
};

export const ACQUAINTANCE_FR: Readonly<Record<string, string>> = {
  known_of: 'connu de réputation',
  met: 'rencontré',
  acquainted: 'connaissance',
  close: 'proche',
};

export const BELIEF_FR: Readonly<Record<string, string>> = {
  believes: 'croit',
  doubts: 'doute',
  disbelieves: 'ne croit pas',
};

export const ROLE_FR: Readonly<Record<string, string>> = {
  actor: 'acteur',
  target: 'cible',
  witness: 'témoin',
  subject: 'sujet',
  participant: 'participant',
  observer: 'observateur',
  hidden: 'caché',
  speaker: 'locuteur',
  addressee: 'destinataire',
  bystander: 'présent',
  eavesdropper: 'indiscret',
};

/** Nombre à un chiffre après la virgule au plus, à la française. */
export const num = (value: number): string => String(Math.round(value * 100) / 100).replace('.', ',');

/** `{ clé: valeur }` → `libellé valeur, libellé valeur` (clés triées, libellés traduits si connus). */
export const pairs = (values: Readonly<Record<string, number>>, labels: Readonly<Record<string, string>>): string =>
  Object.keys(values)
    .sort()
    .map((k) => `${labels[k] ?? k} ${num(values[k] ?? 0)}`)
    .join(', ');

export type Names = ReadonlyMap<Id, string>;

export const namesOf = (characters: Readonly<Record<Id, CharacterNode>>): Names =>
  new Map(Object.values(characters).map((c) => [c.id, c.firstName]));

export const nameOf = (names: Names, id: Id | null): string => (id === null ? '—' : (names.get(id) ?? id.slice(0, 8)));

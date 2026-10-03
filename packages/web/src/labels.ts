export const STAT_LABELS: Readonly<Record<string, string>> = {
  energy: 'Énergie',
  morale: 'Moral',
  popularity: 'Popularité',
  influence: 'Influence',
  reputation: 'Réputation',
};

export const AXIS_LABELS: Readonly<Record<string, string>> = {
  trust: 'Confiance',
  affection: 'Affection',
  alliance: 'Alliance',
  respect: 'Respect',
  rivalry: 'Rivalité',
  fear: 'Crainte',
  attraction: 'Attirance',
};

/** Axes montrés dans les barres, avec leur plage. L'affection va de -100 à 100. */
export const AXES: readonly { key: string; min: number; max: number; tone: 'good' | 'bad' | 'neutral' }[] = [
  { key: 'trust', min: 0, max: 100, tone: 'good' },
  { key: 'affection', min: -100, max: 100, tone: 'good' },
  { key: 'alliance', min: 0, max: 100, tone: 'good' },
  { key: 'respect', min: 0, max: 100, tone: 'neutral' },
  { key: 'rivalry', min: 0, max: 100, tone: 'bad' },
  { key: 'fear', min: 0, max: 100, tone: 'bad' },
  { key: 'attraction', min: 0, max: 100, tone: 'neutral' },
];

export const STATUS_LABELS: Readonly<Record<string, string>> = {
  active: 'en jeu',
  restricted: 'restreint (crédits bas)',
  elimination_pending: 'menacé d’élimination',
  eliminated: 'éliminé',
  paused: 'en pause',
};

export const KIND_LABELS: Readonly<Record<string, string>> = {
  heard: 'Entendu',
  acted: 'Toi',
  seen: 'Vu',
  arrived: 'Arrivée',
  left: 'Départ',
  learned: 'Appris',
  relation: 'Relation',
  credits: 'Crédits',
  status: 'Statut',
};

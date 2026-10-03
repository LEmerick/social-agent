/** Identifiants fixes et lisibles : le dernier bloc encode la famille (10 = lieux, 30 = personnages…) et le rang. */
export const fixedId = (family: number, rank = 0): string =>
  `01960000-0000-7000-8000-${(family * 256 + rank).toString(16).padStart(12, '0')}`;

export const IDS = {
  world: fixedId(0, 1),
  otherWorld: fixedId(0, 9),
  season: fixedId(0, 2),
  epoch: fixedId(0, 3),
  locations: {
    cuisine: fixedId(0x10, 1),
    jardin: fixedId(0x10, 2),
    salon: fixedId(0x10, 3),
    chambres: fixedId(0x10, 4),
    confessionnal: fixedId(0x10, 5),
  },
  zones: {
    banc: fixedId(0x20, 1),
    piscine: fixedId(0x20, 2),
  },
  characters: {
    alexandre: fixedId(0x30, 1),
    sarah: fixedId(0x30, 2),
    lea: fixedId(0x30, 3),
    thomas: fixedId(0x30, 4),
  },
  goals: {
    alexandreMain: fixedId(0x40, 1),
    sarahPrivate: fixedId(0x40, 2),
    thomasRival: fixedId(0x40, 3),
  },
  facts: {
    sarahSecret: fixedId(0x50, 1),
  },
  knowledge: {
    sarahSecret: fixedId(0x60, 1),
  },
} as const;

/** Outils des tests du modèle de décision (M9) : états Palmiers, options, χ². */
import { type ActionOption, type RelationshipEdge, type SimState, availableOptions, edge } from '@ai-reality/engine';
import { IDS, aSimState } from '@ai-reality/testkit';

export const A = IDS.characters.alexandre;
export const S = IDS.characters.sarah;
export const L = IDS.characters.lea;
export const T = IDS.characters.thomas;

export const opt = (
  action: string,
  targetId: string | null = null,
  over: Partial<ActionOption> = {},
): ActionOption => ({
  action,
  targetId,
  factId: null,
  itemId: null,
  locationId: null,
  ...over,
});

/** Palmiers au salon : les quatre personnages dans la même scène. */
export function palmiersAtSalon(mutate?: (s: SimState) => void): SimState {
  return aSimState((s) => {
    for (const id of Object.keys(s.characters)) {
      s.positions[id] = { kind: 'at', locationId: IDS.locations.salon, zoneId: null };
    }
    s.epoch = { id: 'epoch-test', number: 0 };
    mutate?.(s);
  });
}

export const sceneOf = (state: SimState) => ({
  members: Object.keys(state.characters)
    .sort()
    .map((characterId) => ({ characterId, locationId: IDS.locations.salon, zoneId: null })),
});

export const optionsOf = (state: SimState, actorId: string): ActionOption[] =>
  availableOptions(state, actorId, sceneOf(state));

/** Fixe des champs de l'arête `from → to` (créée avec les valeurs par défaut si elle n'existe pas). */
export function setEdge(state: SimState, from: string, to: string, patch: Partial<RelationshipEdge>): void {
  Object.assign(edge(state, from, to), patch);
}

/** Statistique du χ² de Pearson et sa p-valeur (approximation de Wilson-Hilferty, suffisante pour p > 0,01). */
export function chiSquare(
  observed: readonly number[],
  expected: readonly number[],
): { chi2: number; df: number; p: number } {
  let chi2 = 0;
  let df = -1;
  observed.forEach((o, i) => {
    const e = expected[i] ?? 0;
    if (e <= 0) return;
    chi2 += (o - e) ** 2 / e;
    df += 1;
  });
  df = Math.max(df, 1);
  // Wilson-Hilferty : (χ²/df)^(1/3) ~ N(1 − 2/(9df), 2/(9df)).
  const zScore = ((chi2 / df) ** (1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return { chi2, df, p: 1 - normalCdf(zScore) };
}

function normalCdf(x: number): number {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return 0.5 * (1 + (x >= 0 ? erf : -erf));
}

/** Valeur présente ou échec explicite du test (évite les assertions non nulles). */
export function must<T>(value: T | undefined | null, what = 'valeur'): T {
  if (value === undefined || value === null) throw new Error(`${what} absente`);
  return value;
}

/** Le personnage `id` du `SimState` (ou échec du test). */
export const character = (state: SimState, id: string) => must(state.characters[id], `personnage ${id}`);

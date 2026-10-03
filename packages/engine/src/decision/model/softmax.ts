/**
 * Softmax à température et tirage dans une distribution (decision-model.md §3).
 * Fonctions pures : le hasard vient du `Rng` fourni par l'appelant.
 */

/** En dessous de cette température, le choix est le maximum (à égalité, partage équitable entre les ex æquo). */
export const MIN_TEMPERATURE = 1e-6;

/**
 * `p_i = exp((v_i − max) / T) / Σ`. Somme égale à 1 ; une valeur `-Infinity` (option interdite) a une probabilité nulle.
 * `T → 0` ⇒ tout le poids sur le maximum. Si toutes les valeurs sont `-Infinity`, la distribution est uniforme.
 */
export function softmax(values: readonly number[], temperature: number): number[] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  if (max === -Infinity) return values.map(() => 1 / values.length);
  if (!(temperature > MIN_TEMPERATURE)) {
    const winners = values.filter((v) => v === max).length;
    return values.map((v) => (v === max ? 1 / winners : 0));
  }
  const exps = values.map((v) => Math.exp((v - max) / temperature));
  const total = exps.reduce((s, e) => s + e, 0);
  return exps.map((e) => e / total);
}

/** Indice tiré pour `draw` ∈ [0, 1) dans la distribution `probs` (cumul ; les probabilités nulles ne sont jamais tirées). */
export function sampleIndex(probs: readonly number[], draw: number): number {
  let cumulative = 0;
  let lastPositive = -1;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i] ?? 0;
    if (p <= 0) continue;
    lastPositive = i;
    cumulative += p;
    if (draw < cumulative) return i;
  }
  return Math.max(lastPositive, 0);
}

/** Tire une issue dans `{ issue: p }` (ordre des clés = ordre du catalogue). */
export function sampleOutcome(distribution: Readonly<Record<string, number>>, draw: number): string {
  const keys = Object.keys(distribution);
  const at = sampleIndex(
    keys.map((k) => distribution[k] ?? 0),
    draw,
  );
  const picked = keys[at];
  if (picked === undefined) throw new RangeError('sampleOutcome : distribution vide');
  return picked;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export interface TemperatureConfig {
  /** Température d'un personnage parfaitement posé (impulsivité 0). Défaut 0,15. */
  readonly min?: number;
  /** Température d'un personnage parfaitement impulsif (impulsivité 100). Défaut 1,0. */
  readonly max?: number;
  /** Impose la température (tests, mode déterministe) : `0` ⇒ maximum. */
  readonly fixed?: number;
}

/** Température linéaire en la réactivité (`decisionWeights.reactivity` = impulsivité / 100). */
export function temperatureOf(reactivity: number, config: TemperatureConfig = {}): number {
  if (config.fixed !== undefined) return config.fixed;
  const lo = config.min ?? 0.15;
  const hi = config.max ?? 1;
  return lo + (hi - lo) * clamp01(reactivity);
}

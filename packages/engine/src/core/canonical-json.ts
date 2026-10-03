/**
 * JSON canonique : clés d'objet triées, `undefined` retiré des objets (et remplacé par `null` dans les tableaux),
 * `-0` normalisé en `0`. Deux valeurs égales en contenu donnent la même chaîne : base des hash
 * (journal, état, prompt LLM).
 */
export function canonicalJson(value: unknown, indent?: number): string {
  return JSON.stringify(normalize(value), null, indent);
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : normalize(v)));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = normalize(v);
    }
    return out;
  }
  return typeof value === 'number' && Object.is(value, -0) ? 0 : value;
}

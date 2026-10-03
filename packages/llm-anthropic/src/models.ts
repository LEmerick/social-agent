import type { LlmTier } from '@ai-reality/engine/llm';

export interface ModelMap {
  readonly dialogue: string;
  readonly fast: string;
}

/** Identifiants vérifiés avec le skill claude-api (tableau « Current Models », 2026-09-25). */
export const DEFAULT_MODELS: ModelMap = {
  dialogue: 'claude-sonnet-5-5',
  fast: 'claude-haiku-4-5',
};

export const modelFor = (models: ModelMap, tier: LlmTier): string => models[tier];

/**
 * `output_config.effort` : accepté par la famille Sonnet 5 / Opus 5 / Fable et Opus 4.5+ ; Haiku 4.5 et Sonnet 4.5
 * renvoient une erreur 400 (skill claude-api, « Thinking & Effort ») : on l'omet pour eux.
 */
export function acceptsEffort(model: string): boolean {
  return /^claude-(sonnet-(5|4-6)|opus-(5|4-[5-8])|fable|mythos)/.test(model);
}

/**
 * Les modèles récents refusent (HTTP 400) une température non par défaut : on l'omet pour eux.
 * Haiku 4.5 et les anciennes générations l'acceptent.
 */
export function acceptsTemperature(model: string): boolean {
  return !/^claude-(sonnet-5|opus-5|opus-4-[78]|fable|mythos)/.test(model);
}

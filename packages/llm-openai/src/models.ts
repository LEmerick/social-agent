import type { LlmTier } from '@ai-reality/engine/llm';

export interface ModelMap {
  readonly dialogue: string;
  readonly fast: string;
}

/** Identifiants relevés dans la documentation OpenAI (page « Models », 2026-10-03). */
export const DEFAULT_MODELS: ModelMap = {
  dialogue: 'gpt-6.1-sol',
  fast: 'gpt-6-luna',
};

export const modelFor = (models: ModelMap, tier: LlmTier): string => models[tier];

/** Modèles de raisonnement (famille o, GPT-5 et suivants) : `reasoning.effort` accepté. */
const REASONING = /^(o\d|gpt-[5-9])/;

export function acceptsEffort(model: string): boolean {
  return REASONING.test(model);
}

/** Les modèles de raisonnement refusent (HTTP 400) une température personnalisée : on l'omet pour eux. */
export function acceptsTemperature(model: string): boolean {
  return !REASONING.test(model);
}

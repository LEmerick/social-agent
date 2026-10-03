import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '../core/canonical-json.js';
import type { LlmRequest } from './port.js';

export { canonicalJson };

/** Schéma JSON d'un schéma Zod (côté sortie), sans la balise `$schema`. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const json = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete json.$schema;
  return json;
}

/** Tout ce qui détermine la réponse : c'est aussi la « requête » stockée dans `llm_call` et dans les cassettes. */
export interface PromptFingerprint {
  readonly tier: string;
  readonly system: { readonly stable: string; readonly variable: string | null };
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly schema: Record<string, unknown> | null;
  readonly temperature: number | null;
  readonly maxTokens: number | null;
  /** Absent quand aucun effort n'est demandé : les empreintes antérieures à ce champ restent valides. */
  readonly effort?: string;
}

export function promptFingerprint(req: LlmRequest): PromptFingerprint {
  return {
    tier: req.tier,
    system: { stable: req.system.stable, variable: req.system.variable ?? null },
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    schema: req.output ? jsonSchemaOf(req.output) : null,
    temperature: req.temperature ?? null,
    maxTokens: req.maxTokens ?? null,
    ...(req.effort === undefined ? {} : { effort: req.effort }),
  };
}

/** sha256 hexadécimal du JSON canonique du `PromptFingerprint`. Stable entre exécutions. */
export function promptHash(req: LlmRequest): string {
  return hashFingerprint(promptFingerprint(req));
}

export function hashFingerprint(fingerprint: PromptFingerprint): string {
  return createHash('sha256').update(canonicalJson(fingerprint)).digest('hex');
}

/** UUID (forme v8) dérivé de façon déterministe : utile aux doubles de test pour un rejeu identique. */
export function deriveUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  const variant = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

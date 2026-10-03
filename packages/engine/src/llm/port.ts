import type { z } from 'zod';
import { DomainError } from '../core/errors.js';

/** Raison d'être d'un appel : sert à la traçabilité (`llm_call.purpose`) et au routage dans les doubles de test. */
export type LlmPurpose =
  'plan' | 'speak' | 'evaluate' | 'reflect' | 'verify' | 'compile_directive' | 'interview' | 'write';

export const LLM_PURPOSES: readonly LlmPurpose[] = [
  'plan',
  'speak',
  'evaluate',
  'reflect',
  'verify',
  'compile_directive',
  'interview',
  'write',
];

/** `dialogue` = modèle capable (scènes à enjeu) ; `fast` = modèle rapide (évaluateur, small talk). */
export type LlmTier = 'dialogue' | 'fast';

export type LlmEffort = 'low' | 'medium' | 'high';

export interface LlmMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/**
 * Le système est coupé en deux : `stable` (persona, règles du monde) est identique d'un appel à l'autre
 * et peut être mis en cache par le fournisseur ; `variable` change à chaque appel et reste hors du cache.
 */
export interface LlmSystem {
  readonly stable: string;
  readonly variable?: string | undefined;
}

export interface LlmRequest<T = unknown> {
  readonly purpose: LlmPurpose;
  readonly tier: LlmTier;
  readonly system: LlmSystem;
  readonly messages: readonly LlmMessage[];
  /** Si présent : la réponse doit être un JSON conforme à ce schéma ; `LlmResult.data` est alors renseigné. */
  readonly output?: z.ZodType<T> | undefined;
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
  /** Effort de raisonnement demandé au fournisseur (ignoré s'il ne le supporte pas). Participe au hash de prompt. */
  readonly effort?: LlmEffort | undefined;
  /** Traçabilité uniquement : ne participe pas au hash de prompt. */
  readonly characterId?: string | undefined;
  readonly epochId?: string | undefined;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Jetons d'entrée lus depuis le cache de prompt. */
  readonly cachedTokens: number;
}

export interface LlmResult<T = unknown> {
  readonly text: string;
  readonly data?: T;
  readonly llmCallId: string;
  readonly model: string;
  readonly usage: LlmUsage;
  readonly latencyMs: number;
}

export interface LLMPort {
  complete<T = unknown>(req: LlmRequest<T>): Promise<LlmResult<T>>;
}

export type LlmErrorCode = 'LLM_INVALID_OUTPUT' | 'LLM_UNAVAILABLE' | 'LLM_CASSETTE_MISSING';

/** JSON invalide ou non conforme au schéma. `rawText` garde la réponse brute pour le débogage et la relance. */
export class LlmInvalidOutputError extends DomainError {
  readonly rawText: string;

  constructor(message: string, rawText: string) {
    super('LLM_INVALID_OUTPUT', message);
    this.name = 'LlmInvalidOutputError';
    this.rawText = rawText;
  }
}

export const llmUnavailable = (message: string): DomainError => new DomainError('LLM_UNAVAILABLE', message);

export const llmCassetteMissing = (promptHash: string, detail = ''): DomainError =>
  new DomainError('LLM_CASSETTE_MISSING', `Cassette absente pour le prompt ${promptHash}${detail}`);

import type { z } from 'zod';
import { type LLMPort, type LlmRequest, type LlmResult, LlmInvalidOutputError } from './port.js';

const FENCE = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i;

/**
 * Extrait un JSON du texte brut (barrières ```json tolérées) et le valide.
 * Lève `LLM_INVALID_OUTPUT` avec le texte brut si le JSON est invalide ou non conforme.
 */
export function parseStructuredOutput<T>(text: string, schema: z.ZodType<T>): T {
  const body = FENCE.exec(text)?.[1] ?? text;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (cause) {
    throw new LlmInvalidOutputError(`Sortie LLM : JSON invalide (${(cause as Error).message})`, text);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`).join(' ; ');
    throw new LlmInvalidOutputError(`Sortie LLM non conforme au schéma — ${issues}`, text);
  }
  return parsed.data;
}

export interface StructuredOptions {
  /** Nombre maximal d'essais, premier appel compris (au moins 1). */
  readonly retries: number;
}

const MAX_ECHO = 2_000;

/**
 * Appelle le LLM et relance tant que la sortie est invalide, dans la limite de `retries` essais.
 * Chaque relance ajoute la réponse fautive et la raison de l'échec à la conversation : la requête change donc
 * (donc son hash), ce qui permet d'enregistrer et de rejouer chaque essai séparément.
 * Seule `LLM_INVALID_OUTPUT` déclenche une relance ; les autres erreurs remontent telles quelles.
 */
export async function completeStructured<T>(
  llm: LLMPort,
  req: LlmRequest<T>,
  { retries }: StructuredOptions,
): Promise<LlmResult<T>> {
  const attempts = Math.max(1, Math.floor(retries));
  let current = req;
  for (let attempt = 1; ; attempt++) {
    try {
      return await llm.complete(current);
    } catch (error) {
      if (!(error instanceof LlmInvalidOutputError) || attempt >= attempts) throw error;
      current = {
        ...req,
        messages: [
          ...req.messages,
          { role: 'assistant', content: error.rawText.slice(0, MAX_ECHO) },
          {
            role: 'user',
            content: `Ta réponse précédente est invalide (${error.message}). Réponds uniquement avec un JSON valide conforme au schéma demandé, sans texte autour.`,
          },
        ],
      };
    }
  }
}

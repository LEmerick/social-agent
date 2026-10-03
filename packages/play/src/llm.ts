/** Choix du LLM d'après l'environnement : OpenAI (ChatGPT) si `OPENAI_API_KEY`, sinon Anthropic, sinon aucun. */
import type { LLMPort } from '@ai-reality/engine';
import { anthropicLLM } from '@ai-reality/llm-anthropic';
import { openaiLLM } from '@ai-reality/llm-openai';

export function llmFromEnv(env: Readonly<Record<string, string | undefined>>): LLMPort | undefined {
  const openai = env['OPENAI_API_KEY'] ?? '';
  if (openai !== '') return openaiLLM({ apiKey: openai });
  const anthropic = env['ANTHROPIC_API_KEY'] ?? '';
  if (anthropic !== '') return anthropicLLM({ apiKey: anthropic });
  return undefined;
}

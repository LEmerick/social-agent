/**
 * Dialogue par LLM (action-catalog.md §4, étapes 3 et 4) : tours de parole alternés entre l'acteur et sa cible
 * (au plus `maxConversationTurns`, arrêt dès qu'un locuteur ne veut plus continuer), puis vérification (tier `fast`) :
 * le dialogue aboutit-il à l'issue déjà tirée ? Sinon régénération (2 au plus), puis repli sur un dialogue résumé.
 */
import { type AgentRuntime, createAgentRuntime } from '../agent/runtime.js';
import { buildAgentContext, type PreviousTurn } from '../agent/context.js';
import { EFFORT, MAX_TOKENS, outcomeLine } from '../agent/prompts.js';
import { VerifySchema } from '../agent/schemas.js';
import { situationOf } from '../agent/situation.js';
import { type LLMPort, type LlmTier, LlmInvalidOutputError, completeStructured } from '../llm/index.js';
import type { Id } from '../state/types.js';
import {
  type DialogueGenerator,
  type DialogueInput,
  type DialogueResult,
  type DialogueVerification,
  type UtteranceDraft,
  SummaryDialogue,
} from './dialogue.js';

export interface LlmDialogueDeps {
  readonly llm: LLMPort;
  readonly persona: (characterId: Id) => string;
  /** Défaut : un runtime construit avec `llm` et `persona`. */
  readonly runtime?: AgentRuntime;
  /** Nombre de régénérations après un échec de vérification (défaut 2, soit 3 générations au plus). */
  readonly maxRegenerations?: number;
  /** Modèle du vérificateur (défaut `fast`). */
  readonly verifierTier?: LlmTier;
  /** Dialogue de repli (défaut `SummaryDialogue`). */
  readonly fallback?: DialogueGenerator;
  readonly retries?: number;
}

const STABLE_VERIFIER = [
  'Tu es le vérificateur d’une télé-réalité fictive. On te donne l’action tentée, l’issue DÉJÀ décidée et la retranscription de l’échange.',
  'Dis si l’échange aboutit bien à cette issue : les répliques doivent y mener et ne pas la contredire (par exemple, un refus net ne vérifie pas une acceptation).',
  'Réponds uniquement par un JSON : {"coherent":true|false,"reason":"<une phrase>"}.',
].join('\n');

interface Generated {
  readonly utterances: UtteranceDraft[];
  readonly transcript: string;
  readonly ignoredReveals: string[];
}

export class LlmDialogue implements DialogueGenerator {
  readonly #deps: LlmDialogueDeps;
  readonly #runtime: AgentRuntime;

  constructor(deps: LlmDialogueDeps) {
    this.#deps = deps;
    this.#runtime =
      deps.runtime ??
      createAgentRuntime({ llm: deps.llm, persona: deps.persona, ...(deps.retries ? { retries: deps.retries } : {}) });
  }

  async generate(input: DialogueInput): Promise<DialogueResult> {
    const regenerations = this.#deps.maxRegenerations ?? 2;
    const reasons: string[] = [];
    const ignored: string[] = [];
    let feedback: string | null = null;

    for (let attempt = 1; attempt <= regenerations + 1; attempt++) {
      try {
        const generated = await this.#perform(input, feedback);
        ignored.push(...generated.ignoredReveals);
        const verdict = await this.#verify(input, generated.transcript);
        if (verdict.coherent) {
          return {
            mode: 'dialogue',
            utterances: generated.utterances,
            verification: verification(true, attempt, false, reasons, ignored),
          };
        }
        reasons.push(verdict.reason);
        feedback = verdict.reason;
      } catch (error) {
        // Une sortie inexploitable compte comme un essai raté ; les autres erreurs (réseau, cassette) remontent.
        if (!(error instanceof LlmInvalidOutputError)) throw error;
        reasons.push(error.message);
        feedback = null;
      }
    }

    const summary = await (this.#deps.fallback ?? new SummaryDialogue()).generate(input);
    return {
      ...summary,
      mode: 'summarized',
      verification: verification(false, regenerations + 1, true, reasons, ignored),
    };
  }

  async #perform(input: DialogueInput, feedback: string | null): Promise<Generated> {
    const { state, option, actorId, outcome } = input;
    const targetId = option.targetId;
    const max = targetId === null ? 1 : Math.max(1, state.world.config.maxConversationTurns);
    const nameOf = (id: Id): string => state.characters[id]?.firstName ?? id;

    const turns: PreviousTurn[] = [];
    const utterances: UtteranceDraft[] = [];
    const ignoredReveals: string[] = [];

    for (let index = 1; index <= max; index++) {
      const speakerId = index % 2 === 1 || targetId === null ? actorId : targetId;
      const otherId = speakerId === actorId ? targetId : actorId;
      const ctx = buildAgentContext(state, speakerId, situationOf(state, speakerId, turns));
      const spoken = await this.#runtime.speak(ctx, {
        action: option.action,
        outcome,
        turn: { index, max },
        addressee: otherId === null ? null : nameOf(otherId),
        role: speakerId === actorId ? 'initiator' : 'respondent',
        feedback,
        factText:
          speakerId === actorId && option.factId !== null
            ? (ctx.knowledge.find((k) => k.factId === option.factId)?.text ?? null)
            : null,
      });
      ignoredReveals.push(...spoken.ignoredReveals);
      turns.push({ speakerId, text: spoken.text });
      utterances.push({
        speakerId,
        addresseeIds: otherId === null ? [] : [otherId],
        text: spoken.text,
        intent: spoken.intent,
        tone: spoken.tone,
        emotion: spoken.emotion,
        volume: input.volume,
        revealedFactIds: spoken.reveals,
        llmCallId: spoken.llmCallId,
      });
      if (!spoken.wantsToContinue) break;
    }
    const transcript = turns.map((t) => `${nameOf(t.speakerId)} : ${t.text}`).join('\n');
    return { utterances, transcript, ignoredReveals };
  }

  async #verify(input: DialogueInput, transcript: string): Promise<{ coherent: boolean; reason: string }> {
    const { state, option, actorId, outcome } = input;
    const target = option.targetId === null ? null : (state.characters[option.targetId]?.firstName ?? null);
    const result = await completeStructured(
      this.#deps.llm,
      {
        purpose: 'verify',
        tier: this.#deps.verifierTier ?? 'fast',
        system: { stable: STABLE_VERIFIER },
        messages: [
          {
            role: 'user',
            content: [
              `Action : ${option.action} (initiateur : ${state.characters[actorId]?.firstName ?? actorId}${target ? `, cible : ${target}` : ''}).`,
              `Issue décidée : ${outcomeLine(outcome)}.`,
              'Échange :',
              transcript,
            ].join('\n'),
          },
        ],
        output: VerifySchema,
        maxTokens: MAX_TOKENS.verify,
        effort: EFFORT.verify,
      },
      { retries: this.#deps.retries ?? 2 },
    );
    return { coherent: result.data?.coherent === true, reason: result.data?.reason ?? '' };
  }
}

const verification = (
  verified: boolean,
  attempts: number,
  fallback: boolean,
  reasons: readonly string[],
  ignoredReveals: readonly string[],
): DialogueVerification => ({
  verified,
  attempts,
  fallback,
  reasons: [...reasons],
  ignoredReveals: [...ignoredReveals],
});

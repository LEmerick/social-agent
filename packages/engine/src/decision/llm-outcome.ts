/**
 * Juge d'issue par LLM (`llm@1`, action-catalog.md §4 étape 2) : décidé AVANT le dialogue, parmi les issues
 * autorisées par `actionDef(...).outcomes`. Une issue hors de cette liste est rejetée.
 */
import { buildAgentContext } from '../agent/context.js';
import { renderFactText } from '../knowledge/render.js';
import { EFFORT, MAX_TOKENS, agentRequest, outcomeLine } from '../agent/prompts.js';
import { OutcomeJudgeSchema } from '../agent/schemas.js';
import { situationOf } from '../agent/situation.js';
import { DomainError } from '../core/errors.js';
import { type LLMPort, type LlmTier, completeStructured } from '../llm/index.js';
import { assertInCatalog } from '../rules/catalog.js';
import type { Id, SimState } from '../state/types.js';
import type { ActionOption, OutcomeModel, OutcomeResult } from './ports.js';

export const LLM_OUTCOME_POLICY = 'llm@1';

export interface LlmOutcomeModelDeps {
  readonly llm: LLMPort;
  readonly persona: (characterId: Id) => string;
  readonly tier?: LlmTier;
  readonly retries?: number;
}

export class LlmOutcomeModel implements OutcomeModel {
  readonly #deps: LlmOutcomeModelDeps;

  constructor(deps: LlmOutcomeModelDeps) {
    this.#deps = deps;
  }

  /**
   * Le juge se place du côté de la cible (celle qui réagit) : son persona est le préfixe stable, son contexte le
   * bloc variable. Sans cible, c'est l'acteur lui-même.
   */
  async resolve(input: {
    readonly option: ActionOption;
    readonly actorId: Id;
    readonly state: Readonly<SimState>;
  }): Promise<OutcomeResult> {
    const { option, actorId, state } = input;
    const def = assertInCatalog(state, option.action);
    const judgedId = option.targetId ?? actorId;
    const ctx = buildAgentContext(state, judgedId, situationOf(state, judgedId));
    const actorName = state.characters[actorId]?.firstName ?? actorId;
    const fact = option.factId === null ? undefined : state.facts[option.factId];
    const factText = fact ? renderFactText(state, fact) : null;

    const task = [
      'Tu es le juge de la scène : décide de l’issue de cette interaction, avant que les personnages ne parlent.',
      `${actorName} tente : ${option.action}${option.targetId === null ? '' : ` envers ${ctx.identity.firstName}`}.`,
      factText ? `Fait concerné : ${factText}.` : null,
      `Issues possibles (de la plus favorable à l’initiateur à la moins favorable) :`,
      ...def.outcomes.map((o) => `- ${outcomeLine(o)}`),
      `Raisonne du point de vue de ${ctx.identity.firstName} : son caractère, ses relations et ce qu’il sait.`,
      'Réponds : {"outcome":"<une issue de la liste>","distribution":[{"outcome":"<issue>","p":0.0}],"reason":"<une phrase>"}.',
    ]
      .filter((l): l is string => l !== null)
      .join('\n');

    const result = await completeStructured(
      this.#deps.llm,
      {
        ...agentRequest({
          purpose: 'evaluate',
          tier: this.#deps.tier ?? 'dialogue',
          persona: this.#deps.persona(judgedId),
          ctx,
          task,
          maxTokens: MAX_TOKENS.judge,
          effort: EFFORT.judge,
        }),
        output: OutcomeJudgeSchema,
      },
      { retries: this.#deps.retries ?? 2 },
    );

    const allowed = def.outcomes as readonly string[];
    const outcome = (result.data?.outcome ?? '').trim();
    if (!allowed.includes(outcome)) {
      throw new DomainError(
        'UNKNOWN_OUTCOME',
        `${LLM_OUTCOME_POLICY} : issue « ${outcome} » non autorisée pour ${def.id} (${allowed.join(', ')})`,
      );
    }
    const weights: Record<string, number> = {};
    for (const d of result.data?.distribution ?? []) {
      if (allowed.includes(d.outcome)) weights[d.outcome] = (weights[d.outcome] ?? 0) + d.p;
    }
    const total = Object.values(weights).reduce((t, p) => t + p, 0);
    const distribution =
      total > 0 ? Object.fromEntries(Object.entries(weights).map(([o, p]) => [o, p / total])) : undefined;

    return {
      outcome,
      ...(distribution ? { distribution } : {}),
      rngDraw: null,
      policy: LLM_OUTCOME_POLICY,
      llmCallId: result.llmCallId,
    };
  }
}

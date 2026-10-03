/**
 * Politique de décision par LLM (`llm@1`, action-catalog.md §5) : le modèle choisit dans les options déjà filtrées
 * par le catalogue et les préconditions. Elles lui sont présentées numérotées ; la réponse est un numéro ou `none`.
 * Toute autre réponse (action hors catalogue, numéro hors liste) est rejetée. Le choix de destination n'utilise
 * pas le LLM : il est délégué à la politique déterministe fournie à la construction.
 */
import { buildAgentContext } from '../agent/context.js';
import { EFFORT, MAX_TOKENS, agentRequest } from '../agent/prompts.js';
import { ChoiceSchema } from '../agent/schemas.js';
import { situationOf } from '../agent/situation.js';
import { DomainError } from '../core/errors.js';
import { type LLMPort, type LlmTier, completeStructured } from '../llm/index.js';
import type { DirectiveBiases, Id, SimState } from '../state/types.js';
import { type ActionOption, type DecisionPolicy, type DecisionResult, optionKey } from './ports.js';

export const LLM_POLICY = 'llm@1';

export interface LlmDecisionPolicyDeps {
  readonly llm: LLMPort;
  readonly persona: (characterId: Id) => string;
  /** Politique de score déterministe qui répond à `chooseDestination` (sans LLM). */
  readonly destination: Pick<DecisionPolicy, 'chooseDestination'>;
  readonly tier?: LlmTier;
  readonly retries?: number;
}

const signed = (n: number): string => `${n > 0 ? '+' : ''}${String(n)}`;

function describeOption(state: Readonly<SimState>, factTexts: ReadonlyMap<Id, string>, o: ActionOption): string {
  const parts: string[] = [o.action];
  const target = o.targetId === null ? undefined : state.characters[o.targetId]?.firstName;
  const place = o.locationId === null ? undefined : state.locations[o.locationId]?.name;
  if (target) parts.push(`→ ${target}`);
  else if (place) parts.push(`→ ${place}`);
  if (o.factId !== null) parts.push(`(fait : ${factTexts.get(o.factId) ?? o.factId})`);
  return parts.join(' ');
}

function bonusOf(biases: DirectiveBiases | null, o: ActionOption): number {
  if (!biases) return 0;
  return (biases.actions[o.action] ?? 0) + (o.targetId === null ? 0 : (biases.targets[o.targetId] ?? 0));
}

function renderBiases(state: Readonly<SimState>, biases: DirectiveBiases): string {
  const lines = ['Consigne du joueur (les bonus orientent ton choix, sans effacer ton caractère) :'];
  const actions = Object.entries(biases.actions).map(([a, w]) => `${a} ${signed(w)}`);
  const targets = Object.entries(biases.targets).map(([t, w]) => `${state.characters[t]?.firstName ?? t} ${signed(w)}`);
  if (actions.length > 0) lines.push(`- Actions : ${actions.join(', ')}`);
  if (targets.length > 0) lines.push(`- Personnes : ${targets.join(', ')}`);
  if (biases.prefer.length > 0) lines.push(`- À privilégier : ${biases.prefer.join(', ')}`);
  if (biases.forbid.length > 0) lines.push(`- À éviter : ${biases.forbid.join(', ')}`);
  return lines.join('\n');
}

export class LlmDecisionPolicy implements DecisionPolicy {
  readonly #deps: LlmDecisionPolicyDeps;

  constructor(deps: LlmDecisionPolicyDeps) {
    this.#deps = deps;
  }

  chooseDestination(
    input: Parameters<DecisionPolicy['chooseDestination']>[0],
  ): ReturnType<DecisionPolicy['chooseDestination']> {
    return this.#deps.destination.chooseDestination(input);
  }

  async choose(input: Parameters<DecisionPolicy['choose']>[0]): Promise<DecisionResult> {
    const { actorId, state, options } = input;
    if (options.length === 0) return { chosen: null, rngDraw: null, policy: LLM_POLICY };

    const ctx = buildAgentContext(state, actorId, situationOf(state, actorId));
    const factTexts = new Map(ctx.knowledge.map((k) => [k.factId, k.text]));
    const biases = state.characters[actorId]?.directive ?? null;
    const lines = options.map((o, i) => {
      const bonus = bonusOf(biases, o);
      const hint = biases && bonus !== 0 ? ` [consigne ${signed(bonus)}]` : '';
      return `${String(i + 1)}. ${describeOption(state, factTexts, o)}${hint}`;
    });
    const task = [
      'Choisis ce que ton personnage fait maintenant, parmi ces options (et seulement celles-ci) :',
      ...lines,
      '0. none — ne rien faire',
      'Réponds : {"choice":"<numéro ou none>","distribution":[{"choice":"<numéro>","p":0.0}],"reason":"<une phrase>"}.',
      '`distribution` (facultative) donne tes probabilités par numéro ; `choice` est l’option retenue.',
    ].join('\n');

    const result = await completeStructured(
      this.#deps.llm,
      {
        ...agentRequest({
          purpose: 'evaluate',
          tier: this.#deps.tier ?? 'dialogue',
          persona: this.#deps.persona(actorId),
          ctx,
          extras: biases ? [renderBiases(state, biases)] : [],
          task,
          maxTokens: MAX_TOKENS.choose,
          effort: EFFORT.choose,
        }),
        output: ChoiceSchema,
      },
      { retries: this.#deps.retries ?? 2 },
    );

    const pick = (raw: string): { kind: 'none' } | { kind: 'option'; option: ActionOption } | { kind: 'invalid' } => {
      const text = raw.trim().toLowerCase().replace(/\.$/, '');
      if (text === 'none' || text === '0') return { kind: 'none' };
      const option = /^\d+$/.test(text) ? options[Number(text) - 1] : undefined;
      return option ? { kind: 'option', option } : { kind: 'invalid' };
    };

    const picked = pick(result.data?.choice ?? '');
    if (picked.kind === 'invalid') {
      throw new DomainError(
        'INVALID_CHOICE',
        `${LLM_POLICY} : réponse « ${result.data?.choice ?? ''} » hors des ${String(options.length)} options du catalogue`,
      );
    }

    const entries = (result.data?.distribution ?? []).flatMap((d) => {
      const p = pick(d.choice);
      return p.kind === 'option' ? [{ option: p.option, p: d.p }] : [];
    });
    const total = entries.reduce((t, e) => t + e.p, 0);
    const merged = new Map<string, { option: ActionOption; p: number }>();
    for (const e of entries) {
      const prev = merged.get(optionKey(e.option));
      merged.set(optionKey(e.option), { option: e.option, p: (prev?.p ?? 0) + e.p });
    }
    const distribution =
      total > 0 ? [...merged.values()].map((e) => ({ option: e.option, p: e.p / total })) : undefined;

    return {
      chosen: picked.kind === 'option' ? picked.option : null,
      ...(distribution ? { distribution } : {}),
      rngDraw: null,
      policy: LLM_POLICY,
      llmCallId: result.llmCallId,
    };
  }
}

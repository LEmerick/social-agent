/**
 * AgentRuntime (engine-architecture.md §7) : plan(), speak(), reflect(), interview().
 *
 * Le persona compilé est la partie stable (cachée) du système ; le contexte filtré de `renderAgentContext` est la
 * partie variable. Toute sortie passe par `completeStructured` : JSON invalide ⇒ nouvel essai, puis
 * `LLM_INVALID_OUTPUT`. Les identifiants cités par le modèle sont recoupés avec le contexte : un fait inconnu de
 * l'agent n'est jamais retenu (il est signalé à `onDiagnostic`).
 */
import type { LLMPort, LlmTier } from '../llm/index.js';
import { completeStructured } from '../llm/index.js';
import type { DirectiveBiases, Id, Intention } from '../state/types.js';
import type { AgentContext } from './context.js';
import { MAX_TOKENS, agentRequest, cleanId, nameIndex, normName, outcomeLine, splitKnown } from './prompts.js';
import {
  type InterviewOutput,
  type PlanOutput,
  type ReflectOutput,
  type SpeakOutput,
  InterviewSchema,
  PlanSchema,
  ReflectSchema,
  SpeakSchema,
} from './schemas.js';

/** Ce que le runtime écarte ou corrige, pour la journalisation (jamais pour décider). */
export interface AgentDiagnostic {
  readonly kind: 'ignored_reveal' | 'ignored_target' | 'ignored_fact' | 'ignored_location' | 'ignored_goal';
  readonly characterId: Id;
  readonly detail: string;
}

export interface AgentRuntimeDeps {
  readonly llm: LLMPort;
  /** Persona compilé du personnage (`compileAgentProfile(...).personaPrompt`). Identique d'un appel à l'autre. */
  readonly persona: (characterId: Id) => string;
  /** Essais par appel, premier compris (défaut 2 : un nouvel essai, puis erreur typée). */
  readonly retries?: number;
  readonly tier?: LlmTier;
  readonly onDiagnostic?: (diagnostic: AgentDiagnostic) => void;
}

export interface PlanInput {
  /** Souvenirs rappelés (texte à la première personne). */
  readonly memories?: readonly string[];
  /** Lieux du monde (nom → identifiant) pour les intentions `go_to`. */
  readonly locations?: readonly { readonly id: Id; readonly name: string }[];
  /** Noms de tous les personnages, pour résoudre les cibles non encore rencontrées. */
  readonly names?: Readonly<Record<Id, string>>;
  readonly directive?: DirectiveBiases | null;
}

export interface PlanResult {
  readonly intentions: Intention[];
  /** Éléments écartés (cible, lieu ou fait inconnus). */
  readonly ignored: string[];
  readonly llmCallId: Id;
}

export interface SpeakInput {
  readonly action: string;
  readonly outcome: string;
  readonly turn: { readonly index: number; readonly max: number };
  /** Prénom de l'interlocuteur (null pour une action sans cible). */
  readonly addressee?: string | null;
  /** `initiator` (défaut) ouvre l'échange ; `respondent` répond. */
  readonly role?: 'initiator' | 'respondent';
  /** Raison pour laquelle le dialogue précédent a été jugé incohérent (régénération). */
  readonly feedback?: string | null;
  /** Fait au cœur de l'action (`share_secret`…), tel que l'agent le connaît. */
  readonly factText?: string | null;
}

export interface SpeakResult {
  readonly text: string;
  readonly intent: string;
  readonly tone: string;
  readonly emotion: string;
  /** Faits révélés, restreints à ceux que l'agent connaît. */
  readonly reveals: Id[];
  /** Identifiants cités par le modèle mais inconnus de l'agent : ignorés. */
  readonly ignoredReveals: string[];
  readonly mentions: Id[];
  readonly wantsToContinue: boolean;
  readonly llmCallId: Id;
}

export interface ReflectDay {
  readonly epoch: number;
  /** Souvenirs marquants de la journée, à la première personne. */
  readonly highlights: readonly string[];
}

export interface ReflectResult {
  /** Croyances `inferred` sur des faits connus. */
  readonly beliefs: { factId: Id; belief: ReflectOutput['beliefs'][number]['belief']; confidence: number }[];
  /** `goalIndex` : rang dans les objectifs ouverts du contexte. */
  readonly goalUpdates: { goalIndex: number; status: 'achieved' | 'abandoned' }[];
  readonly ignored: string[];
  readonly llmCallId: Id;
}

export interface InterviewResult {
  readonly answer: string;
  readonly reveals: Id[];
  readonly ignoredReveals: string[];
  readonly llmCallId: Id;
}

export interface AgentRuntime {
  plan(ctx: AgentContext, input?: PlanInput): Promise<PlanResult>;
  speak(ctx: AgentContext, input: SpeakInput): Promise<SpeakResult>;
  reflect(ctx: AgentContext, day: ReflectDay): Promise<ReflectResult>;
  interview(ctx: AgentContext, question: string): Promise<InterviewResult>;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function renderDirective(ctx: AgentContext, directive: DirectiveBiases, names: Readonly<Record<Id, string>>): string {
  const nameOf = (id: Id): string => names[id] ?? ctx.relationships.find((r) => r.targetId === id)?.targetName ?? id;
  const lines = ['Consigne du joueur (à prendre en compte, sans renier ton caractère) :'];
  const actions = Object.entries(directive.actions).map(([a, w]) => `${a} ${w > 0 ? '+' : ''}${String(w)}`);
  const targets = Object.entries(directive.targets).map(([t, w]) => `${nameOf(t)} ${w > 0 ? '+' : ''}${String(w)}`);
  if (actions.length > 0) lines.push(`- Actions : ${actions.join(', ')}`);
  if (targets.length > 0) lines.push(`- Personnes : ${targets.join(', ')}`);
  if (directive.prefer.length > 0) lines.push(`- À privilégier : ${directive.prefer.join(', ')}`);
  if (directive.forbid.length > 0) lines.push(`- À éviter : ${directive.forbid.join(', ')}`);
  return lines.join('\n');
}

export function createAgentRuntime(deps: AgentRuntimeDeps): AgentRuntime {
  const retries = deps.retries ?? 2;
  const tier = deps.tier ?? 'dialogue';
  const diag = (d: AgentDiagnostic): void => deps.onDiagnostic?.(d);

  return {
    async plan(ctx, input = {}) {
      const characterId = ctx.identity.id;
      const names = input.names ?? {};
      const extras: string[] = [];
      if (input.memories && input.memories.length > 0) {
        extras.push(['Souvenirs qui te reviennent :', ...input.memories.map((m) => `- ${m}`)].join('\n'));
      }
      if (input.locations && input.locations.length > 0) {
        extras.push(['Lieux de la maison :', ...input.locations.map((l) => `- ${l.name}`)].join('\n'));
      }
      if (input.directive) extras.push(renderDirective(ctx, input.directive, names));

      const task = [
        'Planifie ta journée : donne 1 à 5 intentions classées par priorité (0 à 1).',
        'Types : talk_to (aller parler à quelqu’un), avoid (éviter quelqu’un), attend (attendre quelqu’un), tell (raconter un fait que tu connais à quelqu’un), go_to (aller dans un lieu).',
        'Désigne les personnes par leur prénom, les lieux par leur nom, les faits par leur identifiant (`tell` uniquement).',
        'Réponds : {"intentions":[{"kind","target","goal","factId","location","priority"}]}.',
      ].join('\n');
      const result = await completeStructured(
        deps.llm,
        {
          ...agentRequest({
            purpose: 'plan',
            tier,
            persona: deps.persona(characterId),
            ctx,
            extras,
            task,
            maxTokens: MAX_TOKENS.plan,
          }),
          output: PlanSchema,
        },
        { retries },
      );

      const people = nameIndex(ctx, names);
      const places = new Map((input.locations ?? []).map((l) => [normName(l.name), l.id]));
      const ignored: string[] = [];
      const intentions: Intention[] = [];
      for (const raw of (result.data as PlanOutput).intentions) {
        const reject = (kind: AgentDiagnostic['kind'], detail: string): void => {
          ignored.push(detail);
          diag({ kind, characterId, detail });
        };
        const targetId = raw.target === null ? null : (people.get(normName(raw.target)) ?? null);
        if (raw.target !== null && targetId === null) {
          reject('ignored_target', `cible inconnue « ${raw.target} »`);
          continue;
        }
        const locationId = raw.location === null ? null : (places.get(normName(raw.location)) ?? null);
        if (raw.location !== null && locationId === null) {
          reject('ignored_location', `lieu inconnu « ${raw.location} »`);
          continue;
        }
        let factId: Id | null = null;
        if (raw.factId !== null && raw.factId.trim() !== '') {
          const { known } = splitKnown(ctx, [raw.factId]);
          factId = known[0] ?? null;
          if (factId === null) {
            reject('ignored_fact', `fait inconnu ${cleanId(raw.factId)}`);
            continue;
          }
        }
        intentions.push({
          kind: raw.kind,
          targetId,
          goal: raw.goal,
          factId,
          locationId,
          priority: clamp01(raw.priority),
        });
      }
      intentions.sort((a, b) => b.priority - a.priority);
      return { intentions, ignored, llmCallId: result.llmCallId };
    },

    async speak(ctx, input) {
      const characterId = ctx.identity.id;
      const role = input.role ?? 'initiator';
      const last = input.turn.index >= input.turn.max;
      const task = [
        `Action en cours : ${input.action}${input.addressee ? ` (avec ${input.addressee})` : ''}.`,
        input.factText ? `Fait concerné : ${input.factText}.` : null,
        `Issue déjà décidée : ${outcomeLine(input.outcome)}.`,
        `Tour ${String(input.turn.index)} sur ${String(input.turn.max)} au plus.`,
        role === 'initiator'
          ? 'Tu prends la parole : dis la réplique de ton personnage pour cette action.'
          : 'Tu réponds à ce qui vient d’être dit, de façon que l’échange mène à l’issue décidée.',
        'Ta réplique doit mener à cette issue sans la contredire ni la nommer.',
        last
          ? 'C’est le dernier tour : conclus l’échange.'
          : 'Mets `wantsToContinue` à false seulement si l’échange est terminé.',
        input.feedback ? `Ta version précédente a été jugée incohérente : ${input.feedback} Corrige-la.` : null,
        'Réponds : {"text","intent","tone","emotion","reveals","mentions","wantsToContinue"}.',
      ]
        .filter((l): l is string => l !== null)
        .join('\n');
      const result = await completeStructured(
        deps.llm,
        {
          ...agentRequest({
            purpose: 'speak',
            tier,
            persona: deps.persona(characterId),
            ctx,
            task,
            maxTokens: MAX_TOKENS.speak,
          }),
          output: SpeakSchema,
        },
        { retries },
      );
      const out = result.data as SpeakOutput;
      const { known, ignored } = splitKnown(ctx, out.reveals);
      for (const detail of ignored) diag({ kind: 'ignored_reveal', characterId, detail });
      const people = nameIndex(ctx);
      const mentions = [...new Set(out.mentions.flatMap((n) => people.get(normName(n)) ?? []))];
      return {
        text: out.text,
        intent: out.intent,
        tone: out.tone,
        emotion: out.emotion,
        reveals: known,
        ignoredReveals: ignored,
        mentions,
        wantsToContinue: out.wantsToContinue,
        llmCallId: result.llmCallId,
      };
    },

    async reflect(ctx, day) {
      const characterId = ctx.identity.id;
      const goals = ctx.goals.map((g, i) => `${String(i)}. (${g.kind}) ${g.description}`);
      const extras = [
        ['Ta journée (époque ' + String(day.epoch) + ') :', ...day.highlights.map((h) => `- ${h}`)].join('\n'),
        ['Objectifs ouverts (numérotés) :', ...(goals.length > 0 ? goals : ['- aucun'])].join('\n'),
      ];
      const task = [
        'Fais le point sur la journée. Pour les faits de « Ce que vous savez » que cette journée change dans ta tête, donne ta croyance (believes, doubts, disbelieves) et ta confiance (0 à 1).',
        'Indique aussi les objectifs atteints ou abandonnés, par leur numéro.',
        'Ne cite que des identifiants de faits que tu connais.',
        'Réponds : {"beliefs":[{"factId","belief","confidence"}],"goalUpdates":[{"goalIndex","status"}]}.',
      ].join('\n');
      const result = await completeStructured(
        deps.llm,
        {
          ...agentRequest({
            purpose: 'reflect',
            tier,
            persona: deps.persona(characterId),
            ctx,
            extras,
            task,
            maxTokens: MAX_TOKENS.reflect,
          }),
          output: ReflectSchema,
        },
        { retries },
      );
      const out = result.data as ReflectOutput;
      const ignored: string[] = [];
      const beliefs: ReflectResult['beliefs'] = [];
      for (const b of out.beliefs) {
        const { known } = splitKnown(ctx, [b.factId]);
        const factId = known[0];
        if (factId === undefined) {
          ignored.push(`fait inconnu ${cleanId(b.factId)}`);
          diag({ kind: 'ignored_fact', characterId, detail: cleanId(b.factId) });
        } else if (!beliefs.some((x) => x.factId === factId)) {
          beliefs.push({ factId, belief: b.belief, confidence: clamp01(b.confidence) });
        }
      }
      const goalUpdates: ReflectResult['goalUpdates'] = [];
      for (const g of out.goalUpdates) {
        if (g.goalIndex >= ctx.goals.length || goalUpdates.some((x) => x.goalIndex === g.goalIndex)) {
          ignored.push(`objectif ${String(g.goalIndex)} inexistant`);
          diag({ kind: 'ignored_goal', characterId, detail: String(g.goalIndex) });
        } else goalUpdates.push({ goalIndex: g.goalIndex, status: g.status });
      }
      return { beliefs, goalUpdates, ignored, llmCallId: result.llmCallId };
    },

    async interview(ctx, question) {
      const characterId = ctx.identity.id;
      const task = [
        'Tu es au confessionnal. Un intervieweur te pose une question ; réponds en face caméra, avec franchise ou calcul selon ton caractère.',
        `Question : ${question}`,
        'Réponds : {"answer","reveals"}.',
      ].join('\n');
      const result = await completeStructured(
        deps.llm,
        {
          ...agentRequest({
            purpose: 'interview',
            tier,
            persona: deps.persona(characterId),
            ctx,
            task,
            maxTokens: MAX_TOKENS.interview,
          }),
          output: InterviewSchema,
        },
        { retries },
      );
      const out = result.data as InterviewOutput;
      const { known, ignored } = splitKnown(ctx, out.reveals);
      for (const detail of ignored) diag({ kind: 'ignored_reveal', characterId, detail });
      return { answer: out.answer, reveals: known, ignoredReveals: ignored, llmCallId: result.llmCallId };
    },
  };
}

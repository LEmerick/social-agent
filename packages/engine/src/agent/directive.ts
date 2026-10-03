/** Compilation d'une consigne en texte libre en bonus structurés (action-catalog.md §7), faite une seule fois. */
import type { LLMPort } from '../llm/index.js';
import { completeStructured } from '../llm/index.js';
import { ACTION_IDS } from '../rules/types.js';
import type { DirectiveBiases, Id } from '../state/types.js';
import type { AgentContext } from './context.js';
import { MAX_TOKENS, nameIndex, normName } from './prompts.js';
import { DirectiveCompileSchema } from './schemas.js';

export interface CompileDirectiveOptions {
  /** Noms de tous les personnages, pour résoudre une cible qu'`ctx` ne contient pas. */
  readonly names?: Readonly<Record<Id, string>>;
  readonly retries?: number;
}

/** Bonus bornés : la personnalité doit pouvoir l'emporter sur une consigne. */
export const BIAS_LIMIT = 3;

const STABLE = [
  'Tu convertis la consigne d’un joueur, donnée à un personnage de télé-réalité, en bonus numériques.',
  'Sortie : {"actions":{"<action>":bonus},"targets":{"<prénom>":bonus},"prefer":["<action>"],"forbid":["<action>"]}.',
  `Les bonus vont de -${String(BIAS_LIMIT)} (à éviter) à ${String(BIAS_LIMIT)} (à rechercher). Les actions viennent exclusivement de cette liste : ${ACTION_IDS.join(', ')}.`,
  'N’invente ni action ni personne ; ce que la consigne ne mentionne pas reste absent. Réponds uniquement par le JSON.',
].join('\n');

const clamp = (n: number): number => Math.min(BIAS_LIMIT, Math.max(-BIAS_LIMIT, n));
const isAction = (a: string): boolean => (ACTION_IDS as readonly string[]).includes(a);

/**
 * Les actions hors catalogue et les personnes inconnues sont écartées : `DirectiveBiases` ne contient que des
 * identifiants valides (actions du catalogue, identifiants de personnages).
 */
export async function compileDirective(
  llm: LLMPort,
  text: string,
  ctx: AgentContext,
  options: CompileDirectiveOptions = {},
): Promise<DirectiveBiases> {
  const people = nameIndex(ctx, options.names);
  const known = [...new Set([...people.keys()])].sort();
  const result = await completeStructured(
    llm,
    {
      purpose: 'compile_directive',
      tier: 'fast',
      system: { stable: STABLE, variable: `Personnage concerné : ${ctx.identity.firstName}.` },
      messages: [
        {
          role: 'user',
          content: `Personnes citables (prénoms) : ${known.join(', ') || 'aucune'}.\nConsigne : ${text}`,
        },
      ],
      output: DirectiveCompileSchema,
      maxTokens: MAX_TOKENS.directive,
      characterId: ctx.identity.id,
    },
    { retries: options.retries ?? 2 },
  );
  const raw = result.data as {
    actions: Record<string, number>;
    targets: Record<string, number>;
    prefer: string[];
    forbid: string[];
  };

  const actions: Record<string, number> = {};
  for (const [a, w] of Object.entries(raw.actions)) if (isAction(a) && Number.isFinite(w)) actions[a] = clamp(w);
  const targets: Record<Id, number> = {};
  for (const [name, w] of Object.entries(raw.targets)) {
    const id = people.get(normName(name));
    if (id !== undefined && Number.isFinite(w)) targets[id] = clamp(w);
  }
  const keep = (list: readonly string[]): string[] => [...new Set(list.filter(isAction))];
  return { actions, targets, prefer: keep(raw.prefer), forbid: keep(raw.forbid) };
}

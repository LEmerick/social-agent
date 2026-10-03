/**
 * Briques de prompt partagées. Disposition pensée pour le cache de prompt du fournisseur (préfixe identique d'un appel
 * à l'autre) : `system.stable` = persona + règles communes (rien qui varie) ; `system.variable` = contexte rendu de
 * l'agent ; la consigne de la tâche est dans le message utilisateur.
 */
import type { LlmRequest } from '../llm/index.js';
import type { Id } from '../state/types.js';
import type { AgentContext } from './context.js';
import { renderAgentContext } from './context-render.js';

export const COMMON_RULES = [
  'Cadre : tu participes à une télé-réalité fictive, entouré d’autres candidats. Tout se passe en français.',
  'Règles absolues :',
  '1. Tu n’utilises que ce que contient la section « Ce que vous savez » et ce que tu as vécu ; tu n’inventes aucun fait.',
  '2. Tu ne révèles jamais un fait absent de cette liste ; quand tu en évoques un, cite son identifiant entre crochets dans `reveals`.',
  '3. Tu restes cohérent avec ton tempérament et tes relations.',
  '4. Tu réponds uniquement par un JSON valide conforme au schéma demandé, sans texte autour.',
].join('\n');

export const stableSystem = (persona: string): string => `${persona}\n\n${COMMON_RULES}`;

/** Sens de chaque issue du catalogue, pour le juge, le dialogue et le vérificateur. */
export const OUTCOME_MEANING: Readonly<Record<string, string>> = {
  accepted: 'la cible accepte sans réserve',
  accepted_conditional: 'la cible accepte, mais à des conditions qu’elle énonce',
  deflected: 'la cible esquive, change de sujet ou répond à côté sans trancher',
  refused: 'la cible refuse nettement',
  backfired: 'l’action se retourne contre celui qui l’a tentée',
  escalated: 'le conflit s’ouvre ou monte d’un cran',
  believed: 'la cible croit ce qu’on lui dit',
  doubted: 'la cible doute de ce qu’on lui dit',
  disbelieved: 'la cible ne croit pas ce qu’on lui dit',
  won: 'l’initiateur remporte l’épreuve',
  lost: 'l’initiateur perd l’épreuve',
  draw: 'l’épreuve se termine à égalité',
  detected: 'l’action est repérée',
  undetected: 'l’action passe inaperçue',
  found: 'la recherche aboutit',
  not_found: 'la recherche ne donne rien',
  found_clue: 'la recherche livre un indice',
};

export const outcomeLine = (outcome: string): string =>
  `${outcome} (${OUTCOME_MEANING[outcome] ?? 'issue du catalogue'})`;

/** Un nom de personnage normalisé (sans accent ni casse) pour résoudre les prénoms cités par le modèle. */
export const normName = (name: string): string => name.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

/** Prénom → identifiant, pour les personnes que l'agent connaît (relations, présents) et les noms fournis en plus. */
export function nameIndex(ctx: AgentContext, extra: Readonly<Record<Id, string>> = {}): Map<string, Id> {
  const index = new Map<string, Id>();
  for (const [id, name] of Object.entries(extra)) index.set(normName(name), id);
  for (const r of ctx.relationships) index.set(normName(r.targetName), r.targetId);
  for (const m of ctx.situation.members) index.set(normName(m.name), m.id);
  index.delete(normName(ctx.identity.firstName));
  return index;
}

/** `[abc]` ou `abc` → `abc`. */
export const cleanId = (raw: string): string => raw.trim().replace(/^\[+|\]+$/g, '');

/** Identifiants cités qui figurent dans les connaissances du contexte, et ceux qui n'y figurent pas. */
export function splitKnown(ctx: AgentContext, raw: readonly string[]): { known: Id[]; ignored: string[] } {
  const knownIds = new Set(ctx.knowledge.map((k) => k.factId));
  const known: Id[] = [];
  const ignored: string[] = [];
  for (const entry of raw) {
    const id = cleanId(entry);
    if (knownIds.has(id)) {
      if (!known.includes(id)) known.push(id);
    } else ignored.push(id);
  }
  return { known, ignored };
}

export interface AgentPromptParts {
  readonly purpose: LlmRequest['purpose'];
  readonly tier: LlmRequest['tier'];
  readonly persona: string;
  readonly ctx: AgentContext;
  /** Compléments du bloc variable (souvenirs, consigne du joueur…), après le contexte. */
  readonly extras?: readonly string[];
  readonly task: string;
  readonly maxTokens: number;
}

/** Requête de base d'un appel d'agent : tout ce qui est commun aux tâches, sans le schéma de sortie. */
export function agentRequest(p: AgentPromptParts): Omit<LlmRequest, 'output'> {
  const variable = [renderAgentContext(p.ctx), ...(p.extras ?? [])].join('\n\n');
  return {
    purpose: p.purpose,
    tier: p.tier,
    system: { stable: stableSystem(p.persona), variable },
    messages: [{ role: 'user', content: p.task }],
    maxTokens: p.maxTokens,
    characterId: p.ctx.identity.id,
  };
}

/** Plafonds de sortie par tâche. Large : les modèles récents réfléchissent avant de répondre (jetons comptés dans `max_tokens`). */
export const MAX_TOKENS = {
  plan: 3_000,
  speak: 2_500,
  reflect: 3_000,
  interview: 2_000,
  choose: 2_000,
  judge: 2_000,
  verify: 800,
  directive: 2_000,
} as const;

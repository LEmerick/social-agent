/**
 * ConfessionalService : le personnage parle face caméra via `AgentRuntime.interview`, avec son seul contexte
 * (`buildAgentContext` : uniquement ses connaissances). La question est formée à partir de ce contexte lui-même
 * (prénoms des personnes de l'arc que le personnage connaît), jamais à partir du contenu de l'arc.
 */
import type { AgentContext, AgentRuntime, Id } from '@ai-reality/engine';
import type { EpisodeLine } from './script.js';
import type { NarrativeArc } from './types.js';

export interface ConfessionalService {
  record(characterId: Id, about: NarrativeArc): Promise<EpisodeLine>;
}

export interface ConfessionalDeps {
  readonly runtime: AgentRuntime;
  /** Contexte filtré du personnage au moment de l'arc (voir `storageContextProvider`). */
  readonly contextFor: (characterId: Id, about: NarrativeArc) => Promise<AgentContext>;
}

export function confessionalQuestion(ctx: AgentContext, about: NarrativeArc): string {
  const others = ctx.relationships
    .filter((r) => r.targetId !== ctx.identity.id && about.characterIds.includes(r.targetId))
    .map((r) => r.targetName);
  if (others.length === 0) return 'Comment vis-tu ces derniers jours dans la maison ?';
  return `Que penses-tu de ${others.join(' et de ')} en ce moment ?`;
}

export function createConfessionalService(deps: ConfessionalDeps): ConfessionalService {
  return {
    async record(characterId, about) {
      const ctx = await deps.contextFor(characterId, about);
      const result = await deps.runtime.interview(ctx, confessionalQuestion(ctx, about));
      return {
        kind: 'confessional',
        speakerId: characterId,
        text: result.answer,
        utteranceId: null,
        tone: null,
        arcId: about.id,
        revealedFactIds: result.reveals,
        llmCallId: result.llmCallId,
      };
    },
  };
}

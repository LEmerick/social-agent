/**
 * Hooks d'époque des agents (engine-architecture.md §6) : phase 2 (agendas) et phase 6 (mémoire et réflexion).
 * Les personnages sont traités un par un, dans l'ordre des identifiants (déterminisme du rejeu).
 */
import { simIdFactory } from '../core/sim-ids.js';
import type { TickContext, TickHook } from '../epoch/types.js';
import { bestEdge } from '../knowledge/query.js';
import { memoriesFromEvents } from '../memory/from-events.js';
import type { MemoryService } from '../memory/service.js';
import type { StoragePort } from '../ports/storage.js';
import type { EventRecord } from '../state/journal.js';
import type { CharacterNode, Id, Intention, KnowledgeEdge, SimState } from '../state/types.js';
import { buildAgentContext } from './context.js';
import type { AgentRuntime } from './runtime.js';
import { situationOf } from './situation.js';

/** Priorité minimale d'une intention issue d'une directive, selon l'autonomie du personnage. */
export const DIRECTIVE_PRIORITY = { directive: 0.9, guided: 0.6 } as const;

const active = (c: CharacterNode): boolean => c.status === 'active' || c.status === 'restricted';
const sortedActive = (state: Readonly<SimState>): CharacterNode[] =>
  Object.keys(state.characters)
    .sort()
    .flatMap((id) => {
      const c = state.characters[id];
      return c && active(c) ? [c] : [];
    });

/**
 * Intentions `talk_to` que la directive impose : une par personne à bonus positif. Mode `directive` : priorité
 * haute (0,9) ; `guided` : moyenne (0,6) ; `autonomous` : aucune (la directive ne fait qu'orienter le prompt).
 */
export function directiveIntentions(state: Readonly<SimState>, character: CharacterNode): Intention[] {
  const level = character.autonomy === 'autonomous' ? undefined : DIRECTIVE_PRIORITY[character.autonomy];
  const biases = character.directive;
  if (level === undefined || !biases) return [];
  return Object.entries(biases.targets)
    .filter(([id, w]) => w > 0 && id !== character.id && state.characters[id] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([targetId]) => ({
      kind: 'talk_to' as const,
      targetId,
      goal: 'directive',
      factId: null,
      locationId: null,
      priority: level,
    }));
}

export interface AgentPlanOptions {
  /** Souvenirs à rappeler pour le plan d'un personnage (ex. `MemoryService.recall`). */
  readonly recall?: (characterId: Id) => Promise<readonly string[]>;
}

/**
 * Phase 2 : un agenda par agent. Le résultat remplace l'agenda (les `tell` différés déjà présents sont conservés).
 * Une intention de directive absente du plan du modèle est ajoutée ; si elle y figure, la priorité la plus haute l'emporte.
 */
export function agentPlanHook(runtime: AgentRuntime, options: AgentPlanOptions = {}): TickHook {
  return async (ctx) => {
    const { state } = ctx;
    const locations = Object.values(state.locations)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((l) => ({ id: l.id, name: l.name }));
    const names = Object.fromEntries(Object.values(state.characters).map((c) => [c.id, c.firstName]));

    for (const character of sortedActive(state)) {
      const agentCtx = buildAgentContext(state, character.id, situationOf(state, character.id));
      const memories = (await options.recall?.(character.id)) ?? [];
      const plan = await runtime.plan(agentCtx, { memories, locations, names, directive: character.directive });

      const planned = [...plan.intentions];
      for (const forced of directiveIntentions(state, character)) {
        const i = planned.findIndex((p) => p.kind === 'talk_to' && p.targetId === forced.targetId);
        const existing = planned[i];
        if (existing) planned[i] = { ...existing, priority: Math.max(existing.priority, forced.priority) };
        else planned.push(forced);
      }
      planned.sort((a, b) => b.priority - a.priority);
      const carried = character.agenda.filter((a) => a.kind === 'tell' && a.factId !== null);
      character.agenda = [...planned, ...carried];
    }
  };
}

/** Les events d'une époque déjà écrits en base (le lot de clôture, lui, est en mémoire). */
export type EventSource = (epochId: Id) => Promise<readonly EventRecord[]>;

export const eventsFromStorage =
  (storage: StoragePort): EventSource =>
  async (epochId) =>
    (await storage.tx((s) => s.journal.read(epochId))).events;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Phase 6 : pour chaque agent, souvenirs des events vécus (`memoriesFromEvents`, enregistrés par le service), puis
 * réflexion de fin de journée : les croyances deviennent des connaissances `inferred` (dans `state` et dans le lot de
 * clôture), les objectifs atteints ou abandonnés changent de statut dans `state`.
 *
 * `events` fournit les events déjà commités de l'époque (`eventsFromStorage(storage)`) ; ceux du lot de clôture
 * s'y ajoutent.
 */
export function agentMemoryHook(runtime: AgentRuntime, memory: MemoryService, events: EventSource): TickHook {
  return async (ctx: TickContext) => {
    const { state, batch } = ctx;
    const all = [...(await events(ctx.epochId)), ...batch.events];
    const memoryIds = ctx.ids('memory');
    const inferredIds = simIdFactory(state.world.seed, state.world.config, ctx.epochNumber, ctx.tick, 'inference');

    for (const character of sortedActive(state)) {
      const drafts = memoriesFromEvents(state, character.id, all, memoryIds, { max: 8 });
      if (drafts.length > 0) await memory.record(character.id, drafts);

      const agentCtx = buildAgentContext(state, character.id, situationOf(state, character.id));
      const reflection = await runtime.reflect(agentCtx, {
        epoch: ctx.epochNumber,
        highlights: drafts.map((d) => d.summary),
      });

      for (const belief of reflection.beliefs) {
        const parent = bestEdge(state, character.id, belief.factId);
        const edge: KnowledgeEdge = {
          id: inferredIds.next(),
          characterId: character.id,
          factId: belief.factId,
          sourceType: 'inferred',
          toldById: null,
          viaEventId: null,
          parentKnowledgeId: parent?.id ?? null,
          learnedEpoch: ctx.epochNumber,
          learnedTick: ctx.tick,
          confidence: clamp01(belief.confidence),
          belief: belief.belief,
        };
        state.knowledge[edge.id] = edge;
        batch.knowledge.push(edge);
      }

      const open = character.goals.filter((g) => g.status === 'open');
      for (const update of reflection.goalUpdates) {
        const goal = open[update.goalIndex];
        if (!goal) continue;
        character.goals = character.goals.map((g) => (g.id === goal.id ? { ...g, status: update.status } : g));
      }
    }
  };
}

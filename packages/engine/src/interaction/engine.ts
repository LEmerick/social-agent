/**
 * InteractionEngine sans LLM (services.md §3.2, action-catalog.md §4), exposé comme hook de tick.
 *
 * Pour chaque scène ouverte (ordre du scheduler), les membres `participant` libres, triés par identifiant, reçoivent
 * leurs options ; la politique choisit ; l'issue vient de l'`OutcomeModel` ; le dialogue du `DialogueGenerator` ;
 * `resolveInteraction` applique tout immédiatement à l'état (coûts compris : `chargeAction` y est appelé une seule
 * fois). Un personnage n'est jamais dans deux interactions au même tick, une scène en porte au plus
 * `config.maxInteractionsPerScene` par tick.
 */
import { DomainError } from '../core/errors.js';
import { HeuristicOutcomeModel } from '../decision/heuristic-outcome.js';
import { type ActionOption, type OutcomeModel, optionKey } from '../decision/ports.js';
import type { TickContext, TickHook } from '../epoch/types.js';
import { actionDef } from '../rules/catalog.js';
import { availableOptions } from '../rules/options.js';
import type { ActionCategory, ActionDef, SceneContext } from '../rules/types.js';
import { resolveInteraction } from '../resolution/resolve.js';
import type { Listener } from '../scene/audience.js';
import type { DecisionRecord, InteractionRecord, UtteranceRecord } from '../state/journal.js';
import { type Id, type RelationshipEdge, relKey } from '../state/types.js';
import { type DialogueGenerator, SummaryDialogue } from './dialogue.js';

export interface InteractionDeps {
  /** Défaut : `SummaryDialogue`. */
  readonly dialogue?: DialogueGenerator;
  /** Utilisé quand le scheduler n'a pas d'`OutcomeModel` (défaut : `HeuristicOutcomeModel`). */
  readonly fallbackOutcome?: OutcomeModel;
}

type InteractionType = InteractionRecord['type'];

const TYPE_OF: Readonly<Record<ActionCategory, InteractionType>> = {
  social: 'social',
  relational: 'relational',
  strategic: 'strategic',
  informational: 'informational',
  competitive: 'competitive',
  collective: 'collective',
  special: 'competitive',
  observation: 'informational',
  movement: 'social',
  solo: 'social',
  object: 'strategic',
};

/** Les déplacements appartiennent au scheduler (`chooseDestination`) : `move_to` n'est jamais joué ici. */
const isPlayable = (o: ActionOption): boolean => o.action !== 'move_to';

const upsertEdge = (batch: TickContext['batch'], edge: RelationshipEdge): void => {
  const key = relKey(edge.sourceId, edge.targetId);
  const at = batch.relationships.findIndex((e) => relKey(e.sourceId, e.targetId) === key);
  if (at >= 0) batch.relationships[at] = edge;
  else batch.relationships.push(edge);
};

export function interactionHook(deps: InteractionDeps = {}): TickHook {
  const dialogue = deps.dialogue ?? new SummaryDialogue();
  const fallback = deps.fallbackOutcome ?? new HeuristicOutcomeModel();

  return async (ctx) => {
    const { state, batch } = ctx;
    const outcomes = ctx.outcome ?? fallback;
    const max = state.world.config.maxInteractionsPerScene;
    const ids = ctx.ids('interaction');
    const engaged = new Set<Id>();

    for (const view of ctx.scenes) {
      const participants = view.members.filter((m) => m.role === 'participant');
      const scene: SceneContext = {
        members: participants.map((m) => ({
          characterId: m.characterId,
          locationId: view.scene.locationId,
          zoneId: m.zoneId,
        })),
      };
      let count = 0;

      for (const member of participants) {
        if (count >= max) break;
        const actorId = member.characterId;
        if (engaged.has(actorId)) continue;

        const options = availableOptions(state, actorId, scene).filter(isPlayable);
        if (options.length === 0) continue;
        const decision = await ctx.decision.choose({
          actorId,
          state,
          options,
          rng: ctx.rng('action', actorId),
        });
        const option = decision.chosen;
        if (option === null) continue;
        if (!options.some((o) => optionKey(o) === optionKey(option))) {
          throw new DomainError('INVALID_CHOICE', `${decision.policy} a choisi ${optionKey(option)}, hors des options`);
        }
        // Cible déjà engagée ce tick : l'option est abandonnée.
        if (option.targetId !== null && engaged.has(option.targetId)) continue;

        const def = actionDef(option.action);
        if (!def) throw new DomainError('UNKNOWN_ACTION', `Action hors catalogue : ${option.action}`);

        const interactionId = ids.next();
        const result = await outcomes.resolve({ option, actorId, state, rng: ctx.rng('outcome', actorId) });

        const volume = def.defaultVolume === 'hidden' ? 'whisper' : def.defaultVolume;
        const heard: Listener[] =
          def.defaultVolume === 'hidden'
            ? []
            : ctx.audience(view.scene.id, actorId, volume).filter((l) => l.characterId !== option.targetId);
        const witnessIds = heard.filter((l) => l.perception === 'hears').map((l) => l.characterId);

        const spoken = await dialogue.generate({
          state,
          interactionId,
          sceneId: view.scene.id,
          option,
          actorId,
          outcome: result.outcome,
          volume,
          listeners: heard,
          rng: ctx.rng('dialogue', actorId),
        });

        const resolution = resolveInteraction(
          state,
          {
            option,
            actorId,
            outcome: result.outcome,
            sceneId: view.scene.id,
            interactionId,
            locationId: view.scene.locationId,
            witnessIds,
            ctx: scene,
          },
          ids,
        );

        batch.interactions.push(
          interactionRecord(
            ctx,
            def,
            interactionId,
            view.scene.id,
            actorId,
            option,
            result.outcome,
            spoken.mode,
            witnessIds,
          ),
        );
        spoken.utterances.forEach((u, seq): void => {
          const record: UtteranceRecord = { ...u, id: ids.next(), interactionId, seq, tick: ctx.tick };
          batch.utterances.push(record);
        });
        batch.decisions.push(
          decisionRecord(ctx, ids.next(), 'action', actorId, interactionId, {
            options: decision.distribution ?? options.map(optionKey),
            chosen: option,
            policy: decision.policy,
            rngDraw: decision.rngDraw,
            llmCallId: decision.llmCallId ?? null,
          }),
          decisionRecord(ctx, ids.next(), 'outcome', actorId, interactionId, {
            options: result.distribution ?? def.outcomes,
            chosen: result.outcome,
            policy: result.policy,
            rngDraw: result.rngDraw,
            llmCallId: result.llmCallId ?? null,
          }),
        );
        batch.events.push(resolution.event);
        batch.effects.push(...resolution.effects);
        batch.ledger.push(...resolution.ledger);
        batch.scoreEntries.push(...resolution.scoreEntries);
        for (const edge of resolution.relationships) upsertEdge(batch, edge);

        engaged.add(actorId);
        if (option.targetId !== null) engaged.add(option.targetId);
        count += 1;
      }
    }
  };
}

function interactionRecord(
  ctx: TickContext,
  def: ActionDef,
  id: Id,
  sceneId: Id,
  actorId: Id,
  option: ActionOption,
  outcome: string,
  mode: InteractionRecord['mode'],
  bystanderIds: readonly Id[],
): InteractionRecord {
  return {
    id,
    epochId: ctx.epochId,
    sceneId,
    type: TYPE_OF[def.category],
    initiatorId: actorId,
    tickStart: ctx.tick,
    tickEnd: ctx.tick + 1, // intervalle semi-ouvert : une interaction occupe son tick
    action: option.action,
    outcome,
    mode,
    classification: { category: def.category, catalogVersion: def.version },
    participants: [
      { characterId: actorId, role: 'speaker' },
      ...(option.targetId === null ? [] : [{ characterId: option.targetId, role: 'addressee' as const }]),
      ...bystanderIds.filter((b) => b !== option.targetId).map((b) => ({ characterId: b, role: 'bystander' as const })),
    ],
  };
}

function decisionRecord(
  ctx: TickContext,
  id: Id,
  kind: DecisionRecord['kind'],
  characterId: Id,
  interactionId: Id,
  d: Pick<DecisionRecord, 'policy' | 'rngDraw' | 'llmCallId'> & { options: unknown; chosen: unknown },
): DecisionRecord {
  return {
    id,
    epochId: ctx.epochId,
    tick: ctx.tick,
    characterId,
    kind,
    options: d.options,
    chosen: d.chosen,
    policy: d.policy,
    rngDraw: d.rngDraw,
    interactionId,
    llmCallId: d.llmCallId,
  };
}

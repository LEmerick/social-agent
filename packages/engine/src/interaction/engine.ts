/**
 * InteractionEngine sans LLM (services.md §3.2, action-catalog.md §4), exposé comme hook de tick.
 *
 * Pour chaque scène ouverte (ordre du scheduler), les membres `participant` libres, triés par identifiant, reçoivent
 * leurs options ; la politique choisit ; l'issue vient de l'`OutcomeModel` ; le dialogue du `DialogueGenerator` ;
 * `resolveInteraction` applique tout immédiatement à l'état (coûts compris : `chargeAction` y est appelé une seule
 * fois). Un personnage n'est jamais dans deux interactions au même tick, une scène en porte au plus
 * `config.maxInteractionsPerScene` par tick.
 *
 * Connaissances (phase 3.f, voir `propagation.ts`) : après la résolution, les faits portés par l'interaction circulent
 * (témoins, faits révélés, rumeurs) et sont écrits dans le lot du tick. Les observateurs d'une autre zone n'agissent
 * qu'en écoutant aux portes (`eavesdrop`) ce qui s'est dit dans la scène pendant ce tick.
 */
import { DomainError } from '../core/errors.js';
import { HeuristicOutcomeModel } from '../decision/heuristic-outcome.js';
import { type ActionOption, type OutcomeModel, optionKey } from '../decision/ports.js';
import type { SceneMember, TickContext, TickHook } from '../epoch/types.js';
import { FORMAT_ACTIONS, dispatchFormatAction } from '../formats/dispatch.js';
import { absorb, busyOf } from '../formats/hook-kit.js';
import { withFormatContext } from '../formats/scene-context.js';
import { betrayalEffects, provenanceSummary, refreshSightings } from '../knowledge/index.js';
import { actionDef } from '../rules/catalog.js';
import { availableOptions } from '../rules/options.js';
import type { ActionCategory, ActionDef, SceneContext } from '../rules/types.js';
import { resolveInteraction } from '../resolution/resolve.js';
import type { Listener } from '../scene/audience.js';
import type {
  DecisionRecord,
  EffectInput,
  EventParticipant,
  InteractionRecord,
  UtteranceRecord,
} from '../state/journal.js';
import { type Id, type RelationshipEdge, type SimState, relKey } from '../state/types.js';
import { type DialogueGenerator, type DialogueVerification, SummaryDialogue } from './dialogue.js';
import {
  type CarryLog,
  type ScreenedReveals,
  causeOf,
  overhear,
  propagateInteraction,
  screenReveals,
} from './propagation.js';

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
    // Les personnages pris par une scène imposée du tick (épreuve, conseil) ne sont pas disponibles.
    const engaged = new Set<Id>(busyOf(state, ctx.tick));
    const log: CarryLog = new Map();
    refreshSightings(state, ctx.scenes);

    for (const view of ctx.scenes) {
      const participants = view.members.filter((m) => m.role === 'participant');
      const sceneOf = (members: readonly SceneMember[]): SceneContext => ({
        members: members.map((m) => ({
          characterId: m.characterId,
          locationId: view.scene.locationId,
          zoneId: m.zoneId,
        })),
      });
      const scene = sceneOf(participants);
      let count = 0;

      /** Une interaction de `actorId`, ou rien si la politique s'abstient ou si l'option est abandonnée. */
      const play = async (actorId: Id, options: readonly ActionOption[], eavesdropping: boolean): Promise<void> => {
        if (options.length === 0) return;
        const decision = await ctx.decision.choose({
          actorId,
          state,
          options,
          rng: ctx.rng('action', actorId),
        });
        const option = decision.chosen;
        if (option === null) return;
        if (!options.some((o) => optionKey(o) === optionKey(option))) {
          throw new DomainError('INVALID_CHOICE', `${decision.policy} a choisi ${optionKey(option)}, hors des options`);
        }
        // Cible déjà engagée ce tick : l'option est abandonnée (sauf l'écoute indiscrète, qui vise une conversation en cours).
        if (!eavesdropping && option.targetId !== null && engaged.has(option.targetId)) return;

        const def = actionDef(option.action);
        if (!def) throw new DomainError('UNKNOWN_ACTION', `Action hors catalogue : ${option.action}`);

        const interactionId = ids.next();
        const sceneCtx = withFormatContext(state, eavesdropping ? sceneOf(view.members) : scene, actorId);
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
        // Un énoncé ne révèle que ce que son locuteur sait ; le reste est ignoré et journalisé.
        const screened = screenReveals(ctx, actorId, option, def, spoken.utterances);
        const confrontation = confrontationOf(state, actorId, option, result.outcome);

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
            ctx: sceneCtx,
            causedByEventId: causeOf(ctx, actorId, option, screened),
            extraEffects: confrontation?.effects ?? [],
            ...(confrontation ? { payload: confrontation.payload } : {}),
            extraParticipants: subjectsOf(state, actorId, option, screened),
          },
          ids,
        );

        const learned = eavesdropping
          ? overhear(ctx, {
              sceneId: view.scene.id,
              eavesdropperId: actorId,
              targetId: option.targetId ?? '',
              outcome: result.outcome,
              event: resolution.event,
              log,
            })
          : [];
        const report = eavesdropping
          ? { created: [], revealed: [], learned }
          : propagateInteraction(ctx, {
              sceneId: view.scene.id,
              interactionId,
              actorId,
              option,
              def,
              outcome: result.outcome,
              event: resolution.event,
              heard,
              screened,
              log,
            });

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
            eavesdropping,
            {
              ...report,
              ignored: screened.ignored,
              ...(confrontation ? { traitorId: confrontation.traitorId } : {}),
            },
            spoken.verification,
          ),
        );
        screened.utterances.forEach((u, seq): void => {
          const record: UtteranceRecord = { ...u, id: ids.next(), interactionId, seq, tick: ctx.tick };
          batch.utterances.push(record);
        });
        const actionDecisionId = ids.next();
        const outcomeDecisionId = ids.next();
        batch.decisions.push(
          decisionRecord(ctx, actionDecisionId, 'action', actorId, interactionId, {
            options: decision.distribution ?? options.map(optionKey),
            chosen: option,
            policy: decision.policy,
            rngDraw: decision.rngDraw,
            llmCallId: decision.llmCallId ?? null,
          }),
          decisionRecord(ctx, outcomeDecisionId, 'outcome', actorId, interactionId, {
            options: result.distribution ?? def.outcomes,
            chosen: result.outcome,
            policy: result.policy,
            rngDraw: result.rngDraw,
            llmCallId: result.llmCallId ?? null,
          }),
        );
        if (FORMAT_ACTIONS.has(option.action)) {
          // Actions d'objet, de vote et d'espionnage : les services de formats exécutent l'issue (témoins selon la perception).
          const witnesses =
            def.defaultVolume === 'hidden' && result.outcome === 'detected'
              ? ctx.audience(view.scene.id, actorId, 'normal').filter((l) => l.characterId !== option.targetId)
              : heard;
          absorb(
            ctx,
            dispatchFormatAction(ctx, {
              actorId,
              option,
              outcome: result.outcome,
              event: resolution.event,
              witnesses,
              decisionId: actionDecisionId,
            }),
          );
        }
        batch.events.push(resolution.event);
        batch.effects.push(...resolution.effects);
        batch.ledger.push(...resolution.ledger);
        batch.scoreEntries.push(...resolution.scoreEntries);
        for (const edge of resolution.relationships) upsertEdge(batch, edge);

        engaged.add(actorId);
        if (option.targetId !== null && !eavesdropping) engaged.add(option.targetId);
        count += 1;
      };

      for (const member of participants) {
        if (count >= max) break;
        if (engaged.has(member.characterId)) continue;
        const options = availableOptions(
          state,
          member.characterId,
          withFormatContext(state, scene, member.characterId),
        ).filter(isPlayable);
        await play(member.characterId, options, false);
      }
      // Les observateurs (autre zone du lieu) ne font qu'une chose : écouter aux portes les conversations du tick.
      const everyone = sceneOf(view.members);
      for (const member of view.members.filter((m) => m.role === 'observer')) {
        if (count >= max) break;
        if (engaged.has(member.characterId)) continue;
        const options = availableOptions(
          state,
          member.characterId,
          withFormatContext(state, everyone, member.characterId),
        ).filter((o) => o.action === 'eavesdrop');
        await play(member.characterId, options, true);
      }
    }
  };
}

/** Effets et payload d'une confrontation au sujet d'un fait : provenance de l'accusateur, traître et retournement d'alliance. */
function confrontationOf(
  state: Readonly<SimState>,
  actorId: Id,
  option: ActionOption,
  outcome: string,
): { effects: EffectInput[]; payload: Record<string, unknown>; traitorId: Id | null } | null {
  if (
    (option.action !== 'confront' && option.action !== 'accuse') ||
    option.factId === null ||
    option.targetId === null
  ) {
    return null;
  }
  const betrayal = betrayalEffects(state, actorId, option.targetId, option.factId, outcome);
  return {
    effects: betrayal?.effects ?? [],
    traitorId: betrayal?.traitorId ?? null,
    payload: {
      provenance: provenanceSummary(state, actorId, option.factId),
      ...(betrayal ? { traitorId: betrayal.traitorId } : {}),
    },
  };
}

/** Le sujet d'un fait en jeu (hors acteur et cible) figure dans l'event avec le rôle `subject`. */
function subjectsOf(
  state: Readonly<SimState>,
  actorId: Id,
  option: ActionOption,
  screened: ScreenedReveals,
): EventParticipant[] {
  const factIds = [option.factId, ...screened.reveals.flatMap((r) => r.factIds)];
  const subjects = new Set<Id>();
  for (const factId of factIds) {
    const subject = factId === null ? null : (state.facts[factId]?.subjectId ?? null);
    if (subject !== null && subject !== actorId && subject !== option.targetId) subjects.add(subject);
  }
  return [...subjects].sort().map((characterId) => ({ characterId, role: 'subject' }));
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
  eavesdropping: boolean,
  facts: Record<string, unknown>,
  verification?: DialogueVerification,
): InteractionRecord {
  const target = option.targetId;
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
    // `verification` : verdict du vérificateur LLM (tentatives, raisons, repli, faits ignorés) ; absent hors dialogue LLM.
    classification: {
      category: def.category,
      catalogVersion: def.version,
      facts,
      ...(verification ? { verification: { ...verification } } : {}),
    },
    participants: [
      { characterId: actorId, role: eavesdropping ? 'eavesdropper' : 'speaker' },
      // La cible d'une écoute indiscrète ne s'adresse pas à l'écouteur : elle reste simple présente.
      ...(target === null
        ? []
        : [{ characterId: target, role: eavesdropping ? ('bystander' as const) : ('addressee' as const) }]),
      ...bystanderIds.filter((b) => b !== target).map((b) => ({ characterId: b, role: 'bystander' as const })),
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

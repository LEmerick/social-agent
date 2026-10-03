/**
 * Moteur de résolution : `(action, issue)` → event + effets appliqués (engine-architecture.md §9).
 * Fonction unique appelée par la boucle de ticks après l'issue (et le dialogue) ; elle modifie `state` uniquement
 * par `applyEffect`, hormis les métadonnées d'arête (connaissance, compteurs, étiquettes) et `dailyCounts`.
 */
import { DomainError } from '../core/errors.js';
import type { IdFactory } from '../core/id.js';
import type { ActionOption } from '../decision/ports.js';
import { chargeAction, costEffect } from '../economy/charge.js';
import { applyAndRecord, openEvent, type EventLink } from '../events/apply-record.js';
import { assertInCatalog } from '../rules/catalog.js';
import { assertAllowed, costRefusal, effectiveCost } from '../rules/options.js';
import type { SceneContext } from '../rules/types.js';
import { scoreEntriesFor } from '../scoring/scores.js';
import { defaultEdge, edge } from '../state/apply-effect.js';
import type {
  EffectInput,
  EffectRecord,
  EventParticipant,
  EventRecord,
  LedgerRecord,
  ScoreEntryRecord,
} from '../state/journal.js';
import { relKey, type Id, type RelationshipEdge, type SimState } from '../state/types.js';
import { promoteAcquaintance } from './acquaintance.js';
import { dailyCount, habituationFactor, habituationKey, HABITUATION_RULE, lastKey } from './habituation.js';
import { kitFor, type RuleCtx } from './kit.js';
import { ruleFor } from './table.js';

export interface ResolveInput {
  readonly option: ActionOption;
  readonly actorId: Id;
  /** Issue décidée par l'`OutcomeModel` (vocabulaire fermé de l'action). */
  readonly outcome: string;
  readonly sceneId?: Id | null;
  readonly interactionId?: Id | null;
  readonly locationId?: Id | null;
  /** Témoins de la scène (rôle `witness` dans l'event). */
  readonly witnessIds?: readonly Id[];
  readonly causedByEventId?: Id | null;
  /** Champs ajoutés au payload de l'event (provenance d'une confrontation…) ; ne remplacent jamais les champs de base. */
  readonly payload?: Readonly<Record<string, unknown>>;
  /** Participants supplémentaires de l'event (rôle `subject` d'un fait, par exemple). */
  readonly extraParticipants?: readonly EventParticipant[];
  /** Si fourni, les préconditions de l'action sont revérifiées avec ce contexte de scène. */
  readonly ctx?: SceneContext;
  /** Effets additionnels propres à la saison (par exemple sur des `extraAxes`), appliqués après les règles. */
  readonly extraEffects?: readonly EffectInput[];
  /** Remplace le prix en crédits du catalogue (prix d'un créneau). */
  readonly creditCost?: number;
}

export interface Resolution {
  readonly event: EventRecord;
  /** Effets appliqués, dans l'ordre : coûts, règle, effets additionnels. */
  readonly effects: EffectRecord[];
  /** Arêtes modifiées (copies, prêtes pour l'upsert de la projection). */
  readonly relationships: RelationshipEdge[];
  readonly ledger: LedgerRecord[];
  readonly scoreEntries: ScoreEntryRecord[];
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Étiquettes dérivées : `ally` si alliance ≥ 50, `rival` si rivalité ≥ 50. Les autres étiquettes sont conservées. */
export function refreshLabels(e: RelationshipEdge): void {
  const labels = e.labels.filter((l) => l !== 'ally' && l !== 'rival');
  if (e.alliance >= 50) labels.push('ally');
  if (e.rivalry >= 50) labels.push('rival');
  e.labels = labels;
}

/** Les actions cachées non détectées, les votes et les évitements ne comptent pas comme une rencontre. */
const isAwareInteraction = (action: string, hidden: boolean, outcome: string): boolean =>
  action !== 'avoid' && action !== 'cast_vote' && (!hidden || outcome === 'detected');

export function resolveInteraction(state: SimState, input: ResolveInput, ids: IdFactory): Resolution {
  const { option, actorId, outcome } = input;
  const def = assertInCatalog(state, option.action);
  const rule = ruleFor(def.id, outcome);
  const actor = state.characters[actorId];
  if (!actor) throw new DomainError('NOT_FOUND', `Personnage ${actorId} absent du SimState`);

  if (input.ctx) assertAllowed(state, actorId, option, input.ctx);
  else {
    const refusal = costRefusal(state, actorId, option);
    if (refusal !== null) throw new DomainError('ACTION_REFUSED', `Action ${def.id} refusée (${refusal})`);
  }

  const withTarget = def.target === 'character' || (def.target === 'characters' && option.targetId !== null);
  const target = withTarget && option.targetId !== null ? state.characters[option.targetId] : undefined;
  if (withTarget && (!target || target.id === actorId)) {
    throw new DomainError('INVALID_TARGET', `Cible invalide pour ${def.id} : ${option.targetId ?? 'aucune'}`);
  }

  const event = openEvent(state, ids, null, {
    type: rule.eventType,
    importance: rule.importance,
    payload: {
      ...input.payload,
      action: def.id,
      outcome,
      targetId: option.targetId,
      factId: option.factId,
      itemId: option.itemId,
      locationId: option.locationId,
      ruleId: rule.id,
      ruleVersion: rule.version,
    },
    participants: [
      { characterId: actorId, role: 'actor' },
      ...(target ? [{ characterId: target.id, role: 'target' } as const] : []),
      ...(input.witnessIds ?? [])
        .filter((w) => w !== actorId && w !== target?.id)
        .map((w): EventParticipant => ({ characterId: w, role: 'witness' })),
      ...(input.extraParticipants ?? []).filter(
        (p) =>
          p.characterId !== actorId &&
          p.characterId !== target?.id &&
          !(input.witnessIds ?? []).includes(p.characterId),
      ),
    ],
    sceneId: input.sceneId ?? null,
    interactionId: input.interactionId ?? null,
    locationId: input.locationId ?? null,
    causedByEventId: input.causedByEventId ?? null,
  });
  const link: EventLink = { eventId: event.id, epochId: event.epochId, tick: event.tick };
  const effects: EffectRecord[] = [];

  // Coûts : énergie (`cost@1`, effet stat) puis crédits (ledger).
  const energy = effectiveCost(state, def).energy;
  if (energy !== 0) {
    effects.push(applyAndRecord(state, costEffect(actorId, 'stat', 'energy', -energy, def.id), link, ids));
  }
  const charge = chargeAction(state, actorId, option, link, ids, input.creditCost);
  effects.push(...charge.effects);

  // Règle, avec habituation : arêtes lues avant toute modification.
  const key = habituationKey(actorId, def.id, option.targetId);
  const count = dailyCount(state, key);
  const factor = habituationFactor(count);
  const ctx: RuleCtx = {
    state,
    option,
    a: actor,
    b: target ?? null,
    ab: target
      ? { ...(state.relationships[relKey(actorId, target.id)] ?? defaultEdge(actorId, target.id)) }
      : defaultEdge(actorId, actorId),
    ba: target
      ? { ...(state.relationships[relKey(target.id, actorId)] ?? defaultEdge(target.id, actorId)) }
      : defaultEdge(actorId, actorId),
  };
  const drafts = rule.effects(ctx, kitFor(ctx));
  const ruleEffects: EffectInput[] = drafts
    .map((d) => ({ ...d, delta: round2(d.delta * factor) }))
    .filter((d) => d.delta !== 0)
    .map((d) => ({
      ...d,
      ruleId: rule.id,
      ruleVersion: rule.version,
      reason: factor < 1 ? `${HABITUATION_RULE.id}@${String(HABITUATION_RULE.version)} x${String(factor)}` : null,
    }));
  for (const fx of [...ruleEffects, ...(input.extraEffects ?? [])]) {
    effects.push(applyAndRecord(state, fx, link, ids));
  }
  state.dailyCounts[key] = count + 1;
  if (option.targetId !== null) state.dailyCounts[lastKey(actorId, def.id, option.targetId)] = state.tick + 1;

  // Métadonnées d'arête : rencontre, compteurs, étiquettes.
  const touched = new Set<string>();
  for (const fx of effects) {
    if (fx.targetKind === 'relationship' && fx.otherCharacterId) {
      touched.add(relKey(fx.characterId, fx.otherCharacterId));
    }
  }
  if (target && isAwareInteraction(def.id, def.defaultVolume === 'hidden', outcome)) {
    for (const [from, to] of [
      [actorId, target.id],
      [target.id, actorId],
    ] as const) {
      const e = edge(state, from, to);
      e.interactionCount += 1;
      e.lastInteractionEventId = event.id;
      if (e.acquaintance === 'known_of') {
        e.acquaintance = 'met';
        e.firstMetEventId ??= event.id;
      }
      promoteAcquaintance(e);
      touched.add(relKey(from, to));
    }
  }
  const relationships = [...touched].sort().map((k) => {
    const e = state.relationships[k];
    if (!e) throw new DomainError('NOT_FOUND', `Arête ${k} absente après résolution`);
    refreshLabels(e);
    return structuredClone(e);
  });

  return {
    event,
    effects,
    relationships,
    ledger: charge.ledger,
    scoreEntries: scoreEntriesFor(state, effects, ids),
  };
}

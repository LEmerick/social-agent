/**
 * Règlement de fin d'époque : entretien journalier, ledger et machine d'état de survie
 * (engine-architecture.md §10) :
 *
 *   active ─(crédits < seuil)→ restricted ─(échéance dépassée)→ elimination_pending ─(règle de saison)→ eliminated
 *      ↑──────(crédits ≥ seuil : régularisation)──┘
 *
 * Une seule transition par personnage et par époque. Chaque transition est un event `status_changed` (règle
 * `survival@1`) accompagné d'effets (score `survival`, moral). Rien n'est implicite.
 */
import { DomainError } from '../core/errors.js';
import type { IdFactory } from '../core/id.js';
import { applyAndRecord, openEvent, type EventLink } from '../events/apply-record.js';
import { scoreEntriesFor } from '../scoring/scores.js';
import type { CharacterStatus } from '../ports/storage.js';
import type { EffectInput, EffectRecord, EventRecord, LedgerRecord, ScoreEntryRecord } from '../state/journal.js';
import type { CharacterNode, Id, SimState } from '../state/types.js';

export const UPKEEP_RULE = { id: 'upkeep', version: 1 } as const;
export const SURVIVAL_RULE = { id: 'survival', version: 1 } as const;

export interface SettleResult {
  readonly ledger: LedgerRecord[];
  readonly events: EventRecord[];
  readonly effects: EffectRecord[];
  readonly scoreEntries: ScoreEntryRecord[];
}

export interface SettleOptions {
  /**
   * Personnages à éliminer à ce règlement (décision de la règle de saison : cérémonie, vote…).
   * Chacun doit être en `elimination_pending`.
   */
  readonly eliminate?: readonly Id[];
}

type Transition = Exclude<CharacterStatus, 'paused'>;

const TRANSITION_IMPORTANCE: Readonly<Record<Transition, number>> = {
  active: 0.3,
  restricted: 0.5,
  elimination_pending: 0.8,
  eliminated: 1,
};

/** Effets d'une transition : (score `survival`, moral). */
const TRANSITION_EFFECTS: Readonly<Record<Transition, readonly [survival: number, morale: number]>> = {
  active: [2, 5],
  restricted: [-3, -5],
  elimination_pending: [-10, -10],
  eliminated: [-20, 0],
};

const survivalEffect = (
  c: CharacterNode,
  kind: 'score' | 'stat',
  dimension: string,
  delta: number,
  to: Transition,
): EffectInput => ({
  targetKind: kind,
  characterId: c.id,
  otherCharacterId: null,
  dimension,
  delta,
  ruleId: `${SURVIVAL_RULE.id}:${to}`,
  ruleVersion: SURVIVAL_RULE.version,
  reason: null,
});

/** Statut suivant, ou `null` si le personnage ne change pas de statut ce règlement. */
function nextStatus(
  state: Readonly<SimState>,
  c: Readonly<CharacterNode>,
  epochNumber: number,
  eliminate: ReadonlySet<Id>,
): Transition | null {
  const { restrictedThreshold, graceEpochs } = state.season.rules.economy;
  if (c.status === 'active') return c.credits < restrictedThreshold ? 'restricted' : null;
  if (c.status === 'restricted') {
    if (c.credits >= restrictedThreshold) return 'active';
    const since = c.restrictedSinceEpoch ?? epochNumber;
    return epochNumber - since >= graceEpochs ? 'elimination_pending' : null;
  }
  if (c.status === 'elimination_pending' && eliminate.has(c.id)) return 'eliminated';
  return null;
}

export function settleEpoch(
  state: SimState,
  epoch: { readonly id: Id; readonly number: number },
  ids: IdFactory,
  options: SettleOptions = {},
): SettleResult {
  const eliminate = new Set(options.eliminate ?? []);
  for (const id of eliminate) {
    if (state.characters[id]?.status !== 'elimination_pending') {
      throw new DomainError('INVALID_TRANSITION', `${id} doit être en elimination_pending pour être éliminé`);
    }
  }
  const { economy } = state.season.rules;
  const ledger: LedgerRecord[] = [];
  const events: EventRecord[] = [];
  const effects: EffectRecord[] = [];

  if (economy.enabled) {
    for (const c of Object.values(state.characters).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (c.status === 'eliminated' || c.status === 'paused') continue;

      if (economy.dailyUpkeep > 0) {
        const event = openEvent(state, ids, epoch.id, {
          type: 'upkeep_charged',
          importance: 0.05,
          payload: { amount: economy.dailyUpkeep, epochNumber: epoch.number },
          participants: [{ characterId: c.id, role: 'subject' }],
        });
        events.push(event);
        const link: EventLink = { eventId: event.id, epochId: epoch.id, tick: event.tick };
        effects.push(
          applyAndRecord(
            state,
            {
              targetKind: 'credit',
              characterId: c.id,
              otherCharacterId: null,
              dimension: 'credits',
              delta: -economy.dailyUpkeep,
              ruleId: UPKEEP_RULE.id,
              ruleVersion: UPKEEP_RULE.version,
              reason: null,
            },
            link,
            ids,
          ),
        );
        ledger.push({
          id: ids.next(),
          characterId: c.id,
          epochId: epoch.id,
          eventId: event.id,
          amount: -economy.dailyUpkeep,
          category: 'upkeep',
          source: 'system',
        });
      }

      const to = nextStatus(state, c, epoch.number, eliminate);
      if (to === null) continue;
      const from = c.status;
      const event = openEvent(state, ids, epoch.id, {
        type: 'status_changed',
        importance: TRANSITION_IMPORTANCE[to],
        payload: {
          characterId: c.id,
          from,
          to,
          rule: `${SURVIVAL_RULE.id}@${String(SURVIVAL_RULE.version)}`,
          credits: c.credits,
          threshold: economy.restrictedThreshold,
          epochNumber: epoch.number,
        },
        participants: [{ characterId: c.id, role: 'subject' }],
      });
      events.push(event);
      c.status = to;
      c.restrictedSinceEpoch = to === 'restricted' ? epoch.number : to === 'active' ? null : c.restrictedSinceEpoch;
      const link: EventLink = { eventId: event.id, epochId: epoch.id, tick: event.tick };
      const [survival, morale] = TRANSITION_EFFECTS[to];
      effects.push(applyAndRecord(state, survivalEffect(c, 'score', 'survival', survival, to), link, ids));
      if (morale !== 0) effects.push(applyAndRecord(state, survivalEffect(c, 'stat', 'morale', morale, to), link, ids));
    }
  }

  // Les compteurs d'habituation valent pour une journée (= une époque).
  state.dailyCounts = {};

  return { ledger, events, effects, scoreEntries: scoreEntriesFor(state, effects, ids) };
}

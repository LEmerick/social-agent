/**
 * Propagation des connaissances (phase 3.f). Les fonctions mutent `state.knowledge` et les agendas, et renvoient
 * les enregistrements à journaliser (`TickBatch.knowledge`). Aucun accès à la base ni au LLM.
 */
import { DomainError } from '../core/errors.js';
import type { IdFactory } from '../core/id.js';
import type { Listener } from '../scene/audience.js';
import { relOf } from '../rules/preconditions.js';
import type { Belief, FactNode, Id, KnowledgeEdge, KnowledgeSource, SimState } from '../state/types.js';
import { type AgendaAddition, deferredTell } from './deferred.js';
import { bestEdge } from './query.js';

/** Coefficient d'une écoute indiscrète : on croit un peu moins ce qu'on n'était pas censé entendre. */
export const OVERHEARD_FACTOR = 0.9;

/** Facteur de confiance : `f(trust) = 0,5 + trust / 200`, soit 0,5 (aucune confiance) à 1 (confiance totale). */
export const trustFactor = (trust: number): number => 0.5 + Math.min(100, Math.max(0, trust)) / 200;

/** `conf_reçue = conf_émetteur × f(trust(récepteur→émetteur))`, × 0,9 si indiscret. Bornée à [0, 1]. */
export function receivedConfidence(senderConfidence: number, trust: number, overheard = false): number {
  const c = senderConfidence * trustFactor(trust) * (overheard ? OVERHEARD_FACTOR : 1);
  return Math.min(1, Math.max(0, c));
}

/**
 * Croyance d'après la confiance du récepteur envers l'émetteur : ≥ 30 `believes`, ≥ 10 `doubts`, sinon
 * `disbelieves`. Une confiance reçue sous 0,35 fait au plus douter.
 */
export function beliefFor(trust: number, confidence: number): Belief {
  if (trust < 10) return 'disbelieves';
  if (trust < 30 || confidence < 0.35) return 'doubts';
  return 'believes';
}

/** Rôle d'un auditeur : destinataire (`told`), simple présent qui entend ou écoute aux portes (`overheard`). */
export type ListenerRole = 'addressee' | 'bystander' | 'eavesdropper';
export interface KnowledgeListener extends Listener {
  /** Défaut : `addressee`. */
  readonly role?: ListenerRole;
}

export interface SkippedLearning {
  readonly characterId: Id;
  readonly factId: Id;
  readonly reason: 'duplicate' | 'sees_only' | 'unknown_character' | 'is_sender';
}

export interface PropagationResult {
  readonly knowledge: KnowledgeEdge[];
  /** Intentions différées ajoutées aux agendas (déjà appliquées à `state`). */
  readonly agenda: AgendaAddition[];
  readonly skipped: SkippedLearning[];
}

export interface TransmitInput {
  readonly factIds: readonly Id[];
  readonly fromId: Id;
  readonly listeners: readonly KnowledgeListener[];
  readonly viaEventId: Id | null;
  readonly epoch: number;
  readonly tick: number;
}

export interface WitnessInput {
  readonly factIds: readonly Id[];
  readonly witnesses: readonly Listener[];
  readonly viaEventId: Id | null;
  readonly epoch: number;
  readonly tick: number;
}

interface Learning {
  readonly characterId: Id;
  readonly fact: FactNode;
  readonly sourceType: KnowledgeSource;
  readonly toldById: Id | null;
  readonly parent: KnowledgeEdge | undefined;
  readonly confidence: number;
  readonly belief: Belief;
}

const isDuplicate = (state: Readonly<SimState>, characterId: Id, factId: Id, viaEventId: Id | null): boolean =>
  Object.values(state.knowledge).some(
    (k) => k.characterId === characterId && k.factId === factId && k.viaEventId === viaEventId,
  );

function learn(
  state: SimState,
  l: Learning,
  when: Pick<TransmitInput, 'viaEventId' | 'epoch' | 'tick'>,
  ids: IdFactory,
  out: PropagationResult,
  peers: ReadonlySet<Id>,
): void {
  const edge: KnowledgeEdge = {
    id: ids.next(),
    characterId: l.characterId,
    factId: l.fact.id,
    sourceType: l.sourceType,
    toldById: l.toldById,
    viaEventId: when.viaEventId,
    parentKnowledgeId: l.parent?.id ?? null,
    learnedEpoch: when.epoch,
    learnedTick: when.tick,
    confidence: l.confidence,
    belief: l.belief,
  };
  state.knowledge[edge.id] = edge;
  out.knowledge.push(edge);
  const intention = deferredTell(state, l.characterId, l.fact, l.toldById, l.belief !== 'disbelieves', peers);
  if (intention) {
    state.characters[l.characterId]?.agenda.push(intention);
    out.agenda.push({ characterId: l.characterId, intention });
  }
}

/**
 * L'émetteur révèle des faits à des auditeurs. Atomique : si l'émetteur ne connaît pas l'un des faits,
 * lève `DomainError('UNKNOWN_FACT')` sans rien modifier (« un agent ne peut pas divulguer ce qu'il ne sait pas » ;
 * une invention passe par `createRumor`). L'émetteur peut transmettre un fait qu'il ne croit pas (mensonge, rumeur).
 *
 * - `hears` + `addressee` → `told` ; `hears` + `bystander`/`eavesdropper` → `overheard` ;
 * - `sees` n'apprend rien (il voit la scène, pas le contenu) ;
 * - confiance : voir `receivedConfidence`, avec la confiance du récepteur envers l'émetteur ;
 * - `parentKnowledgeId` = meilleure connaissance de l'émetteur ; pas de doublon (même personnage, fait, event) ;
 * - un fait sensible (≥ 2) crée une intention différée `tell` (voir `deferredTell`).
 */
export function transmit(state: SimState, input: TransmitInput, ids: IdFactory): PropagationResult {
  if (!state.characters[input.fromId])
    throw new DomainError('NOT_FOUND', `Émetteur ${input.fromId} absent du SimState`);
  const sent = input.factIds.map((factId) => {
    const fact = state.facts[factId];
    const parent = bestEdge(state, input.fromId, factId);
    if (!fact || !parent) {
      throw new DomainError(
        'UNKNOWN_FACT',
        `${input.fromId} ne connaît pas le fait ${factId} : il ne peut pas le révéler`,
      );
    }
    return { fact, parent };
  });

  const out: PropagationResult = { knowledge: [], agenda: [], skipped: [] };
  const peers = new Set([input.fromId, ...input.listeners.map((l) => l.characterId)]);
  for (const { fact, parent } of sent) {
    for (const listener of input.listeners) {
      const skip = (reason: SkippedLearning['reason']): void => {
        out.skipped.push({ characterId: listener.characterId, factId: fact.id, reason });
      };
      if (listener.characterId === input.fromId) skip('is_sender');
      else if (!state.characters[listener.characterId]) skip('unknown_character');
      else if (listener.perception !== 'hears') skip('sees_only');
      else if (isDuplicate(state, listener.characterId, fact.id, input.viaEventId)) skip('duplicate');
      else {
        const overheard = (listener.role ?? 'addressee') !== 'addressee';
        const trust = relOf(state, listener.characterId, input.fromId).trust;
        const confidence = receivedConfidence(parent.confidence, trust, overheard);
        learn(
          state,
          {
            characterId: listener.characterId,
            fact,
            sourceType: overheard ? 'overheard' : 'told',
            toldById: input.fromId,
            parent,
            confidence,
            belief: beliefFor(trust, confidence),
          },
          input,
          ids,
          out,
          peers,
        );
      }
    }
  }
  return out;
}

/**
 * Des témoins directs d'un événement : ceux qui l'entendent (`hears`) le connaissent (`witnessed`, confiance 1,
 * `believes`, sans parent) ; ceux qui ne font que le voir (`sees`) n'apprennent pas le contenu.
 * Les faits doivent exister (`DomainError('NOT_FOUND')` sinon).
 */
export function witness(state: SimState, input: WitnessInput, ids: IdFactory): PropagationResult {
  const facts = input.factIds.map((factId) => {
    const fact = state.facts[factId];
    if (!fact) throw new DomainError('NOT_FOUND', `Fait ${factId} absent du SimState`);
    return fact;
  });
  const out: PropagationResult = { knowledge: [], agenda: [], skipped: [] };
  const peers = new Set(input.witnesses.map((w) => w.characterId));
  for (const fact of facts) {
    for (const w of input.witnesses) {
      const skip = (reason: SkippedLearning['reason']): void => {
        out.skipped.push({ characterId: w.characterId, factId: fact.id, reason });
      };
      if (!state.characters[w.characterId]) skip('unknown_character');
      else if (w.perception !== 'hears') skip('sees_only');
      else if (isDuplicate(state, w.characterId, fact.id, input.viaEventId)) skip('duplicate');
      else {
        learn(
          state,
          {
            characterId: w.characterId,
            fact,
            sourceType: 'witnessed',
            toldById: null,
            parent: undefined,
            confidence: 1,
            belief: 'believes',
          },
          input,
          ids,
          out,
          peers,
        );
      }
    }
  }
  return out;
}

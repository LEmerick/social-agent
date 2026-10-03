/**
 * Propagation des connaissances d'une interaction (engine-architecture.md §6 phase 3.f, §7 `reveals`, §8).
 *
 * `screenReveals` (avant la résolution) vérifie ce que les énoncés prétendent révéler : un locuteur qui ne connaît pas
 * le fait ne le révèle pas. L'énoncé est conservé sans ce fait et l'ignoré est journalisé (`classification.facts.ignored`).
 * `propagateInteraction` (après la résolution, l'event existe) fait circuler les faits :
 *   1. fait créé par l'action : `notableFact` (vrai, vu et entendu par l'acteur, la cible et ceux qui entendent) ou,
 *      pour `spread_rumor` et `lie`, un fait faux (`createRumor`) transmis à la cible ;
 *   2. faits révélés (énoncés, plus le fait de `share_secret` / `confront` / `accuse`) : `transmit` aux auditeurs
 *      au volume de l'énoncé : `told` pour l'adressé, `overheard` pour un tiers qui entend, rien pour qui ne fait que voir ;
 *   3. l'issue `believed` / `doubted` / `disbelieved` de `share_secret`, `spread_rumor` et `lie` fixe la croyance du destinataire ;
 *   4. les intentions `tell` exécutées sont retirées de l'agenda de l'émetteur.
 * Tout est écrit dans le lot du tick (`batch.facts`, `batch.knowledge`), `via_event_id` = event de l'interaction.
 * `overhear` applique l'écoute indiscrète : sans détection, l'écouteur apprend ce que la cible a dit ou entendu ce tick.
 */
import type { TickContext } from '../epoch/types.js';
import type { ActionOption } from '../decision/ports.js';
import {
  type KnowledgeListener,
  type PropagationResult,
  bestEdge,
  clearExecutedTells,
  createFact,
  createRumor,
  falseFact,
  notableFact,
  transmit,
  witness,
} from '../knowledge/index.js';
import type { ActionDef } from '../rules/types.js';
import type { Listener } from '../scene/audience.js';
import type { EventRecord } from '../state/journal.js';
import type { Belief, Id } from '../state/types.js';
import type { UtteranceDraft } from './dialogue.js';

/** Actions dont le fait (`option.factId`) est dit à la cible. */
const FACT_ACTIONS: ReadonlySet<string> = new Set(['share_secret', 'confront', 'accuse']);
/** Actions où l'issue dit si la cible croit ce qu'on lui raconte. */
const BELIEF_ACTIONS: ReadonlySet<string> = new Set(['share_secret', 'spread_rumor', 'lie']);
const BELIEF_OF_OUTCOME: Readonly<Record<string, Belief>> = {
  believed: 'believes',
  doubted: 'doubts',
  disbelieved: 'disbelieves',
  detected: 'disbelieves',
};
const CONFRONTATIONS: ReadonlySet<string> = new Set(['confront', 'accuse']);

export interface Reveal {
  readonly speakerId: Id;
  readonly factIds: readonly Id[];
  readonly addresseeIds: readonly Id[];
  readonly volume: UtteranceDraft['volume'];
}

export interface IgnoredReveal {
  readonly factId: Id;
  readonly speakerId: Id;
  readonly reason: 'unknown_to_speaker';
}

export interface ScreenedReveals {
  /** Énoncés sans les faits que le locuteur ne connaît pas. */
  readonly utterances: UtteranceDraft[];
  readonly reveals: Reveal[];
  readonly ignored: IgnoredReveal[];
}

/** Ce qu'un personnage a dit ou entendu dire pendant ce tick dans la scène : la matière d'une écoute indiscrète. */
export interface Carry {
  readonly interactionId: Id;
  readonly eventId: Id;
  readonly speakerId: Id;
  readonly factIds: readonly Id[];
}
/** Scène → personnage → ce qu'il a porté ce tick. Recréé à chaque tick. */
export type CarryLog = Map<Id, Map<Id, Carry[]>>;

export interface LearnedSummary {
  readonly characterId: Id;
  readonly factId: Id;
  readonly source: string;
  readonly belief: Belief;
}

export interface PropagationReport {
  readonly created: Id[];
  readonly revealed: Id[];
  readonly learned: LearnedSummary[];
}

const unique = (ids: readonly Id[]): Id[] => [...new Set(ids)];

/** Vérifie les faits révélés : le locuteur doit les connaître (`bestEdge`). Les autres sont ignorés et rapportés. */
export function screenReveals(
  ctx: Pick<TickContext, 'state'>,
  actorId: Id,
  option: ActionOption,
  def: ActionDef,
  utterances: readonly UtteranceDraft[],
): ScreenedReveals {
  const { state } = ctx;
  const ignored: IgnoredReveal[] = [];
  const reveals: Reveal[] = [];
  const hidden = def.defaultVolume === 'hidden';
  const check = (speakerId: Id, factIds: readonly Id[]): Id[] =>
    unique(factIds).filter((factId) => {
      const known = state.facts[factId] !== undefined && bestEdge(state, speakerId, factId) !== undefined;
      if (!known) ignored.push({ factId, speakerId, reason: 'unknown_to_speaker' });
      return known;
    });

  const screened = utterances.map((u) => {
    const valid = check(u.speakerId, u.revealedFactIds);
    if (valid.length > 0 && !hidden) {
      reveals.push({ speakerId: u.speakerId, factIds: valid, addresseeIds: u.addresseeIds, volume: u.volume });
    }
    return { ...u, revealedFactIds: valid };
  });
  if (option.factId !== null && FACT_ACTIONS.has(def.id) && option.targetId !== null) {
    const valid = check(actorId, [option.factId]);
    const known = reveals.some((r) => r.speakerId === actorId && r.factIds.includes(option.factId ?? ''));
    if (valid.length > 0 && !known && !hidden) {
      reveals.push({ speakerId: actorId, factIds: valid, addresseeIds: [option.targetId], volume: def.defaultVolume });
    }
  }
  return { utterances: screened, reveals, ignored };
}

/** Fait dont l'event d'origine précède l'interaction : c'est lui qui la cause (`caused_by_event_id`). */
export function causeOf(ctx: Pick<TickContext, 'state'>, option: ActionOption, screened: ScreenedReveals): Id | null {
  const factId = option.factId ?? screened.reveals[0]?.factIds[0] ?? null;
  return factId === null ? null : (ctx.state.facts[factId]?.originEventId ?? null);
}

export interface PropagationArgs {
  readonly sceneId: Id;
  readonly interactionId: Id;
  readonly actorId: Id;
  readonly option: ActionOption;
  readonly def: ActionDef;
  readonly outcome: string;
  readonly event: EventRecord;
  /** Qui perçoit l'acteur (cible exclue), au volume de l'action ; vide pour une action cachée. */
  readonly heard: readonly Listener[];
  readonly screened: ScreenedReveals;
  readonly log: CarryLog;
}

export function propagateInteraction(ctx: TickContext, a: PropagationArgs): PropagationReport {
  const { state, batch } = ctx;
  const { actorId, option, def, outcome, event } = a;
  const targetId = option.targetId;
  const when = { viaEventId: event.id, epoch: ctx.epochNumber, tick: ctx.tick };
  const factIds = ctx.ids('fact');
  const knowledgeIds = ctx.ids('knowledge');
  const report: PropagationReport = { created: [], revealed: [], learned: [] };
  const carried: Id[] = [];

  const keep = (res: PropagationResult): void => {
    batch.knowledge.push(...res.knowledge);
    for (const k of res.knowledge) {
      report.learned.push({ characterId: k.characterId, factId: k.factId, source: k.sourceType, belief: k.belief });
    }
  };
  const hidden = def.defaultVolume === 'hidden';
  const bystanders: KnowledgeListener[] = a.heard.map((l) => ({ ...l, role: 'bystander' }));
  const addressee: KnowledgeListener[] =
    targetId === null || hidden ? [] : [{ characterId: targetId, perception: 'hears', role: 'addressee' }];
  const belief = BELIEF_ACTIONS.has(def.id) ? BELIEF_OF_OUTCOME[outcome] : undefined;

  // 1. Fait créé par l'interaction.
  if (targetId !== null && (def.id === 'spread_rumor' || def.id === 'lie')) {
    const { fact, knowledge } = createRumor(
      state,
      {
        ...falseFact(state, def.id, actorId, targetId, def.defaultVolume),
        originEventId: event.id,
        inventorId: actorId,
        epoch: ctx.epochNumber,
        tick: ctx.tick,
      },
      factIds,
    );
    batch.facts.push(fact);
    batch.knowledge.push(knowledge);
    report.created.push(fact.id);
    carried.push(fact.id);
    keep(
      transmit(
        state,
        {
          factIds: [fact.id],
          fromId: actorId,
          listeners: [...addressee, ...bystanders],
          ...when,
          ...(belief ? { addresseeBelief: belief } : {}),
        },
        knowledgeIds,
      ),
    );
  } else {
    const notable = notableFact(def.id, def.defaultVolume);
    if (notable) {
      const fact = createFact(
        state,
        {
          subjectId: actorId,
          predicate: notable.predicate,
          objectId: targetId,
          sensitivity: notable.sensitivity,
          originEventId: event.id,
        },
        factIds,
      );
      const seesTarget = targetId !== null && (!hidden || outcome === 'detected');
      const witnesses: Listener[] = [
        { characterId: actorId, perception: 'hears' },
        ...(seesTarget ? [{ characterId: targetId, perception: 'hears' as const }] : []),
        ...a.heard,
      ];
      batch.facts.push(fact);
      report.created.push(fact.id);
      carried.push(fact.id);
      keep(witness(state, { factIds: [fact.id], witnesses, ...when }, knowledgeIds));
    }
  }

  // 2-4. Faits révélés par les énoncés et par l'action.
  for (const r of a.screened.reveals) {
    const audience = ctx.audience(a.sceneId, r.speakerId, r.volume);
    const role = (l: Listener): KnowledgeListener => ({
      ...l,
      role: r.addresseeIds.includes(l.characterId) ? 'addressee' : 'bystander',
    });
    const own = r.speakerId === actorId;
    const confronted = own && CONFRONTATIONS.has(def.id) ? targetId : null;
    // Le confronté reçoit la provenance même s'il connaît déjà le fait : l'arête garde le chemin de l'accusateur.
    const heardBy = audience.map(role);
    const rest = heardBy.filter((l) => l.characterId !== confronted);
    const input = { factIds: r.factIds, fromId: r.speakerId, ...when };
    const extra = own && belief ? { addresseeBelief: belief } : {};
    keep(transmit(state, { ...input, listeners: rest, skipKnown: true, ...extra }, knowledgeIds));
    const direct = heardBy.filter((l) => l.characterId === confronted);
    if (direct.length > 0) keep(transmit(state, { ...input, listeners: direct }, knowledgeIds));
    for (const l of heardBy) {
      if (l.role === 'addressee') clearExecutedTells(state, r.speakerId, l.characterId, r.factIds);
    }
    report.revealed.push(...r.factIds);
    carried.push(...r.factIds);
  }

  const shared = unique(carried);
  if (shared.length > 0) {
    const scene = a.log.get(a.sceneId) ?? new Map<Id, Carry[]>();
    a.log.set(a.sceneId, scene);
    const carry: Carry = { interactionId: a.interactionId, eventId: event.id, speakerId: actorId, factIds: shared };
    for (const who of [actorId, ...(targetId === null ? [] : [targetId])])
      scene.set(who, [...(scene.get(who) ?? []), carry]);
  }
  return report;
}

/**
 * Écoute indiscrète : issue `undetected` ⇒ l'écouteur apprend (`overheard`) ce que la cible a dit ou entendu dire ce tick.
 * Issue `detected` ⇒ rien n'est appris (les effets de relation sont ceux de la règle `eavesdrop:detected`).
 */
export function overhear(
  ctx: TickContext,
  a: { sceneId: Id; eavesdropperId: Id; targetId: Id; outcome: string; event: EventRecord; log: CarryLog },
): LearnedSummary[] {
  if (a.outcome !== 'undetected') return [];
  const { state, batch } = ctx;
  const ids = ctx.ids('knowledge');
  const learned: LearnedSummary[] = [];
  const when = { viaEventId: a.event.id, epoch: ctx.epochNumber, tick: ctx.tick };
  for (const carry of a.log.get(a.sceneId)?.get(a.targetId) ?? []) {
    if (carry.speakerId === a.eavesdropperId) continue;
    const res = transmit(
      state,
      {
        factIds: carry.factIds.filter((f) => bestEdge(state, carry.speakerId, f) !== undefined),
        fromId: carry.speakerId,
        listeners: [{ characterId: a.eavesdropperId, perception: 'hears', role: 'eavesdropper' }],
        skipKnown: true,
        ...when,
      },
      ids,
    );
    batch.knowledge.push(...res.knowledge);
    for (const k of res.knowledge) {
      learned.push({ characterId: k.characterId, factId: k.factId, source: k.sourceType, belief: k.belief });
    }
  }
  return learned;
}

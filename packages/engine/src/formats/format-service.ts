/**
 * FormatService (game-formats.md §6, services.md §3.3) : charge et valide le format de saison, matérialise le
 * calendrier en `scheduled_event`, dit ce qui est dû à (époque, tick) — dates fixes et déclencheurs du DSL — et
 * déclenche un événement planifié (fusion des équipes, dépôt d'objet, attribution de mission) ou le laisse
 * à l'appelant (épreuve, conseil, repas, annonce, finale : ils demandent des scènes et des agents).
 */
import { DomainError } from '../core/errors.js';
import type { IdFactory } from '../core/id.js';
import type { Rng } from '../core/rng.js';
import type { StoragePort } from '../ports/storage.js';
import { formatOf, peekFormat, type ScheduledEventNode } from '../state/format-state.js';
import type { Id, KnowledgeEdge, SimState } from '../state/types.js';
import { createFact } from '../knowledge/facts.js';
import { evaluate } from './conditions/evaluate.js';
import { placeItem } from './inventory.js';
import { assignMission } from './missions.js';
import { emitEvent, emptyOutput, mergeOutput, type FormatContext, type FormatOutput } from './output.js';
import { parseSeasonFormat, type SeasonFormat } from './season-format.js';
import { mergeTeams } from './teams.js';

export interface FormatService {
  load(seasonId: Id): Promise<SeasonFormat>;
  due(epoch: number, tick: number, state: Readonly<SimState>): ScheduledEventNode[];
}

/** Lit `season.format`, le valide (préréglage compris) ; `DomainError('INVALID_FORMAT')` sinon. */
export function createFormatService(storage: StoragePort): FormatService {
  return {
    async load(seasonId) {
      const season = await storage.tx((s) => s.seasons.findById(seasonId));
      if (!season) throw new DomainError('NOT_FOUND', `Saison ${seasonId} introuvable`);
      return parseSeasonFormat(season.format);
    },
    due: dueEvents,
  };
}

/**
 * Matérialise le calendrier du format en événements planifiés : un par époque pour une périodicité (`every`),
 * un seul pour une date fixe ou un déclencheur sans date.
 */
export function expandSchedule(format: SeasonFormat, epochs: number, ids: IdFactory): ScheduledEventNode[] {
  const nodes: ScheduledEventNode[] = [];
  for (const spec of format.schedule) {
    const base = {
      kind: spec.kind,
      tickStart: spec.tick ?? null,
      tickEnd: spec.tickEnd ?? null,
      trigger: spec.trigger ?? null,
      locationId: null,
      participants: spec.participants,
      mandatory: spec.mandatory,
      announced: spec.announced,
      params: spec.params,
      firedEventId: null,
    };
    if (spec.every !== undefined) {
      const from = spec.from ?? 0;
      for (let epoch = from; epoch < epochs; epoch += spec.every) nodes.push({ id: ids.next(), epoch, ...base });
    } else {
      nodes.push({ id: ids.next(), epoch: spec.epoch ?? null, ...base });
    }
  }
  // Les missions à attribution planifiée deviennent des `mission_assign` (jamais annoncés : la mission est secrète).
  for (const m of format.missions) {
    if (!m.assign) continue;
    nodes.push({
      id: ids.next(),
      kind: 'mission_assign',
      epoch: m.assign.epoch ?? 0,
      tickStart: 0,
      tickEnd: null,
      trigger: null,
      locationId: null,
      participants: m.assign.to ? { characterSlugs: m.assign.to } : {},
      mandatory: true,
      announced: false,
      params: { mission: m.slug, ...(m.assign.random !== undefined ? { random: m.assign.random } : {}) },
      firedEventId: null,
    });
  }
  return nodes;
}

/**
 * Événements dus à (époque, tick), triés par date puis identifiant. Un événement à date fixe l'est au tick
 * `tickStart` de son époque (tick 0 si non précisé) ; un déclencheur seul l'est dès que la condition est vraie ;
 * date et déclencheur ensemble : à la date, si la condition est vraie. Un événement déjà déclenché ne revient pas.
 */
export function dueEvents(epoch: number, tick: number, state: Readonly<SimState>): ScheduledEventNode[] {
  return Object.values(peekFormat(state).scheduled)
    .filter((s) => {
      if (s.firedEventId !== null) return false;
      if (s.epoch !== null && s.epoch !== epoch) return false;
      const dated = s.epoch !== null || s.tickStart !== null;
      if (dated && tick !== (s.tickStart ?? 0)) return false;
      return s.trigger === null || evaluate(s.trigger, state, { epoch });
    })
    .sort(
      (a, b) => (a.epoch ?? -1) - (b.epoch ?? -1) || (a.tickStart ?? 0) - (b.tickStart ?? 0) || (a.id < b.id ? -1 : 1),
    );
}

/** Participants d'un événement : `characterIds`, `team`, sinon tous les personnages en jeu. */
export function participantsOf(state: Readonly<SimState>, s: ScheduledEventNode): Id[] {
  const p = s.participants;
  if (Array.isArray(p['characterIds'])) return (p['characterIds'] as Id[]).filter((id) => state.characters[id]).sort();
  if (typeof p['team'] === 'string') {
    const epoch = state.epoch?.number ?? 0;
    return peekFormat(state)
      .memberships.filter(
        (m) => m.teamId === p['team'] && m.fromEpoch <= epoch && (m.toEpoch === null || epoch <= m.toEpoch),
      )
      .map((m) => m.characterId)
      .sort();
  }
  return Object.values(state.characters)
    .filter((c) => c.status !== 'eliminated' && c.status !== 'paused')
    .map((c) => c.id)
    .sort();
}

/** Un événement `announced` est une connaissance publique chez tous ses participants (de quoi se préparer). */
export function announceScheduled(state: SimState, fc: FormatContext, s: ScheduledEventNode): FormatOutput {
  const out = emptyOutput();
  if (!s.announced) return out;
  const fact = createFact(
    state,
    { predicate: 'scheduled', objectText: `scheduled:${s.id}`, sensitivity: 0, originEventId: null },
    fc.ids,
  );
  out.facts.push(fact);
  for (const characterId of participantsOf(state, s)) {
    const edge: KnowledgeEdge = {
      id: fc.ids.next(),
      characterId,
      factId: fact.id,
      sourceType: 'public',
      toldById: null,
      viaEventId: null,
      parentKnowledgeId: null,
      learnedEpoch: fc.epoch,
      learnedTick: fc.tick,
      confidence: 1,
      belief: 'believes',
    };
    state.knowledge[edge.id] = edge;
    out.knowledge.push(edge);
  }
  return out;
}

export interface FireDeps {
  /** Tirages des dépôts et attributions aléatoires. */
  readonly rng: Rng;
}

export interface FireResult extends FormatOutput {
  readonly scheduled: ScheduledEventNode;
  /** Ce que le service a exécuté lui-même (`merge`, `item_drop`, `mission_assign`) ; vide sinon. */
  readonly dispatched: string[];
}

/**
 * Déclenche un événement planifié : événement `scheduled_fired`, `firedEventId` posé, puis l'effet propre au type
 * quand le service peut l'exécuter seul. Les autres types (épreuve, conseil, repas, annonce, finale, mélange)
 * sont exécutés par l'appelant, qui dispose des scènes et des agents.
 */
export function fireScheduled(state: SimState, fc: FormatContext, id: Id, deps: FireDeps): FireResult {
  const fs = formatOf(state);
  const s = fs.scheduled[id];
  if (!s) throw new DomainError('NOT_FOUND', `Événement planifié ${id} inconnu`);
  if (s.firedEventId !== null) throw new DomainError('ALREADY_FIRED', `Événement planifié ${id} déjà déclenché`);
  const out = emptyOutput();
  const event = emitEvent(state, fc, out, {
    type: 'scheduled_fired',
    locationId: s.locationId,
    importance: s.kind === 'council' || s.kind === 'final' || s.kind === 'merge' ? 0.7 : 0.4,
    payload: { scheduledEventId: s.id, kind: s.kind, mandatory: s.mandatory, params: s.params },
  });
  s.firedEventId = event.id;
  const dispatched: string[] = [];
  const cause = { causedByEventId: event.id };

  if (s.kind === 'merge') {
    const teams = Object.values(fs.teams).filter((t) => t.dissolvedEpoch === null);
    if (teams.length >= 2) {
      const slug = typeof s.params['slug'] === 'string' ? s.params['slug'] : 'merged';
      const name = typeof s.params['name'] === 'string' ? s.params['name'] : 'Fusion';
      mergeOutput(out, mergeTeams(state, fc, teams.map((t) => t.id).sort(), { slug, name }));
      dispatched.push('merge');
    }
  } else if (s.kind === 'item_drop' && typeof s.params['item'] === 'string') {
    const slug = s.params['item'];
    const def = Object.values(fs.itemDefs).find((d) => d.slug === slug);
    if (def) {
      const spots = Object.values(state.locations)
        .filter((l) => !l.isPrivate)
        .map((l) => l.id)
        .sort();
      const locationId =
        typeof s.params['locationId'] === 'string'
          ? s.params['locationId']
          : spots.length
            ? deps.rng.pick(spots)
            : null;
      if (locationId) {
        mergeOutput(
          out,
          placeItem(state, fc, {
            itemDefId: def.id,
            locationId,
            hidden: s.params['hidden'] !== false,
            ...(typeof s.params['difficulty'] === 'number' ? { difficulty: s.params['difficulty'] } : {}),
            ...cause,
          }),
        );
        dispatched.push('item_drop');
      }
    }
  } else if (s.kind === 'mission_assign' && typeof s.params['mission'] === 'string') {
    const slug = s.params['mission'];
    const def = Object.values(fs.missionDefs).find((d) => d.slug === slug);
    if (def) {
      const pool = participantsOf(state, s).filter(
        (c) => !Object.values(fs.assignments).some((a) => a.missionDefId === def.id && a.characterId === c),
      );
      const n = typeof s.params['random'] === 'number' ? Math.min(s.params['random'], pool.length) : pool.length;
      const chosen: Id[] = [];
      const left = [...pool];
      while (chosen.length < n) chosen.push(...left.splice(deps.rng.int(left.length), 1));
      for (const characterId of chosen.sort()) {
        mergeOutput(out, assignMission(state, fc, { missionDefId: def.id, to: { characterId }, ...cause }));
      }
      dispatched.push('mission_assign');
    }
  }
  return { ...out, scheduled: s, dispatched };
}

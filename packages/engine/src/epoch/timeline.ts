/**
 * Timeline d'une époque : où est chaque personnage, quelle scène est ouverte, quel segment de présence est ouvert.
 * Un segment couvre `[tickStart, tickEnd[` ; à chaque tick, chaque personnage en a exactement un.
 *
 * Mécanique d'un tick, dans l'ordre : `choosers` (qui doit choisir) → `move` (applique les choix, met à jour
 * `state.positions`) → `place` (formation des scènes, puis rapprochement des segments avec les positions).
 */
import { DomainError } from '../core/errors.js';
import type { IdFactory } from '../core/id.js';
import type { DestinationChoice } from '../decision/ports.js';
import { formScenes } from '../scene/formation.js';
import type { EpochJournal } from '../ports/storage.js';
import type { PresenceRecord, SceneRecord } from '../state/journal.js';
import { type TransitZones, lastLocationOf } from '../state/load-runtime.js';
import type { Id, Position, SimState } from '../state/types.js';
import { shortestRoute } from '../world/shortest-route.js';
import type { MutableTickBatch, SceneView } from './types.js';

/** Statuts qui mettent un personnage hors-jeu pour toute l'époque. */
const OFFSTAGE_STATUSES: ReadonlySet<string> = new Set(['eliminated', 'paused']);

export class Timeline {
  /** Scènes ouvertes, par identifiant. */
  readonly scenes = new Map<Id, SceneRecord>();
  /** Segment de présence ouvert de chaque personnage. */
  readonly presences = new Map<Id, PresenceRecord>();
  readonly transitZones: TransitZones;

  constructor(transitZones: TransitZones = new Map()) {
    this.transitZones = transitZones;
  }

  /** Reconstruit les scènes et segments ouverts d'une époque interrompue. */
  static restore(journal: EpochJournal, transitZones: TransitZones): Timeline {
    const timeline = new Timeline(transitZones);
    for (const scene of journal.scenes) if (scene.tickEnd === null) timeline.scenes.set(scene.id, scene);
    for (const presence of journal.presences) {
      if (presence.tickEnd === null) timeline.presences.set(presence.characterId, presence);
    }
    return timeline;
  }

  /** Personnages libres de choisir une destination (ni hors-jeu forcé, ni en trajet), triés par id. */
  choosers(state: Readonly<SimState>): Id[] {
    return sortedIds(state).filter((id) => {
      const status = state.characters[id]?.status ?? 'active';
      return !OFFSTAGE_STATUSES.has(status) && state.positions[id]?.kind !== 'transit';
    });
  }

  /**
   * Applique statuts, arrivées et choix de destination à `state.positions`.
   * - hors-jeu forcé (`eliminated`, `paused`) : `offstage` avec le statut pour motif ;
   * - trajet en cours : arrivée au tick prévu, dans la zone demandée au départ ;
   * - `go` depuis le hors-jeu : apparition directe au lieu choisi ; depuis un lieu : trajet de `travelTicks` ticks
   *   (`shortestRoute`) ; sans route, le personnage reste où il est ; `travelTicks <= 0` : arrivée immédiate.
   */
  move(state: SimState, tick: number, choices: ReadonlyMap<Id, DestinationChoice>): void {
    for (const id of sortedIds(state)) {
      const character = state.characters[id];
      const position = state.positions[id];
      if (!character || !position) continue;

      if (OFFSTAGE_STATUSES.has(character.status)) {
        if (position.kind !== 'offstage' || position.reason !== character.status) {
          state.positions[id] = {
            kind: 'offstage',
            reason: character.status,
            lastLocationId: lastLocationOf(position),
          };
          this.transitZones.delete(id);
        }
      } else if (position.kind === 'transit') {
        if (tick >= position.arrivalTick) {
          state.positions[id] = {
            kind: 'at',
            locationId: position.toLocationId,
            zoneId: this.transitZones.get(id) ?? null,
          };
          this.transitZones.delete(id);
        }
      } else {
        this.applyChoice(state, id, position, tick, choices.get(id) ?? { kind: 'stay' });
      }
    }
  }

  private applyChoice(state: SimState, id: Id, from: Position, tick: number, choice: DestinationChoice): void {
    if (choice.kind === 'stay') return;
    if (choice.kind === 'offstage') {
      if (from.kind !== 'offstage' || from.reason !== choice.reason) {
        state.positions[id] = { kind: 'offstage', reason: choice.reason, lastLocationId: lastLocationOf(from) };
      }
      return;
    }

    const target = state.locations[choice.locationId];
    if (!target) throw new DomainError('INVALID_DESTINATION', `Lieu inconnu ${choice.locationId} pour ${id}`);
    if (choice.zoneId !== null && !target.zones.some((z) => z.id === choice.zoneId)) {
      throw new DomainError('INVALID_DESTINATION', `Zone ${choice.zoneId} absente du lieu ${target.slug}`);
    }
    const arrival: Position = { kind: 'at', locationId: choice.locationId, zoneId: choice.zoneId };

    if (from.kind === 'offstage') {
      state.positions[id] = arrival;
    } else if (from.kind === 'at') {
      if (from.locationId === choice.locationId) {
        state.positions[id] = arrival;
        return;
      }
      const route = shortestRoute(state, from.locationId, choice.locationId);
      if (!route) return;
      if (route.travelTicks <= 0) {
        state.positions[id] = arrival;
      } else {
        state.positions[id] = {
          kind: 'transit',
          fromLocationId: from.locationId,
          toLocationId: choice.locationId,
          arrivalTick: tick + route.travelTicks,
        };
        this.transitZones.set(id, choice.zoneId);
      }
    }
  }

  /**
   * Forme les scènes puis fait coïncider les segments de présence avec les positions :
   * un segment est fermé (à `tick`) et un autre ouvert dès que le type, la scène, le rôle, le trajet ou le motif changent.
   */
  place(
    state: Readonly<SimState>,
    tick: number,
    epochId: Id,
    batch: MutableTickBatch,
    ids: { scene: IdFactory; presence: IdFactory },
  ): void {
    const formation = formScenes({
      state,
      epochId,
      tick,
      openScenes: [...this.scenes.values()],
      newId: () => ids.scene.next(),
    });
    for (const scene of formation.opened) {
      this.scenes.set(scene.id, scene);
      batch.scenesOpened.push(scene);
    }

    for (const id of sortedIds(state)) {
      const position = state.positions[id];
      if (!position) continue;
      const next = segmentOf(epochId, id, tick, position, formation.assignments.get(id));
      const current = this.presences.get(id);
      if (current && sameSegment(current, next)) continue;
      if (current) batch.presencesClosed.push({ id: current.id, tickEnd: tick });
      const opened = { ...next, id: ids.presence.next() };
      this.presences.set(id, opened);
      batch.presencesOpened.push(opened);
    }

    for (const sceneId of formation.closed) {
      batch.scenesClosed.push({ id: sceneId, tickEnd: tick });
      this.scenes.delete(sceneId);
    }
  }

  /** Fin d'époque : ferme tous les segments et toutes les scènes à `tick`. */
  closeAll(tick: number, batch: MutableTickBatch): void {
    for (const id of [...this.presences.keys()].sort()) {
      const presence = this.presences.get(id);
      if (presence) batch.presencesClosed.push({ id: presence.id, tickEnd: tick });
    }
    for (const id of [...this.scenes.keys()].sort()) batch.scenesClosed.push({ id, tickEnd: tick });
    this.presences.clear();
    this.scenes.clear();
  }

  /** Scènes ouvertes et leurs membres, triées par début puis identifiant. */
  views(state: Readonly<SimState>): SceneView[] {
    return [...this.scenes.values()]
      .sort((a, b) => a.tickStart - b.tickStart || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((scene) => ({
        scene,
        members: [...this.presences.values()]
          .filter((p) => p.sceneId === scene.id)
          .sort((a, b) => (a.characterId < b.characterId ? -1 : 1))
          .map((p) => {
            const position = state.positions[p.characterId];
            return {
              characterId: p.characterId,
              zoneId: position?.kind === 'at' ? position.zoneId : null,
              role: p.role === 'observer' ? 'observer' : 'participant',
            };
          }),
      }));
  }
}

export const sortedIds = (state: Pick<SimState, 'characters'>): Id[] => Object.keys(state.characters).sort();

type Segment = Omit<PresenceRecord, 'id'>;

function segmentOf(
  epochId: Id,
  characterId: Id,
  tickStart: number,
  position: Position,
  assignment: { sceneId: Id; role: 'participant' | 'observer' } | undefined,
): Segment {
  const base = {
    epochId,
    characterId,
    tickStart,
    tickEnd: null,
    sceneId: null,
    fromLocationId: null,
    toLocationId: null,
    offstageReason: null,
    role: null,
  };
  switch (position.kind) {
    case 'at':
      return { ...base, kind: 'scene', sceneId: assignment?.sceneId ?? null, role: assignment?.role ?? null };
    case 'transit':
      return { ...base, kind: 'transit', fromLocationId: position.fromLocationId, toLocationId: position.toLocationId };
    case 'offstage':
      return { ...base, kind: 'offstage', offstageReason: position.reason };
  }
}

const sameSegment = (a: Segment, b: Segment): boolean =>
  a.kind === b.kind &&
  a.sceneId === b.sceneId &&
  a.role === b.role &&
  a.fromLocationId === b.fromLocationId &&
  a.toLocationId === b.toLocationId &&
  a.offstageReason === b.offstageReason;

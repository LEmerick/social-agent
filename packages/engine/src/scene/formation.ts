/**
 * Formation des scènes (engine-architecture.md §5, phase 3b). Fonction pure : elle décide quelles scènes
 * ouvrir ou fermer et à quelle scène rattacher chaque personnage présent ; l'appelant écrit le journal.
 *
 * Une scène est une unité de co-présence : un lieu, une plage de ticks. Une arrivée ou un départ n'ouvre
 * ni ne ferme la scène (seul le segment de présence change) ; elle se ferme quand plus personne n'est dans le lieu.
 *
 * Zone d'une scène : fixée à son ouverture et jamais modifiée ensuite. C'est la zone du personnage présent
 * dont l'identifiant est le plus petit parmi ceux qui ouvrent la scène (`null` s'il n'est dans aucune zone).
 * Les autres rôles en découlent (`presenceRole`).
 */
import type { SceneRecord } from '../state/journal.js';
import type { Id, LocationNode, SimState } from '../state/types.js';

export type PresenceRole = 'participant' | 'observer';

export interface SceneAssignment {
  readonly sceneId: Id;
  readonly role: PresenceRole;
}

export interface SceneFormation {
  /** Scènes à ouvrir à ce tick (identifiants déjà attribués). */
  readonly opened: SceneRecord[];
  /** Scènes ouvertes qui n'ont plus personne : à fermer à ce tick. */
  readonly closed: Id[];
  /** Scène et rôle de chaque personnage présent dans un lieu. */
  readonly assignments: Map<Id, SceneAssignment>;
}

/** `participant` si le lieu n'a pas de zones ou si le personnage est dans la zone de la scène, sinon `observer`. */
export function presenceRole(
  location: LocationNode | undefined,
  sceneZoneId: Id | null,
  characterZoneId: Id | null,
): PresenceRole {
  if (!location || location.zones.length === 0) return 'participant';
  return sceneZoneId === characterZoneId ? 'participant' : 'observer';
}

export interface FormScenesInput {
  readonly state: Readonly<SimState>;
  readonly epochId: Id;
  readonly tick: number;
  /** Scènes actuellement ouvertes (tick précédent). */
  readonly openScenes: readonly SceneRecord[];
  /** Fabrique d'identifiants de scène ; appelée dans l'ordre (lieu, puis ouverture). */
  readonly newId: () => Id;
}

export function formScenes({ state, epochId, tick, openScenes, newId }: FormScenesInput): SceneFormation {
  const placed = new Map<Id, Id[]>();
  for (const characterId of Object.keys(state.characters).sort()) {
    const position = state.positions[characterId];
    if (position?.kind !== 'at') continue;
    const members = placed.get(position.locationId) ?? [];
    members.push(characterId);
    placed.set(position.locationId, members);
  }

  const kept = new Map<Id, SceneRecord>();
  for (const scene of [...openScenes].sort(byStartThenId)) {
    if (placed.has(scene.locationId) && !kept.has(scene.locationId)) kept.set(scene.locationId, scene);
  }

  const opened: SceneRecord[] = [];
  const assignments = new Map<Id, SceneAssignment>();
  for (const locationId of [...placed.keys()].sort()) {
    const members = placed.get(locationId) ?? [];
    let scene = kept.get(locationId);
    if (!scene) {
      const opener = state.positions[members[0] ?? ''];
      scene = {
        id: newId(),
        epochId,
        locationId,
        zoneId: opener?.kind === 'at' ? opener.zoneId : null,
        kind: 'free',
        tickStart: tick,
        tickEnd: null,
      };
      opened.push(scene);
    }
    for (const characterId of members) {
      const position = state.positions[characterId];
      const zoneId = position?.kind === 'at' ? position.zoneId : null;
      assignments.set(characterId, {
        sceneId: scene.id,
        role: presenceRole(state.locations[locationId], scene.zoneId, zoneId),
      });
    }
  }

  const keptIds = new Set([...kept.values()].map((s) => s.id));
  const closed = openScenes
    .filter((s) => !keptIds.has(s.id))
    .map((s) => s.id)
    .sort();
  return { opened, closed, assignments };
}

const byStartThenId = (a: SceneRecord, b: SceneRecord): number =>
  a.tickStart - b.tickStart || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

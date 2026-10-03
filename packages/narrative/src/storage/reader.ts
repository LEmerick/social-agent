import type { StoragePort } from '@ai-reality/engine';
import type { SimulationReader } from '../ports.js';

/**
 * Lecture seule de la simulation sur n'importe quel `StoragePort`. Seules des méthodes de lecture sont appelées ;
 * l'objet rendu n'expose aucun dépôt d'écriture.
 */
export function simulationReader(storage: StoragePort): SimulationReader {
  return {
    epoch: (epochId) => storage.tx((s) => s.epochs.findById(epochId)),
    journal: (epochId) => storage.tx((s) => s.journal.read(epochId)),
    eventsOfWorld: (worldId) => storage.tx((s) => s.journal.eventsOfWorld(worldId)),
    characters: (worldId) => storage.tx((s) => s.characters.listByWorld(worldId)),
    locations: (worldId) => storage.tx((s) => s.locations.listByWorld(worldId)),
    goals: (worldId) => storage.tx((s) => s.goals.listByWorld(worldId)),
    characterVisuals: (worldId) => storage.tx((s) => s.characterVisuals.listByWorld(worldId)),
  };
}

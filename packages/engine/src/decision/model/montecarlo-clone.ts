/**
 * Copie d'un `SimState` pour un rollout. Seules les parties que les règles pures modifient sont recopiées
 * (personnages, relations, compteurs du jour, connaissances, extensions) ; le monde, la saison, les lieux, les routes
 * et les faits sont partagés en lecture seule. Équivalent à `structuredClone` pour tout ce que le rollout peut écrire,
 * en bien moins cher (le chemin chaud du Monte Carlo : 500 rollouts en quelques dizaines de millisecondes).
 */
import type { CharacterNode, RelationshipEdge, SimState } from '../../state/types.js';

const cloneCharacter = (c: CharacterNode): CharacterNode => ({
  ...c,
  stats: { ...c.stats },
  mood: { ...c.mood },
  scores: { ...c.scores },
  goals: c.goals.map((g) => ({ ...g })),
  agenda: c.agenda.map((i) => ({ ...i })),
});

const cloneEdge = (e: RelationshipEdge): RelationshipEdge => ({
  ...e,
  extraAxes: { ...e.extraAxes },
  labels: [...e.labels],
});

export function cloneForRollout(state: Readonly<SimState>): SimState {
  const characters: SimState['characters'] = {};
  for (const [id, c] of Object.entries(state.characters)) characters[id] = cloneCharacter(c);
  const relationships: SimState['relationships'] = {};
  for (const [key, e] of Object.entries(state.relationships)) relationships[key] = cloneEdge(e);
  return {
    ...state,
    // Les règles exigent une époque ouverte pour dater les events ; une époque fictive suffit hors simulation.
    epoch: state.epoch ?? { id: 'rollout', number: -1 },
    characters,
    relationships,
    knowledge: { ...state.knowledge },
    facts: { ...state.facts },
    positions: { ...state.positions },
    dailyCounts: { ...state.dailyCounts },
    ext: Object.keys(state.ext).length === 0 ? {} : structuredClone(state.ext),
  };
}

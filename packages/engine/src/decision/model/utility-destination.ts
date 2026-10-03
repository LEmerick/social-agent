/**
 * Choix du lieu par fonction de score déterministe (decision-model.md §2.4), sans LLM ni tirage.
 *
 * Le personnage ne sait que ce qu'il a vu : un autre personnage est « là » s'il est dans le même lieu maintenant,
 * sinon au dernier lieu où l'acteur l'a vu (`locationId` de ses intentions d'agenda), sinon nulle part (inconnu).
 *
 *   score(lieu) = Σ intentions (talk_to, tell : +2 × priorité ; avoid : −2 × priorité) vers le lieu supposé de la cible
 *               + Σ alliés crus sur place (+0,8 × affinité)
 *               + attrait des gens présents (sociabilité) − répulsion des rivaux présents
 *               + rythme de la maison (haché sur graine, lieu, tranche de 8 ticks : le même pour tous, suivi selon la
 *                 sociabilité) + habitude personnelle (haché en plus sur le personnage)
 *               + inertie (rester) + repos (énergie basse ⇒ lieu privé) − 0,2 × durée du trajet
 */
import { Rng } from '../../core/rng.js';
import { shortestRoute } from '../../world/shortest-route.js';
import { relOf } from '../../rules/preconditions.js';
import type { DestinationChoice } from '../ports.js';
import type { Id, SimState } from '../../state/types.js';
import { affinity } from './utility.js';
import { weightsOf } from './weights.js';

export interface DestinationScore {
  readonly locationId: Id;
  readonly score: number;
}

const inGame = (state: Readonly<SimState>, id: Id): boolean => {
  const c = state.characters[id];
  return c !== undefined && c.status !== 'eliminated' && c.status !== 'paused';
};

/** Lieu où `observerId` croit trouver `otherId` (voir l'en-tête), ou `null`. */
export function believedLocation(state: Readonly<SimState>, observerId: Id, otherId: Id): Id | null {
  const mine = state.positions[observerId];
  const theirs = state.positions[otherId];
  if (mine?.kind === 'at' && theirs?.kind === 'at' && mine.locationId === theirs.locationId) return theirs.locationId;
  const seen = state.characters[observerId]?.agenda.find((i) => i.targetId === otherId && i.locationId !== null);
  return seen?.locationId ?? null;
}

/** Scores de tous les lieux atteignables, du meilleur au moins bon (égalités : identifiant de lieu croissant). */
export function destinationScores(state: Readonly<SimState>, actorId: Id): DestinationScore[] {
  const actor = state.characters[actorId];
  const position = state.positions[actorId];
  if (!actor || !position) return [];
  const here = position.kind === 'at' ? position.locationId : null;
  const w = weightsOf(actor);
  const others = Object.keys(state.characters)
    .sort()
    .filter((id) => id !== actorId && inGame(state, id));
  const believed = new Map(others.map((id) => [id, believedLocation(state, actorId, id)]));
  const block = Math.floor(state.tick / 8);

  const scores: DestinationScore[] = [];
  for (const locationId of Object.keys(state.locations).sort()) {
    const travel = here === null || here === locationId ? 0 : shortestRoute(state, here, locationId)?.travelTicks;
    if (travel === undefined) continue; // aucune route
    const place = state.locations[locationId];
    let score = -0.2 * travel;
    if (here === locationId) score += 0.5;
    for (const i of actor.agenda) {
      if (i.targetId === null || believed.get(i.targetId) !== locationId) continue;
      if (i.kind === 'talk_to' || i.kind === 'tell') score += 2 * i.priority;
      else if (i.kind === 'avoid') score -= 2 * i.priority;
    }
    for (const id of others) {
      if (believed.get(id) !== locationId) continue;
      const e = relOf(state, actorId, id);
      const a = affinity(state, actorId, id);
      if (e.alliance >= 50 || e.trust >= 60) score += 0.8 * Math.max(a, 0.2);
      score += (w.socialInitiative - 0.5) * 0.4 + 0.3 * a - 0.5 * (e.rivalry / 100);
    }
    // Rythme de la maison (le même pour tous : on se retrouve où ça se passe), suivi selon la sociabilité,
    // et habitude personnelle (propre à chaque personnage). Les lieux privés n'attirent pas la vie commune.
    const rhythm = Rng.derive(state.world.seed, 'rhythm', locationId, block).next() * (place?.isPrivate ? 0.3 : 1);
    score += (0.4 + 0.8 * w.socialInitiative) * rhythm;
    score += 0.4 * Rng.derive(state.world.seed, 'habit', actorId, locationId, block).next();
    if (actor.stats.energy < 25 && place?.isPrivate) score += 1;
    scores.push({ locationId, score });
  }
  return scores.sort((a, b) => b.score - a.score || (a.locationId < b.locationId ? -1 : 1));
}

export function chooseDestinationByScore(state: Readonly<SimState>, actorId: Id): DestinationChoice {
  const best = destinationScores(state, actorId)[0];
  const position = state.positions[actorId];
  if (!best) return { kind: 'stay' };
  if (position?.kind === 'at' && position.locationId === best.locationId) return { kind: 'stay' };
  return { kind: 'go', locationId: best.locationId, zoneId: null };
}

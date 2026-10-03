/**
 * L'agenda au service de la décision : une intention `tell` (« raconter F à X ») se voit, se suit et se retire.
 *
 * - `refreshSightings` : quand le personnage et la cible d'une intention partagent une scène, `locationId` prend ce lieu.
 *   C'est le dernier lieu où le personnage a vu la cible, et la seule chose qu'il croit savoir de sa position ;
 * - `clearExecutedTells` : une intention exécutée (le fait a été raconté à la cible) est retirée de l'agenda ;
 * - `AgendaDecisionPolicy` : décore une politique de base. Choix d'action : l'option `share_secret` d'une intention
 *   exécutable passe avant le reste. Destination : aller au dernier lieu connu de la cible, rester si elle est là.
 *
 * Une intention est exécutable si le personnage connaît encore le fait, que la cible est en jeu et ne le connaît pas.
 */
import type { ActionOption, DecisionPolicy, DecisionResult, DestinationChoice } from '../decision/ports.js';
import type { SceneView } from '../epoch/types.js';
import type { Id, Intention, SimState } from '../state/types.js';
import { knows } from './query.js';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Intentions `tell` exécutables, par priorité décroissante (à égalité : cible puis fait, pour rester déterministe). */
export function pendingTells(state: Readonly<SimState>, characterId: Id): Intention[] {
  const agenda = state.characters[characterId]?.agenda ?? [];
  return agenda
    .filter((i) => {
      if (i.kind !== 'tell' || i.targetId === null || i.factId === null) return false;
      const target = state.characters[i.targetId];
      const inGame = target !== undefined && target.status !== 'eliminated' && target.status !== 'paused';
      return inGame && knows(state, characterId, i.factId) && !knows(state, i.targetId, i.factId);
    })
    .sort(
      (a, b) =>
        b.priority - a.priority || cmp(a.targetId ?? '', b.targetId ?? '') || cmp(a.factId ?? '', b.factId ?? ''),
    );
}

/** Met à jour le dernier lieu connu de la cible des intentions `tell` quand elle est dans la scène du personnage. */
export function refreshSightings(state: SimState, views: readonly SceneView[]): void {
  for (const view of views) {
    const present = new Set(view.members.map((m) => m.characterId));
    for (const member of view.members) {
      const agenda = state.characters[member.characterId]?.agenda;
      if (!agenda) continue;
      agenda.forEach((i, at) => {
        if (
          i.kind === 'tell' &&
          i.targetId !== null &&
          present.has(i.targetId) &&
          i.locationId !== view.scene.locationId
        ) {
          agenda[at] = { ...i, locationId: view.scene.locationId };
        }
      });
    }
  }
}

/** Retire de l'agenda de `tellerId` les intentions de raconter ces faits à cette cible : elles sont exécutées. */
export function clearExecutedTells(state: SimState, tellerId: Id, targetId: Id, factIds: readonly Id[]): void {
  const teller = state.characters[tellerId];
  if (!teller) return;
  teller.agenda = teller.agenda.filter(
    (i) => !(i.kind === 'tell' && i.targetId === targetId && i.factId !== null && factIds.includes(i.factId)),
  );
}

export const AGENDA_POLICY = 'agenda@1';

export interface AgendaPolicyOptions {
  /** Priorité minimale pour exécuter une intention (défaut 0 : toute intention exécutable). */
  readonly minPriority?: number;
  /** `true` : l'intention est exécutée avec la probabilité `priority` (tirage du `Rng` fourni, tracé dans `rngDraw`). */
  readonly stochastic?: boolean;
}

export class AgendaDecisionPolicy implements DecisionPolicy {
  readonly #base: DecisionPolicy;
  readonly #min: number;
  readonly #stochastic: boolean;

  constructor(base: DecisionPolicy, options: AgendaPolicyOptions = {}) {
    this.#base = base;
    this.#min = options.minPriority ?? 0;
    this.#stochastic = options.stochastic ?? false;
  }

  choose(input: Parameters<DecisionPolicy['choose']>[0]): Promise<DecisionResult> {
    for (const tell of pendingTells(input.state, input.actorId)) {
      if (tell.priority < this.#min) continue;
      const chosen: ActionOption | undefined = input.options.find(
        (o) => o.action === 'share_secret' && o.targetId === tell.targetId && o.factId === tell.factId,
      );
      if (!chosen) continue;
      if (!this.#stochastic) return Promise.resolve({ chosen, rngDraw: null, policy: AGENDA_POLICY });
      const draw = input.rng.next();
      if (draw < tell.priority) return Promise.resolve({ chosen, rngDraw: draw, policy: AGENDA_POLICY });
    }
    return this.#base.choose(input);
  }

  chooseDestination(input: Parameters<DecisionPolicy['chooseDestination']>[0]): Promise<DestinationChoice> {
    const { state, actorId } = input;
    const position = state.positions[actorId];
    const here = position?.kind === 'at' ? position.locationId : null;
    for (const tell of pendingTells(state, actorId)) {
      if (tell.priority < this.#min || tell.locationId === null) continue;
      if (tell.locationId !== here) return Promise.resolve({ kind: 'go', locationId: tell.locationId, zoneId: null });
      // Sur place : on attend la cible tant qu'elle est là. Sinon le lieu est périmé et la politique de base reprend.
      const targetAt = tell.targetId === null ? undefined : state.positions[tell.targetId];
      if (targetAt?.kind === 'at' && targetAt.locationId === here) return Promise.resolve({ kind: 'stay' });
    }
    return this.#base.chooseDestination(input);
  }
}

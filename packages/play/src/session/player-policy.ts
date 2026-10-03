/**
 * Le joueur comme politique de décision (action-catalog.md §5, mode directif) et comme juge d’issue quand il est ciblé.
 *
 * Le moteur n’a pas de notion de « réponse externe » : ces politiques posent une question via un `Prompter`
 * (une promesse résolue par `session.answer`) et rendent le choix du joueur. Elles ne tirent aucun nombre au hasard
 * (`rngDraw: null`) et ne modifient jamais l’état. Elles vivent dans `play` pour garder le moteur intact.
 */
import {
  type ActionOption,
  type DecisionPolicy,
  type DecisionResult,
  type DestinationChoice,
  DomainError,
  type Id,
  type OutcomeModel,
  type OutcomeResult,
  type SimState,
  actionDef,
  shortestRoute,
} from '@ai-reality/engine';
import { OUTCOME_CHOICE, narrate, nameOf, optionGroup, optionLabel } from './fr.js';
import type { PlayRequestKind } from './types.js';

export const PLAYER_POLICY = 'player';

export interface Choice<T> {
  readonly label: string;
  readonly group?: string;
  readonly value: T;
}

/** Pose une question au joueur et attend sa réponse. */
export interface Prompter {
  ask<T>(question: {
    readonly kind: PlayRequestKind;
    readonly prompt: string;
    readonly choices: readonly Choice<T>[];
  }): Promise<T>;
}

const byName = (state: Readonly<SimState>) => (a: Id, b: Id) =>
  nameOf(state, a).localeCompare(nameOf(state, b), 'fr') || (a < b ? -1 : 1);

export class PlayerDecisionPolicy implements DecisionPolicy {
  readonly #playerId: Id;
  readonly #prompter: Prompter;

  constructor(playerId: Id, prompter: Prompter) {
    this.#playerId = playerId;
    this.#prompter = prompter;
  }

  async choose(input: Parameters<DecisionPolicy['choose']>[0]): Promise<DecisionResult> {
    this.#assertPlayer(input.actorId);
    const { state, options } = input;
    const ordered = [...options].sort(
      (a, b) => Number(a.targetId !== null) - Number(b.targetId !== null) || compareTargets(state, a, b),
    );
    const choices: Choice<ActionOption | null>[] = [
      { label: 'Ne rien faire', group: 'Seul', value: null },
      ...ordered.map((o) => ({ label: optionLabel(state, o), group: optionGroup(state, o), value: o })),
    ];
    const chosen = await this.#prompter.ask({ kind: 'action', prompt: 'Que fais-tu ?', choices });
    return { chosen, rngDraw: null, policy: PLAYER_POLICY };
  }

  async chooseDestination(input: Parameters<DecisionPolicy['chooseDestination']>[0]): Promise<DestinationChoice> {
    this.#assertPlayer(input.actorId);
    const { state } = input;
    const position = state.positions[input.actorId];
    const here = position?.kind === 'at' ? position : null;
    const minutes = state.world.config.tickMinutes;

    const stay: Choice<DestinationChoice> = {
      label: here ? `Rester ici (${state.locations[here.locationId]?.name ?? '?'})` : 'Rester à l’écart',
      value: { kind: 'stay' },
    };
    // Hors-champ, rester n’a pas d’intérêt : les lieux passent d’abord.
    const choices: Choice<DestinationChoice>[] = here ? [stay] : [];
    const locations = Object.values(state.locations).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    for (const loc of locations) {
      const sameLocation = here?.locationId === loc.id;
      const route = here && !sameLocation ? shortestRoute(state, here.locationId, loc.id) : undefined;
      if (here && !sameLocation && !route) continue;
      const trip = route && route.travelTicks > 0 ? ` (${String(route.travelTicks * minutes)} min)` : '';
      if (!sameLocation) choices.push({ label: `Aller : ${loc.name}${trip}`, value: go(loc.id, null) });
      for (const zone of loc.zones) {
        if (sameLocation && here.zoneId === zone.id) continue;
        choices.push({
          label: `Aller : ${loc.name}, ${zone.slug.replaceAll('_', ' ')}${trip}`,
          value: go(loc.id, zone.id),
        });
      }
    }
    if (here) choices.push({ label: 'Se retirer pour dormir', value: { kind: 'offstage', reason: 'sleep' } });
    else choices.push(stay);
    const chosen = await this.#prompter.ask({ kind: 'destination', prompt: 'Où vas-tu ?', choices });
    return chosen;
  }

  #assertPlayer(actorId: Id): void {
    if (actorId !== this.#playerId) {
      throw new DomainError('INVALID_ACTOR', `PlayerDecisionPolicy ne décide que pour le joueur (reçu ${actorId})`);
    }
  }
}

const go = (locationId: Id, zoneId: Id | null): DestinationChoice => ({ kind: 'go', locationId, zoneId });

function compareTargets(state: Readonly<SimState>, a: ActionOption, b: ActionOption): number {
  if (a.targetId === null || b.targetId === null) return 0;
  return byName(state)(a.targetId, b.targetId);
}

/**
 * Quand le joueur est la cible d’une action de quelqu’un d’autre, il choisit l’issue parmi celles de l’action.
 * Pas de question pour une action secrète (le joueur ne sait pas qu’il est visé) ni quand l’issue est unique :
 * on délègue alors à `inner`. Une action de l’acteur-joueur est elle aussi résolue par `inner`.
 */
export class PlayerOutcomeModel implements OutcomeModel {
  readonly #playerId: Id;
  readonly #prompter: Prompter;
  readonly #inner: OutcomeModel;

  constructor(playerId: Id, prompter: Prompter, inner: OutcomeModel) {
    this.#playerId = playerId;
    this.#prompter = prompter;
    this.#inner = inner;
  }

  async resolve(input: Parameters<OutcomeModel['resolve']>[0]): Promise<OutcomeResult> {
    const { option, actorId, state } = input;
    const def = actionDef(option.action);
    const asked =
      option.targetId === this.#playerId &&
      actorId !== this.#playerId &&
      def !== undefined &&
      def.defaultVolume !== 'hidden' &&
      def.outcomes.length > 1;
    if (!asked) return this.#inner.resolve(input);

    const choices: Choice<string>[] = def.outcomes.map((o) => ({ label: OUTCOME_CHOICE[o] ?? o, value: o }));
    const prompt = `${narrate(state, this.#playerId, option.action, actorId, option.targetId, null).replace(/\.$/, '')}. Comment réagis-tu ?`;
    const outcome = await this.#prompter.ask({ kind: 'outcome', prompt, choices });
    return { outcome, rngDraw: null, policy: PLAYER_POLICY };
  }
}

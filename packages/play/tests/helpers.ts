/** Outils des tests : joueur scripté qui répond automatiquement aux demandes de la session. */
import {
  type ActionOption,
  type DecisionPolicy,
  type DestinationChoice,
  type Id,
  ScriptedDecisionPolicy,
} from '@ai-reality/engine';
import { IDS } from '@ai-reality/testkit';
import type { EpochSummary, PlayRequest, PlaySession } from '../src/index.js';

export const C = IDS.characters;
export const L = IDS.locations;

export type Pick = (request: PlayRequest, step: number) => number;

export interface Played {
  readonly requests: PlayRequest[];
  readonly summary: EpochSummary;
}

/** Joue jusqu’à la fin de l’époque en répondant avec `pick` ; échoue si la partie ne s’arrête pas. */
export async function playEpoch(session: PlaySession, pick: Pick, maxSteps = 2000): Promise<Played> {
  const requests: PlayRequest[] = [];
  for (let step = 0; step < maxSteps; step++) {
    const signal = await session.next();
    if (signal.kind === 'epoch_end') return { requests, summary: signal.summary };
    requests.push(signal.request);
    session.answer(signal.request.id, pick(signal.request, step));
  }
  throw new Error('L’époque ne se termine pas');
}

const find = (r: PlayRequest, text: string): number | undefined => r.options.find((o) => o.label.includes(text))?.n;

/** Va au Salon, puis tente une action sociale quand il y en a une (rotation sur les options), sinon ne fait rien. */
export const sociable: Pick = (r, step) => {
  if (r.kind === 'destination') return find(r, 'Aller : Salon') ?? find(r, 'Rester ici') ?? 1;
  if (r.kind === 'outcome') return 1 + (step % r.options.length);
  const choices = r.options.filter((o) => o.n > 1);
  return choices.length === 0 ? 1 : (choices[step % choices.length]?.n ?? 1);
};

/** Ne rien faire / rester sur place (1 = première option, qui est toujours « rester » ou « ne rien faire » hors-champ exclu). */
export const passive: Pick = (r) => (r.kind === 'destination' ? (find(r, 'Aller : Salon') ?? 1) : 1);

export const option = (action: string, targetId: Id | null = null): ActionOption => ({
  action,
  targetId,
  factId: null,
  itemId: null,
  locationId: null,
});

/** Les trois autres personnages vont au Salon à l’ouverture, puis suivent un script d’actions. */
export function scriptedNpcs(actions: Record<Id, Record<number, ActionOption>>, playerId: Id): DecisionPolicy {
  const toSalon: DestinationChoice = { kind: 'go', locationId: L.salon, zoneId: null };
  const destinations: Record<Id, Record<number, DestinationChoice>> = {};
  for (const id of Object.values(C)) if (id !== playerId) destinations[id] = { 0: toSalon };
  return new ScriptedDecisionPolicy({ destinations, actions });
}

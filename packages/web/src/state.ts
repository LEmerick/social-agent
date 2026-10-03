/** État de l'application et son réducteur (pur, testé sans navigateur). */
import type {
  EpochEnd,
  PlayClock,
  PlayEvent,
  PlayMap,
  PlayRequest,
  Player,
  PlayerKnowledge,
  PlayerRelation,
  PlayerStatus,
} from './types.js';

export type Screen = 'choose' | 'loading' | 'playing' | 'epoch_end' | 'failed';

export interface AppState {
  readonly screen: Screen;
  readonly sessionId: string | null;
  readonly player: Player | null;
  readonly map: PlayMap | null;
  readonly events: readonly PlayEvent[];
  readonly request: PlayRequest | null;
  readonly end: EpochEnd | null;
  readonly status: PlayerStatus | null;
  readonly clock: PlayClock | null;
  readonly relations: readonly PlayerRelation[];
  readonly knowledge: readonly PlayerKnowledge[];
  readonly error: string | null;
  /** Une réponse est partie et la suivante n'est pas encore arrivée. */
  readonly waiting: boolean;
}

export const initialState: AppState = {
  screen: 'choose',
  sessionId: null,
  player: null,
  map: null,
  events: [],
  request: null,
  end: null,
  status: null,
  clock: null,
  relations: [],
  knowledge: [],
  error: null,
  waiting: false,
};

export type Action =
  | { type: 'creating' }
  | { type: 'created'; sessionId: string; player: Player; map: PlayMap }
  | { type: 'hello'; player: Player; map: PlayMap }
  | { type: 'play'; event: PlayEvent }
  | { type: 'request'; request: PlayRequest }
  | { type: 'epoch_end'; end: EpochEnd }
  | { type: 'answering' }
  | { type: 'next_epoch' }
  | {
      type: 'snapshot';
      status: PlayerStatus;
      clock: PlayClock;
      relations: readonly PlayerRelation[];
      knowledge: readonly PlayerKnowledge[];
    }
  | { type: 'failed'; message: string }
  | { type: 'reset' };

/** Le fil est borné : l'interface n'a pas besoin de tout l'historique (le serveur le garde). */
export const MAX_EVENTS = 300;

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'creating':
      return { ...initialState, screen: 'loading' };
    case 'created':
      return {
        ...initialState,
        screen: 'loading',
        sessionId: action.sessionId,
        player: action.player,
        map: action.map,
      };
    case 'hello':
      return { ...state, player: action.player, map: action.map };
    case 'play': {
      // Rejouer un événement déjà vu (reconnexion) ne le duplique pas.
      const last = state.events[state.events.length - 1];
      if (last && action.event.seq <= last.seq) return state;
      const events = [...state.events, action.event];
      return { ...state, events: events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events };
    }
    case 'request':
      return { ...state, screen: 'playing', request: action.request, end: null, waiting: false, error: null };
    case 'epoch_end':
      return { ...state, screen: 'epoch_end', request: null, end: action.end, waiting: false };
    case 'answering':
      return { ...state, request: null, waiting: true };
    case 'next_epoch':
      return { ...state, screen: 'loading', end: null, waiting: true };
    case 'snapshot':
      return {
        ...state,
        status: action.status,
        clock: action.clock,
        relations: action.relations,
        knowledge: action.knowledge,
      };
    case 'failed':
      return {
        ...state,
        screen: state.sessionId === null ? 'choose' : 'failed',
        error: action.message,
        waiting: false,
      };
    case 'reset':
      return initialState;
  }
}

/** Numéro d'option pour une touche, ou null. Au-delà de 9 options, seules les saisies à deux chiffres comptent. */
export function optionForKeys(buffer: string, optionCount: number): { n: number | null; wait: boolean } {
  if (!/^\d+$/.test(buffer)) return { n: null, wait: false };
  const n = Number(buffer);
  if (n < 1) return { n: null, wait: false };
  if (n > optionCount) return { n: null, wait: false };
  // Un numéro encore prolongeable en un autre numéro valide (1 → 10..19) attend la touche suivante.
  const extendable = n * 10 <= optionCount;
  return extendable ? { n, wait: true } : { n, wait: false };
}

/** Pourcentage 0..100 d'une jauge. */
export const gauge = (value: number, min = 0, max = 100): number =>
  Math.round(((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100);

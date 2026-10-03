/** Client du serveur de jeu : `fetch` et `EventSource` injectables pour les tests. */
import type {
  Character,
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

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Created {
  readonly id: string;
  readonly player: Player;
  readonly map: PlayMap;
  readonly llm: boolean;
}

export interface StatusReply {
  readonly status: PlayerStatus;
  readonly clock: PlayClock;
  readonly map: PlayMap;
}

/** Messages du flux SSE, déjà décodés. */
export type ServerMessage =
  | { readonly type: 'hello'; readonly player: Player; readonly map: PlayMap }
  | { readonly type: 'play'; readonly event: PlayEvent }
  | { readonly type: 'request'; readonly request: PlayRequest }
  | { readonly type: 'epoch_end'; readonly end: EpochEnd }
  | { readonly type: 'error'; readonly message: string };

export function decodeMessage(name: string, raw: string): ServerMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  switch (name) {
    case 'hello':
      return { type: 'hello', ...(data as { player: Player; map: PlayMap }) };
    case 'play':
      return { type: 'play', event: data as PlayEvent };
    case 'request':
      return { type: 'request', request: data as PlayRequest };
    case 'epoch_end':
      return { type: 'epoch_end', end: data as EpochEnd };
    case 'error':
      return { type: 'error', message: (data as { message?: string }).message ?? 'Erreur du serveur' };
    default:
      return null;
  }
}

export interface EventSourceLike {
  addEventListener(name: string, listener: (e: { data: string }) => void): void;
  onerror: ((e: unknown) => void) | null;
  close(): void;
}

export interface Api {
  characters(): Promise<readonly Character[]>;
  create(character: string, seed?: string): Promise<Created>;
  answer(id: string, requestId: string, choice: number): Promise<void>;
  nextEpoch(id: string): Promise<void>;
  status(id: string): Promise<StatusReply>;
  relations(id: string): Promise<readonly PlayerRelation[]>;
  knowledge(id: string): Promise<readonly PlayerKnowledge[]>;
  subscribe(id: string, onMessage: (m: ServerMessage) => void, onClosed: () => void): () => void;
}

const EVENTS = ['hello', 'play', 'request', 'epoch_end', 'error'] as const;

export function createApi(
  fetcher: Fetch = (input, init) => fetch(input, init),
  makeSource: (url: string) => EventSourceLike = (url) => new EventSource(url) as unknown as EventSourceLike,
  base = '/api',
): Api {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetcher(`${base}${path}`, init);
    const text = await res.text();
    let body: unknown;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    if (!res.ok) {
      const message = (body as { error?: string } | null)?.error ?? `Erreur ${String(res.status)}`;
      throw new ApiError(res.status, message);
    }
    return body as T;
  }
  const post = (path: string, body: unknown): Promise<unknown> =>
    call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  return {
    characters: async () => (await call<{ characters: Character[] }>('/characters')).characters,
    create: (character, seed) => post('/session', { character, ...(seed ? { seed } : {}) }) as Promise<Created>,
    answer: async (id, requestId, choice) => {
      await post(`/session/${id}/answer`, { requestId, choice });
    },
    nextEpoch: async (id) => {
      await post(`/session/${id}/next-epoch`, {});
    },
    status: (id) => call<StatusReply>(`/session/${id}/status`),
    relations: async (id) => (await call<{ relations: PlayerRelation[] }>(`/session/${id}/relations`)).relations,
    knowledge: async (id) => (await call<{ knowledge: PlayerKnowledge[] }>(`/session/${id}/knowledge`)).knowledge,
    subscribe(id, onMessage, onClosed) {
      const source = makeSource(`${base}/session/${id}/events`);
      for (const name of EVENTS) {
        source.addEventListener(name, (e) => {
          const message = decodeMessage(name, e.data);
          if (message) onMessage(message);
        });
      }
      source.onerror = () => {
        onClosed();
      };
      return () => {
        source.close();
      };
    },
  };
}

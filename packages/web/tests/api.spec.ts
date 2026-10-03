import { describe, expect, it } from 'vitest';
import { ApiError, type EventSourceLike, type Fetch, createApi, decodeMessage } from '../src/api.js';

const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function recorder(responses: Record<string, () => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: Fetch = (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return Promise.resolve(responses[url]?.() ?? reply(404, { error: 'introuvable' }));
  };
  return { calls, fetcher };
}

describe('client d’API', () => {
  it('crée une session en envoyant personnage et graine', async () => {
    const created = {
      id: 's1',
      player: { id: 'p', slug: 'sarah', name: 'Sarah' },
      map: { locations: [], routes: [] },
      llm: false,
    };
    const { calls, fetcher } = recorder({ '/api/session': () => reply(201, created) });
    const api = createApi(fetcher);
    expect(await api.create('sarah', 'g')).toEqual(created);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ character: 'sarah', seed: 'g' });
    await api.create('lea');
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ character: 'lea' });
  });

  it('envoie une réponse et lève ApiError avec le message du serveur', async () => {
    const { calls, fetcher } = recorder({
      '/api/session/s1/answer': () => reply(400, { error: 'Réponse 9 hors de 1..4' }),
    });
    const api = createApi(fetcher);
    await expect(api.answer('s1', 'req-1', 9)).rejects.toMatchObject({
      status: 400,
      message: 'Réponse 9 hors de 1..4',
    });
    await expect(api.answer('s1', 'req-1', 9)).rejects.toBeInstanceOf(ApiError);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ requestId: 'req-1', choice: 9 });
  });

  it('lit personnages, relations et connaissances', async () => {
    const { fetcher } = recorder({
      '/api/characters': () => reply(200, { characters: [{ slug: 'sarah', name: 'Sarah' }] }),
      '/api/session/s1/relations': () => reply(200, { relations: [{ otherId: 'a', name: 'Alexandre' }] }),
      '/api/session/s1/knowledge': () => reply(200, { knowledge: [] }),
    });
    const api = createApi(fetcher);
    expect(await api.characters()).toEqual([{ slug: 'sarah', name: 'Sarah' }]);
    expect((await api.relations('s1'))[0]?.name).toBe('Alexandre');
    expect(await api.knowledge('s1')).toEqual([]);
  });

  it('s’abonne au flux et décode les messages', () => {
    const listeners = new Map<string, (e: { data: string }) => void>();
    let closed = false;
    const source: EventSourceLike = {
      addEventListener: (name, l) => void listeners.set(name, l),
      onerror: null,
      close: () => {
        closed = true;
      },
    };
    const urls: string[] = [];
    const api = createApi(undefined, (url) => (urls.push(url), source));
    const got: string[] = [];
    let ended = 0;
    const stop = api.subscribe(
      's1',
      (m) => got.push(m.type),
      () => ended++,
    );
    expect(urls).toEqual(['/api/session/s1/events']);
    listeners.get('play')?.({ data: JSON.stringify({ seq: 0 }) });
    listeners.get('request')?.({ data: JSON.stringify({ id: 'req-1' }) });
    listeners.get('epoch_end')?.({ data: 'pas du json' });
    expect(got).toEqual(['play', 'request']);
    source.onerror?.(new Error('coupé'));
    expect(ended).toBe(1);
    stop();
    expect(closed).toBe(true);
  });

  it('décode les messages connus et ignore les autres', () => {
    expect(decodeMessage('error', '{"message":"boum"}')).toEqual({ type: 'error', message: 'boum' });
    expect(decodeMessage('hello', '{"player":{"name":"S"},"map":{}}')).toMatchObject({ type: 'hello' });
    expect(decodeMessage('inconnu', '{}')).toBeNull();
  });
});

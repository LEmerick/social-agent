import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createPlayServer } from '../src/index.js';

interface Sse {
  readonly event: string;
  readonly data: unknown;
  readonly id: string | null;
}

/** Lecteur SSE minimal sur `fetch`. */
async function openEvents(base: string, id: string, lastEventId?: string) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/session/${id}/events`, {
    signal: controller.signal,
    headers: lastEventId === undefined ? {} : { 'last-event-id': lastEventId },
  });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body?.getReader();
  if (!reader) throw new Error('pas de flux');
  const decoder = new TextDecoder();
  let buffer = '';
  const queue: Sse[] = [];
  const pull = async (): Promise<void> => {
    const { value, done } = await reader.read();
    if (done) throw new Error('flux terminé');
    buffer += decoder.decode(value, { stream: true });
    for (let i = buffer.indexOf('\n\n'); i >= 0; i = buffer.indexOf('\n\n')) {
      const block = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const field = (name: string): string | null =>
        block
          .split('\n')
          .find((l) => l.startsWith(`${name}: `))
          ?.slice(name.length + 2) ?? null;
      queue.push({ event: field('event') ?? '', data: JSON.parse(field('data') ?? 'null'), id: field('id') });
    }
  };
  return {
    /** Prochain événement du type demandé (les autres sont conservés dans `seen`). */
    seen: [] as Sse[],
    async next(...kinds: string[]): Promise<Sse> {
      for (;;) {
        const e = queue.shift();
        if (e) {
          this.seen.push(e);
          if (kinds.includes(e.event)) return e;
        } else await pull();
      }
    },
    close: () => controller.abort(),
  };
}

describe('serveur de jeu', () => {
  const servers: ReturnType<typeof createPlayServer>[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) {
      s.closeAll();
      s.close();
    }
  });

  async function start() {
    const server = createPlayServer({ env: {} });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      });
    return { base, post };
  }

  it('liste les personnages et refuse une création invalide', async () => {
    const { base, post } = await start();
    const list = (await (await fetch(`${base}/api/characters`)).json()) as { characters: { slug: string }[] };
    expect(list.characters.map((c) => c.slug)).toEqual(['alexandre', 'sarah', 'lea', 'thomas']);
    expect((await post('/api/session', { character: 'zorro' })).status).toBe(400);
    expect((await post('/api/session', { character: 'sarah', epochs: 0 })).status).toBe(400);
    const bad = await fetch(`${base}/api/session`, { method: 'POST', body: '{pas du json' });
    expect(bad.status).toBe(400);
    expect((await fetch(`${base}/api/session/inconnue/status`)).status).toBe(404);
    expect((await fetch(`${base}/api/nimporte`)).status).toBe(404);
  });

  it('crée une session, diffuse la première demande en SSE et accepte une réponse', async () => {
    const { base, post } = await start();
    const created = await post('/api/session', { character: 'sarah', seed: 'srv' });
    expect(created.status).toBe(201);
    const { id, player, map } = (await created.json()) as {
      id: string;
      player: { name: string };
      map: { locations: { name: string }[] };
    };
    expect(player.name).toBe('Sarah');
    expect(map.locations.map((l) => l.name)).toContain('Salon');

    const events = await openEvents(base, id);
    const request = (await events.next('request')).data as {
      id: string;
      kind: string;
      options: { n: number; label: string }[];
    };
    expect(request.kind).toBe('destination');
    expect(events.seen[0]?.event).toBe('hello');

    const wrong = await post(`/api/session/${id}/answer`, { requestId: request.id, choice: 99 });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toMatch(/hors de/);
    expect((await post(`/api/session/${id}/answer`, { requestId: request.id })).status).toBe(400);

    const salon = request.options.find((o) => o.label === 'Aller : Salon');
    expect((await post(`/api/session/${id}/answer`, { requestId: request.id, choice: salon?.n })).status).toBe(200);
    const next = (await events.next('request')).data as { id: string; kind: string };
    expect(next.id).not.toBe(request.id);

    const status = (await (await fetch(`${base}/api/session/${id}/status`)).json()) as {
      status: { name: string; place: string };
      clock: { time: string };
    };
    expect(status.status.name).toBe('Sarah');
    expect(status.status.place).toBe('Salon');
    const rel = (await (await fetch(`${base}/api/session/${id}/relations`)).json()) as {
      relations: { name: string }[];
    };
    expect(rel.relations.map((r) => r.name)).toContain('Léa');
    const know = (await (await fetch(`${base}/api/session/${id}/knowledge`)).json()) as {
      knowledge: { text: string }[];
    };
    expect(know.knowledge[0]?.text).toContain('autre émission');
    const log = (await (await fetch(`${base}/api/session/${id}/log`)).json()) as { log: { kind: string }[] };
    expect(Array.isArray(log.log)).toBe(true);
    events.close();
  });

  it('joue une époque jusqu’au résumé, passe à la suivante, et rejoue l’historique à la reconnexion', async () => {
    const { base, post } = await start();
    const { id } = (await (await post('/api/session', { character: 'thomas', seed: 'srv2', epochs: 2 })).json()) as {
      id: string;
    };
    const events = await openEvents(base, id);
    for (;;) {
      const e = await events.next('request', 'epoch_end');
      if (e.event === 'epoch_end') {
        const end = e.data as { summary: { epoch: number; creditsBefore: number }; hasNext: boolean };
        expect(end.summary.epoch).toBe(0);
        expect(end.hasNext).toBe(true);
        break;
      }
      const r = e.data as { id: string };
      expect((await post(`/api/session/${id}/answer`, { requestId: r.id, choice: 1 })).status).toBe(200);
    }
    expect(events.seen.some((e) => e.event === 'play')).toBe(true);
    events.close();

    // Reconnexion : l’historique perçu est rejoué et la fin d’époque est toujours en attente.
    const again = await openEvents(base, id);
    const replayed = await again.next('epoch_end');
    expect(replayed.event).toBe('epoch_end');
    expect(again.seen.filter((e) => e.event === 'play').length).toBeGreaterThan(0);
    // Dernier id connu : rien à rejouer.
    const lastSeq = (await (await fetch(`${base}/api/session/${id}/log`)).json()) as { log: { seq: number }[] };
    again.close();
    const quiet = await openEvents(base, id, String(lastSeq.log.length - 1));
    await quiet.next('epoch_end');
    expect(quiet.seen.filter((e) => e.event === 'play')).toHaveLength(0);

    expect((await post(`/api/session/${id}/next-epoch`, {})).status).toBe(200);
    const second = await quiet.next('request');
    expect((second.data as { epoch: number }).epoch).toBe(1);
    expect((await post(`/api/session/${id}/next-epoch`, {})).status).toBe(409);
    quiet.close();
    expect((await fetch(`${base}/api/session/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await fetch(`${base}/api/session/${id}/status`)).status).toBe(404);
  }, 60_000);

  it('publie le lieu et les départs avant la demande du même tick, sur plusieurs ticks', async () => {
    const { base, post } = await start();
    const { id } = (await (await post('/api/session', { character: 'sarah', seed: 'srv3' })).json()) as { id: string };
    const events = await openEvents(base, id);
    const answerWith = async (label: string | null): Promise<{ kind: string; tick: number }> => {
      const r = (await events.next('request')).data as {
        id: string;
        kind: string;
        tick: number;
        options: { n: number; label: string }[];
      };
      const n = (label === null ? undefined : r.options.find((o) => o.label.startsWith(label))?.n) ?? 1;
      await post(`/api/session/${id}/answer`, { requestId: r.id, choice: n });
      return r;
    };
    const texts = (): string[] =>
      events.seen.filter((e) => e.event === 'play').map((e) => (e.data as { text: string }).text);

    await answerWith('Aller : Salon');
    // La demande d'action du tick 0 arrive : le lieu est déjà dans le fil.
    const first = await events.next('request');
    expect(texts().some((t) => t.startsWith('Lieu : Salon'))).toBe(true);
    await post(`/api/session/${id}/answer`, { requestId: (first.data as { id: string }).id, choice: 1 });

    // Puis Confessionnal : départ du Salon et arrivée annoncés avant la demande d'action de l'arrivée.
    for (let guard = 0; guard < 6 && !texts().some((t) => t.startsWith('Lieu : Confessionnal')); guard++) {
      const r = (await events.next('request')).data as {
        id: string;
        kind: string;
        options: { n: number; label: string }[];
      };
      const go =
        r.kind === 'destination' ? r.options.find((o) => o.label.startsWith('Aller : Confessionnal'))?.n : undefined;
      await post(`/api/session/${id}/answer`, { requestId: r.id, choice: go ?? 1 });
    }
    // Rien n'est encore passé à la demande suivante : le fil contient déjà tout ce que le joueur a vécu.
    const all = texts();
    expect(all.findIndex((t) => t.startsWith('Tu quittes : Salon'))).toBeGreaterThan(-1);
    expect(all.findIndex((t) => t.startsWith('Lieu : Confessionnal'))).toBeGreaterThan(
      all.findIndex((t) => t.startsWith('Tu quittes : Salon')),
    );
    events.close();
  });
});

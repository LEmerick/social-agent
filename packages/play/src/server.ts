#!/usr/bin/env node
/**
 * Serveur de jeu HTTP (node:http, sans dépendance) : une `PlaySession` par partie, flux SSE pour les demandes,
 * événements perçus et fins d'époque. Aucune logique de jeu ici : tout vient de `createPlaySession`.
 *
 *   POST /api/session                 { character, seed?, epochs? } → { id, player, map }
 *   GET  /api/session/:id/events      SSE : `play` (événement perçu), `request`, `epoch_end`, `error`
 *   POST /api/session/:id/answer      { requestId, choice }
 *   POST /api/session/:id/next-epoch  lance l'époque suivante après `epoch_end`
 *   GET  /api/session/:id/{status,relations,knowledge,log}   DELETE /api/session/:id
 */
import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import type { LLMPort } from '@ai-reality/engine';
import { anthropicLLM } from '@ai-reality/llm-anthropic';
import {
  PLAYABLE_CHARACTERS,
  type PlaySession,
  type PlaySessionOptions,
  type PlaySignal,
  createPlaySession,
} from './session/index.js';

export const DEFAULT_PORT = 4317;
const MAX_BODY = 64 * 1024;
const MAX_SESSIONS = 20;

export interface PlayServerOptions {
  readonly createSession?: (options: PlaySessionOptions) => Promise<PlaySession>;
  readonly llm?: LLMPort;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

interface Hosted {
  readonly session: PlaySession;
  readonly clients: Set<ServerResponse>;
  /** Dernière demande ou fin d'époque non encore traitée : rejouée aux nouveaux abonnés. */
  current: PlaySignal | null;
  failure: string | null;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Corps de requête trop gros');
    chunks.push(buf);
  }
  if (size === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('objet attendu');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Corps JSON invalide');
  }
}

const sse = (res: ServerResponse, event: string, data: unknown, id?: number): void => {
  if (res.writableEnded || res.destroyed) return;
  res.write(`${id === undefined ? '' : `id: ${String(id)}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export function createPlayServer(options: PlayServerOptions = {}): Server & { closeAll(): void } {
  const env = options.env ?? process.env;
  const create = options.createSession ?? createPlaySession;
  const key = env['ANTHROPIC_API_KEY'] ?? '';
  const llm = options.llm ?? (key === '' ? undefined : anthropicLLM({ apiKey: key }));
  const sessions = new Map<string, Hosted>();

  const broadcast = (h: Hosted, event: string, data: unknown, id?: number): void => {
    for (const client of h.clients) sse(client, event, data, id);
  };

  /** Lit les signaux du moteur et les diffuse ; s'arrête à une fin d'époque (reprise par `next-epoch`). */
  const pump = (h: Hosted): void => {
    void (async () => {
      try {
        for (;;) {
          const signal = await h.session.next();
          h.current = signal;
          broadcast(h, signal.kind, signal.kind === 'request' ? signal.request : signal);
          if (signal.kind === 'epoch_end') return;
        }
      } catch (error) {
        h.failure = error instanceof Error ? error.message : String(error);
        broadcast(h, 'error', { message: h.failure });
      }
    })();
  };

  const host = (id: string): Hosted => {
    const h = sessions.get(id);
    if (!h) throw new HttpError(404, `Session inconnue « ${id} »`);
    return h;
  };

  const drop = (id: string): void => {
    const h = sessions.get(id);
    if (!h) return;
    h.session.close();
    for (const c of h.clients) c.end();
    sessions.delete(id);
  };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter((p) => p !== '');
    const method = req.method ?? 'GET';
    if (parts[0] !== 'api') throw new HttpError(404, 'Introuvable');

    if (parts[1] === 'characters' && parts.length === 2 && method === 'GET') {
      json(res, 200, { characters: PLAYABLE_CHARACTERS });
      return;
    }
    if (parts[1] !== 'session') throw new HttpError(404, 'Introuvable');

    if (parts.length === 2) {
      if (method === 'GET') {
        json(res, 200, { characters: PLAYABLE_CHARACTERS, sessions: [...sessions.keys()] });
        return;
      }
      if (method !== 'POST') throw new HttpError(405, 'Méthode non autorisée');
      const body = await readBody(req);
      const character = body['character'];
      const seed = body['seed'];
      const epochs = body['epochs'];
      if (typeof character !== 'string' || !PLAYABLE_CHARACTERS.some((c) => c.slug === character)) {
        throw new HttpError(
          400,
          `Personnage invalide (choisir parmi : ${PLAYABLE_CHARACTERS.map((c) => c.slug).join(', ')})`,
        );
      }
      if (seed !== undefined && (typeof seed !== 'string' || seed.length > 100))
        throw new HttpError(400, 'Graine invalide');
      if (epochs !== undefined && (!Number.isInteger(epochs) || (epochs as number) < 1 || (epochs as number) > 30)) {
        throw new HttpError(400, 'Nombre d’époques invalide (1 à 30)');
      }
      if (sessions.size >= MAX_SESSIONS) {
        const oldest = sessions.keys().next().value;
        if (oldest !== undefined) drop(oldest);
      }
      const session = await create({
        characterSlug: character,
        epochs: (epochs as number | undefined) ?? 7,
        ...(seed === undefined ? {} : { seed }),
        ...(llm ? { llm } : {}),
      });
      const id = randomUUID();
      const h: Hosted = { session, clients: new Set(), current: null, failure: null };
      sessions.set(id, h);
      session.onEvent((e) => {
        broadcast(h, 'play', e, e.seq);
      });
      pump(h);
      json(res, 201, { id, player: session.player, map: session.map(), llm: llm !== undefined });
      return;
    }

    const id = parts[2] ?? '';
    const h = host(id);
    const action = parts[3] ?? '';

    if (parts.length === 3 && method === 'DELETE') {
      drop(id);
      json(res, 200, { ok: true });
      return;
    }
    if (parts.length !== 4) throw new HttpError(404, 'Introuvable');

    if (action === 'events' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const last = Number(req.headers['last-event-id'] ?? '-1');
      sse(res, 'hello', { player: h.session.player, map: h.session.map() });
      for (const e of h.session.log()) if (e.seq > (Number.isFinite(last) ? last : -1)) sse(res, 'play', e, e.seq);
      if (h.current) sse(res, h.current.kind, h.current.kind === 'request' ? h.current.request : h.current);
      if (h.failure) sse(res, 'error', { message: h.failure });
      h.clients.add(res);
      req.on('close', () => h.clients.delete(res));
      return;
    }
    if (action === 'status' && method === 'GET') {
      json(res, 200, { status: h.session.status(), clock: h.session.clock(), map: h.session.map() });
      return;
    }
    if (action === 'relations' && method === 'GET') {
      json(res, 200, { relations: h.session.relations() });
      return;
    }
    if (action === 'knowledge' && method === 'GET') {
      json(res, 200, { knowledge: h.session.knowledge() });
      return;
    }
    if (action === 'log' && method === 'GET') {
      json(res, 200, { log: h.session.log() });
      return;
    }
    if (action === 'answer' && method === 'POST') {
      const body = await readBody(req);
      const { requestId, choice } = body;
      if (typeof requestId !== 'string' || typeof choice !== 'number') {
        throw new HttpError(400, 'Attendu : { requestId: string, choice: number }');
      }
      try {
        h.session.answer(requestId, choice);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      if (h.current?.kind === 'request' && h.current.request.id === requestId) h.current = null;
      json(res, 200, { ok: true });
      return;
    }
    if (action === 'next-epoch' && method === 'POST') {
      if (h.current?.kind !== 'epoch_end') throw new HttpError(409, 'L’époque n’est pas terminée');
      if (!h.session.nextEpoch()) throw new HttpError(409, 'Il n’y a plus d’époque à jouer');
      h.current = null;
      pump(h);
      json(res, 200, { ok: true });
      return;
    }
    throw new HttpError(404, 'Introuvable');
  }

  const server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (res.headersSent) res.end();
      else json(res, status, { error: message });
    });
  });
  server.on('close', () => {
    for (const id of [...sessions.keys()]) drop(id);
  });
  return Object.assign(server, {
    closeAll() {
      for (const id of [...sessions.keys()]) drop(id);
      server.closeAllConnections();
    },
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env['PLAY_PORT'] ?? DEFAULT_PORT);
  const server = createPlayServer();
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Serveur de jeu sur http://127.0.0.1:${String(port)} (interface : pnpm web)\n`);
  });
}

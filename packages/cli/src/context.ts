/** Ouverture du stockage et résolution du monde : Postgres (`--db` / `DATABASE_URL`) ou mémoire (`--memory`). */
import { PrismaClient } from '@prisma/client';
import { type Id, type StoragePort, type WorldRecord } from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { prismaStorage } from '@ai-reality/storage-prisma';
import { aWorld, seedWorld } from '@ai-reality/testkit';
import { type CliIo, CliError } from './io.js';
import type { Parsed } from './options.js';
import { playEpoch } from './play.js';

export interface Context {
  readonly storage: StoragePort;
  readonly world: WorldRecord;
  readonly worldId: Id;
  readonly seasonNumber: number;
  readonly memory: boolean;
  close(): Promise<void>;
}

const slugify = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Un monde par identifiant, par slug du nom (`maison-des-palmiers`) ou par fragment unique (`palmiers`). */
function pick(worlds: readonly { id: string; name: string }[], query: string | undefined): string {
  if (worlds.length === 0) throw new CliError('Aucun monde en base : créez-en un avant de lancer la CLI.');
  if (query === undefined) {
    const [only] = worlds;
    if (worlds.length === 1 && only) return only.id;
    throw new CliError(
      `Plusieurs mondes en base : précisez --world <slug|id> (${worlds.map((w) => slugify(w.name)).join(', ')}).`,
    );
  }
  const wanted = slugify(query);
  const byId = worlds.find((w) => w.id === query);
  if (byId) return byId.id;
  const exact = worlds.filter((w) => slugify(w.name) === wanted);
  const matches = exact.length > 0 ? exact : worlds.filter((w) => slugify(w.name).includes(wanted));
  const [first] = matches;
  if (matches.length === 1 && first) return first.id;
  throw new CliError(
    matches.length === 0
      ? `Monde « ${query} » introuvable.`
      : `Monde « ${query} » ambigu : ${matches.map((w) => slugify(w.name)).join(', ')}.`,
  );
}

export async function openContext(args: Parsed, io: CliIo): Promise<Context> {
  if (args.memory) return openMemory(args);
  const url = args.db ?? io.env['DATABASE_URL'];
  if (!url) throw new CliError('Aucune base : passez --db <url>, définissez DATABASE_URL ou utilisez --memory.');
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const worlds = await prisma.world.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } });
    const worldId = pick(worlds, args.world);
    const storage = prismaStorage(prisma);
    const world = await storage.tx((s) => s.worlds.findById(worldId));
    if (!world) throw new CliError(`Monde ${worldId} introuvable.`);
    return { storage, world, worldId, seasonNumber: args.season, memory: false, close: () => prisma.$disconnect() };
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}

/** Mémoire : la Maison des Palmiers est créée à chaque appel (rien ne survit au processus). */
async function openMemory(args: Parsed): Promise<Context> {
  const storage = createMemoryStorage();
  const fixture = await seedWorld(
    storage,
    aWorld()
      .withSeed(args.seed ?? 'ai-reality')
      .build(),
  );
  const worldId = pick([fixture.world], args.world);
  return {
    storage,
    world: fixture.world,
    worldId,
    seasonNumber: fixture.season.number,
    memory: true,
    close: () => Promise.resolve(),
  };
}

/** En mémoire, joue les `count` premières époques pour avoir quelque chose à rejouer ou inspecter. */
export async function preplay(ctx: Context, args: Parsed): Promise<void> {
  if (!ctx.memory) return;
  for (let number = 0; number < args.epochs; number++) await playEpoch(ctx, number, args.policy);
}

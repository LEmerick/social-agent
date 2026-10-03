import { type StoragePort } from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { IDS } from '@ai-reality/testkit';
import { describe, expect, it } from 'vitest';
import { PLAYABLE_CHARACTERS, createPlaySession } from '../src/index.js';
import { C, option, passive, playEpoch, scriptedNpcs, sociable } from './helpers.js';

const journalOf = async (storage: StoragePort, epoch = 0) => {
  const run = await storage.tx((s) => s.epochs.findByNumber(IDS.world, epoch));
  if (!run) throw new Error('époque absente');
  return storage.tx((s) => s.journal.read(run.id));
};

describe('session de jeu', () => {
  it('refuse un personnage inconnu', async () => {
    await expect(createPlaySession({ characterSlug: 'zorro' })).rejects.toThrow(/Personnage inconnu/);
  });

  it('joue une époque complète avec un joueur scripté, pour chacun des quatre personnages', async () => {
    for (const { slug } of PLAYABLE_CHARACTERS) {
      const session = await createPlaySession({ characterSlug: slug });
      const { requests, summary } = await playEpoch(session, sociable);
      expect(requests.length).toBeGreaterThan(30);
      expect(requests[0]?.kind).toBe('destination');
      expect(requests.some((r) => r.kind === 'action')).toBe(true);
      expect(summary.epoch).toBe(0);
      expect(summary.creditsBefore).toBe(100);
      expect(summary.interactions).toBeGreaterThan(0);
      expect(session.log().length).toBeGreaterThan(0);
      expect(session.clock().time).toMatch(/^\d\d:\d\d$/);
      expect(session.nextEpoch()).toBe(false);
      session.close();
    }
  });

  it('numérote les options à partir de 1 et propose toujours « ne rien faire » ou « rester »', async () => {
    const session = await createPlaySession({ characterSlug: 'sarah' });
    const { requests } = await playEpoch(session, sociable);
    for (const r of requests) {
      expect(r.options.map((o) => o.n)).toEqual(r.options.map((_, i) => i + 1));
      if (r.kind === 'action') expect(r.options[0]?.label).toBe('Ne rien faire');
      if (r.kind === 'destination') expect(r.options.some((o) => /Rester/.test(o.label))).toBe(true);
      expect(r.time).toMatch(/^\d\d:\d\d$/);
    }
  });

  it('refuse une réponse invalide ou à une demande périmée', async () => {
    const session = await createPlaySession({ characterSlug: 'thomas' });
    const signal = await session.next();
    if (signal.kind !== 'request') throw new Error('demande attendue');
    expect(() => session.answer(signal.request.id, 0)).toThrow(/hors de/);
    expect(() => session.answer(signal.request.id, 999)).toThrow(/hors de/);
    expect(() => session.answer('req-inconnue', 1)).toThrow(/Aucune demande/);
    session.answer(signal.request.id, 1);
    expect(() => session.answer(signal.request.id, 1)).toThrow(/Aucune demande/);
    session.close();
  });

  it('enchaîne plusieurs époques et s’arrête au nombre demandé', async () => {
    const session = await createPlaySession({ characterSlug: 'lea', epochs: 2 });
    const first = await playEpoch(session, passive);
    expect(first.summary.epoch).toBe(0);
    expect(session.nextEpoch()).toBe(true);
    const second = await playEpoch(session, passive);
    expect(second.summary.epoch).toBe(1);
    expect(session.nextEpoch()).toBe(false);
  });

  it('est déterministe à graine égale et réponses identiques', async () => {
    const run = async (seed: string) => {
      const session = await createPlaySession({ characterSlug: 'alexandre', seed });
      const played = await playEpoch(session, sociable);
      return {
        events: session.log(),
        prompts: played.requests.map((r) => `${r.prompt}|${r.options.length}`),
        summary: played.summary,
      };
    };
    const a = await run('graine-a');
    expect(await run('graine-a')).toEqual(a);
    const b = await run('graine-b');
    expect(b.events).not.toEqual(a.events);
  });

  it('demande l’issue au joueur quand il est ciblé, et applique son choix', async () => {
    const storage = createMemoryStorage();
    const session = await createPlaySession({
      characterSlug: 'alexandre',
      storage,
      npc: scriptedNpcs({ [C.sarah]: { 1: option('compliment', C.alexandre) } }, C.alexandre),
    });
    const { requests } = await playEpoch(session, (r) => {
      if (r.kind === 'destination') return r.options.find((o) => o.label.includes('Aller : Salon'))?.n ?? 1;
      if (r.kind === 'outcome') return r.options.find((o) => o.label === 'Refuser')?.n ?? 1;
      return 1;
    });
    const asked = requests.filter((r) => r.kind === 'outcome');
    expect(asked).toHaveLength(1);
    expect(asked[0]?.tick).toBe(1);
    expect(asked[0]?.prompt).toBe('Sarah te complimente. Comment réagis-tu ?');
    expect(asked[0]?.options.map((o) => o.label)).toEqual([
      'Accepter',
      'Esquiver',
      'Refuser',
      'Retourner la situation contre lui',
    ]);

    const journal = await journalOf(storage);
    const compliment = journal.interactions.find((i) => i.action === 'compliment');
    expect(compliment?.outcome).toBe('refused');
    const decision = journal.decisions.find((d) => d.kind === 'outcome' && d.interactionId === compliment?.id);
    expect(decision?.policy).toBe('player');
    expect(session.log().some((e) => e.kind === 'heard' && e.text === 'Sarah te complimente — tu refuses.')).toBe(true);
  });

  it('ne pose pas de question sur une action secrète et ne la montre que si elle est découverte', async () => {
    for (const seed of ['s1', 's2', 's3', 's4', 's5', 's6']) {
      const storage = createMemoryStorage();
      const session = await createPlaySession({
        characterSlug: 'alexandre',
        seed,
        storage,
        npc: scriptedNpcs({ [C.sarah]: { 1: option('sabotage', C.alexandre) } }, C.alexandre),
      });
      const { requests } = await playEpoch(session, passive);
      expect(requests.some((r) => r.kind === 'outcome')).toBe(false);
      const journal = await journalOf(storage);
      const sabotage = journal.interactions.find((i) => i.action === 'sabotage');
      expect(sabotage).toBeDefined();
      const shown = session.log().filter((e) => e.interactionId === sabotage?.id);
      expect(shown.length > 0).toBe(sabotage?.outcome === 'detected');
    }
  });

  it('ne dévoile pas un mensonge à celui qui le reçoit', async () => {
    const session = await createPlaySession({
      characterSlug: 'alexandre',
      npc: scriptedNpcs({ [C.sarah]: { 1: option('lie', C.alexandre) } }, C.alexandre),
    });
    const { requests } = await playEpoch(session, (r) =>
      r.kind === 'destination' ? (r.options.find((o) => o.label.includes('Aller : Salon'))?.n ?? 1) : 1,
    );
    const asked = requests.find((r) => r.kind === 'outcome');
    expect(asked?.prompt).toBe('Sarah se confie à toi. Comment réagis-tu ?');
    const texts = [asked?.prompt ?? '', ...session.log().map((e) => e.text)].join('\n');
    expect(texts).not.toMatch(/mens|ment à|mentir|mensonge|\blie\b/i);
  });

  it('expose état, relations, connaissances et heure', async () => {
    const session = await createPlaySession({ characterSlug: 'sarah' });
    const { summary } = await playEpoch(session, sociable);
    const status = session.status();
    expect(status.name).toBe('Sarah');
    expect(status.credits).toBe(summary.creditsAfter);
    expect(status.credits).toBeLessThanOrEqual(90);
    expect(Object.keys(status.stats)).toContain('energy');
    // Sarah connaît son secret depuis le départ ; la vérité du fait n’est jamais exposée.
    const known = session.knowledge();
    expect(known.map((k) => k.text)).toContain('Sarah a déjà participé à une autre émission');
    expect(JSON.stringify(known)).not.toMatch(/isTrue/);
    expect(session.relations().every((r) => r.name !== 'Sarah')).toBe(true);
  });
});

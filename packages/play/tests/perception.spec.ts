import { type StoragePort } from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { IDS } from '@ai-reality/testkit';
import { describe, expect, it } from 'vitest';
import { PLAYABLE_CHARACTERS, createPlaySession } from '../src/index.js';
import { playEpoch, sociable } from './helpers.js';

const SECRET = 'a déjà participé à une autre émission';
const RAW =
  /\b(accepted|accepted_conditional|deflected|refused|backfired|escalated|believed|doubted|disbelieved|undetected|detected)\b|\(\w+_?\w*\)$/;

async function journalOf(storage: StoragePort) {
  const run = await storage.tx((s) => s.epochs.findByNumber(IDS.world, 0));
  if (!run) throw new Error('époque absente');
  return storage.tx((s) => s.journal.read(run.id));
}

describe('perception : le joueur ne perçoit que ce qu’il peut percevoir', () => {
  const seeds = ['p1', 'p2', 'p3', 'p4', 'p5'];

  for (const { slug } of PLAYABLE_CHARACTERS) {
    it(`${slug} : chaque événement perçu a sa source dans la perception du joueur`, async () => {
      const playerId = IDS.characters[slug as keyof typeof IDS.characters];
      for (const seed of seeds) {
        const storage = createMemoryStorage();
        const session = await createPlaySession({ characterSlug: slug, seed, storage });
        await playEpoch(session, sociable);
        const journal = await journalOf(storage);
        const known = new Set(session.knowledge().map((k) => k.factId));
        const knownTexts = session.knowledge().map((k) => k.text);

        for (const e of session.log()) {
          // Jamais de jargon du moteur (identifiants d’issue ou d’action) dans le texte montré.
          expect(e.text, e.text).not.toMatch(RAW);
          // Une réplique ou une phrase d’interaction vient d’une interaction à laquelle il participe ou qu’il voit.
          if (e.interactionId !== undefined) {
            const interaction = journal.interactions.find((i) => i.id === e.interactionId);
            expect(interaction, `interaction ${e.interactionId}`).toBeDefined();
            const mine = interaction?.participants.some((p) => p.characterId === playerId) ?? false;
            if (e.kind === 'heard' || e.kind === 'acted') expect(mine).toBe(true);
            if (e.kind === 'seen') expect(mine).toBe(false);
          }
          // Ce qu’il apprend est dans sa connaissance ; rien d’autre n’évoque un fait.
          if (e.kind === 'learned') expect(known.has(e.factId ?? '')).toBe(true);
          // Un événement sur une autre personne ne vient que d’une scène partagée (pas d’« arrive » hors de son lieu).
          if (e.kind === 'arrived' || e.kind === 'left')
            expect(e.otherId === undefined || e.otherId !== playerId).toBe(true);
        }

        // Le secret de Sarah ne sort jamais du journal perçu d’un autre joueur que celui qui le connaît.
        const text = session
          .log()
          .map((e) => e.text)
          .join('\n');
        if (!knownTexts.some((t) => t.includes(SECRET))) expect(text).not.toContain(SECRET);

        // Tout énoncé du journal dont le joueur n’est pas participant n’apparaît pas comme entendu.
        const heardIds = new Set(
          session
            .log()
            .filter((e) => e.kind === 'heard' || e.kind === 'acted')
            .map((e) => e.interactionId),
        );
        for (const i of journal.interactions) {
          if (!i.participants.some((p) => p.characterId === playerId)) expect(heardIds.has(i.id)).toBe(false);
        }
      }
    }, 60_000);
  }

  it('n’évoque que des personnes présentes dans son lieu lors des arrivées et départs', async () => {
    const storage = createMemoryStorage();
    const session = await createPlaySession({ characterSlug: 'lea', seed: 'p9', storage });
    await playEpoch(session, sociable);
    const journal = await journalOf(storage);
    const presences = journal.presences;
    for (const e of session.log().filter((x) => x.kind === 'arrived' && x.otherId !== undefined)) {
      // Au tick de l’événement, la personne et le joueur sont dans la même scène.
      const other = presences.find(
        (p) => p.characterId === e.otherId && p.tickStart <= e.tick && (p.tickEnd ?? 99) > e.tick,
      );
      const me = presences.find(
        (p) => p.characterId === IDS.characters.lea && p.tickStart <= e.tick && (p.tickEnd ?? 99) > e.tick,
      );
      expect(other?.sceneId).toBeDefined();
      expect(other?.sceneId).toBe(me?.sceneId);
    }
  });
});

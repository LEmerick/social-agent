import { describe, expect, it } from 'vitest';
import {
  HeuristicOutcomeModel,
  type StoragePort,
  closingBalance,
  journalHash,
  projectedValues,
  untracedChanges,
} from '@ai-reality/engine';
import { UniformRandomPolicy, aWorld, seedWorld, simStateOf, type WorldFixture } from '@ai-reality/testkit';
import { failAt, snapshotOf } from './epoch-kit.js';
import { fullHooks, interactionScheduler, replayedFromJournal, runOf } from './interaction-kit.js';

export interface EpochHarness {
  readonly storage: StoragePort;
  reset(): Promise<void>;
  close(): Promise<void>;
}

const policy = () => new UniformRandomPolicy({ moveProbability: 0.35, idleProbability: 0.2 });
const outcome = () => new HeuristicOutcomeModel();

export async function playRandomEpoch(
  storage: StoragePort,
  fixture: WorldFixture,
  extraTick: Parameters<typeof fullHooks>[0] = [],
) {
  await interactionScheduler(storage, policy(), outcome(), fullHooks(extraTick)).run(runOf(fixture)).done;
  return snapshotOf(storage, fixture.world.id, 0);
}

/** Époque complète à quatre personnages : politique aléatoire déterministe + `HeuristicOutcomeModel`. */
export function interactionEpochSuite(
  name: string,
  factory: () => Promise<EpochHarness>,
  /**
   * Faux si l'adaptateur arrondit les nombres à l'écriture. Les colonnes `effect.delta`, `effect.value_after`,
   * `relationship.<axe>` et `character_state.<stat>` de storage-prisma sont des SMALLINT alors que les règles M3a
   * produisent des deltas décimaux (0,5 ; 2,6…) : rejeu et reprise ne peuvent être exacts qu'en mémoire tant que
   * le schéma n'est pas passé en flottant.
   */
  exactNumbers = true,
): void {
  const exact = it.skipIf(!exactNumbers);
  describe(`époque avec interactions (${name})`, () => {
    const fixture = aWorld().build();

    it('même graine ⇒ même journalHash et mêmes identifiants (deux exécutions indépendantes)', async () => {
      const h = await factory();
      try {
        await h.reset();
        await seedWorld(h.storage, fixture);
        const first = await playRandomEpoch(h.storage, fixture);
        expect(first.journal.interactions.length).toBeGreaterThan(10);
        await h.reset();
        await seedWorld(h.storage, fixture);
        const second = await playRandomEpoch(h.storage, fixture);

        expect(journalHash(second.journal.events)).toBe(journalHash(first.journal.events));
        const idsOf = (s: typeof first) => ({
          events: s.journal.events.map((e) => e.id),
          interactions: s.journal.interactions.map((i) => i.id),
          utterances: s.journal.utterances.map((u) => u.id),
          decisions: s.journal.decisions.map((d) => d.id),
          effects: s.journal.effects.map((e) => e.id),
        });
        expect(idsOf(second)).toEqual(idsOf(first));
        expect(second.journal).toEqual(first.journal);
      } finally {
        await h.close();
      }
    }, 60_000);

    it('une graine différente change le journal', async () => {
      const h = await factory();
      try {
        await h.reset();
        await seedWorld(h.storage, fixture);
        const first = await playRandomEpoch(h.storage, fixture);
        await h.reset();
        const other = aWorld().build();
        await seedWorld(h.storage, { ...other, world: { ...other.world, seed: `${other.world.seed}-autre` } });
        const second = await playRandomEpoch(h.storage, fixture);
        expect(journalHash(second.journal.events)).not.toBe(journalHash(first.journal.events));
      } finally {
        await h.close();
      }
    }, 60_000);

    exact(
      'rejeu : relations et état des personnages reconstruits depuis les effets = projections relues en base',
      async () => {
        const h = await factory();
        try {
          await h.reset();
          await seedWorld(h.storage, fixture);
          const snap = await playRandomEpoch(h.storage, fixture);
          const rebuilt = await replayedFromJournal(h.storage, fixture, snap.epoch.id);

          for (const row of snap.states) {
            const c = rebuilt.characters[row.characterId];
            expect(c).toMatchObject({ credits: row.credits, status: row.status });
            expect(c?.stats).toEqual(row.stats);
            expect(c?.mood).toEqual(row.mood);
            expect(c?.scores).toEqual(row.scores);
          }
          const stored = new Map(snap.liveRelationships.map((r) => [`${r.sourceId}>${r.targetId}`, r]));
          const replayed = Object.entries(rebuilt.relationships).filter(
            ([key]) => stored.has(key) || rebuilt.relationships[key]?.interactionCount === 0,
          );
          expect(replayed.length).toBeGreaterThan(0);
          for (const [key, edge] of Object.entries(rebuilt.relationships)) {
            const row = stored.get(key);
            if (!row) continue;
            for (const axis of [
              'trust',
              'affection',
              'rivalry',
              'respect',
              'fear',
              'attraction',
              'alliance',
            ] as const) {
              expect(row[axis], `${key} ${axis}`).toBe(edge[axis]);
            }
          }
          // Chaque arête qui a bougé est en base (une arête absente de la base n'a pas bougé).
          const base = simStateOf(fixture);
          for (const [key, edge] of Object.entries(rebuilt.relationships)) {
            if (stored.has(key)) continue;
            expect(projectedValues(base)[`rel.${key}.trust`] ?? 30).toBe(edge.trust);
          }
        } finally {
          await h.close();
        }
      },
      60_000,
    );

    exact(
      'traçabilité : tout effet pointe un event, tout event d’interaction ses deux décisions, aucune valeur sans effet',
      async () => {
        const h = await factory();
        try {
          await h.reset();
          await seedWorld(h.storage, fixture);
          const { journal, states, epoch } = await playRandomEpoch(h.storage, fixture);
          const eventIds = new Set(journal.events.map((e) => e.id));
          for (const fx of journal.effects) expect(eventIds.has(fx.eventId)).toBe(true);
          for (const e of journal.scoreEntries) expect(eventIds.has(e.eventId)).toBe(true);
          for (const l of journal.ledger) if (l.eventId !== null) expect(eventIds.has(l.eventId)).toBe(true);

          for (const interaction of journal.interactions) {
            const decisions = journal.decisions.filter((d) => d.interactionId === interaction.id);
            expect(decisions.map((d) => d.kind).sort()).toEqual(['action', 'outcome']);
            for (const d of decisions) {
              expect(d.policy).toMatch(/@/);
              if (d.kind === 'action') expect(typeof d.rngDraw).toBe('number');
              expect(d.options).toBeTruthy();
            }
            expect(journal.events.filter((e) => e.interactionId === interaction.id)).toHaveLength(1);
            expect(journal.utterances.filter((u) => u.interactionId === interaction.id)).toHaveLength(1);
          }

          const rebuilt = await replayedFromJournal(h.storage, fixture, epoch.id);
          const stored = simStateOf(fixture);
          for (const row of states) {
            const c = stored.characters[row.characterId];
            if (!c) throw new Error('personnage inconnu');
            c.credits = row.credits;
            c.stats = { ...c.stats, ...row.stats };
            c.mood = { ...row.mood };
            c.scores = { ...c.scores, ...row.scores };
          }
          stored.relationships = rebuilt.relationships;
          expect(untracedChanges(simStateOf(fixture), stored, journal.effects)).toEqual([]);
        } finally {
          await h.close();
        }
      },
      60_000,
    );

    it('économie : C_fin = C_début − Σ débits + Σ crédits pour chaque personnage', async () => {
      const h = await factory();
      try {
        await h.reset();
        await seedWorld(h.storage, fixture);
        const { journal, states } = await playRandomEpoch(h.storage, fixture);
        expect(journal.ledger.some((l) => l.category === 'upkeep')).toBe(true);
        for (const row of states) {
          expect(row.credits).toBe(closingBalance(100, journal.ledger, row.characterId));
          const debits = journal.ledger.filter((l) => l.characterId === row.characterId && l.amount < 0);
          const credits = journal.ledger.filter((l) => l.characterId === row.characterId && l.amount > 0);
          expect(row.credits).toBe(
            100 - debits.reduce((t, l) => t - l.amount, 0) + credits.reduce((t, l) => t + l.amount, 0),
          );
        }
      } finally {
        await h.close();
      }
    }, 60_000);

    exact(
      'reprise après une panne au tick 17 : journal, états et relations identiques à une exécution continue',
      async () => {
        const h = await factory();
        try {
          await h.reset();
          await seedWorld(h.storage, fixture);
          const reference = await playRandomEpoch(h.storage, fixture);
          expect(reference.journal.interactions.length).toBeGreaterThan(10);

          await h.reset();
          await seedWorld(h.storage, fixture);
          const crashing = interactionScheduler(h.storage, policy(), outcome(), fullHooks([failAt(17)]));
          await expect(crashing.run(runOf(fixture)).done).rejects.toThrow('panne injectée au tick 17');
          const interrupted = await snapshotOf(h.storage, fixture.world.id, 0);
          expect(interrupted.epoch).toMatchObject({ status: 'failed', lastCommittedTick: 16 });
          expect(interrupted.journal.interactions.length).toBeGreaterThan(0);

          const resumed = await interactionScheduler(h.storage, policy(), outcome()).resume(interrupted.epoch.id).done;
          expect(resumed.firstTick).toBe(17);
          const final = await snapshotOf(h.storage, fixture.world.id, 0);
          expect(final.epoch).toEqual(reference.epoch);
          expect(final.journal).toEqual(reference.journal);
          expect(final.states).toEqual(reference.states);
          expect(final.relationships).toEqual(reference.relationships);
          expect(final.liveRelationships).toEqual(reference.liveRelationships);
        } finally {
          await h.close();
        }
      },
      60_000,
    );
  });
}

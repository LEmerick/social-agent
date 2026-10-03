/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des journaux connus */
import { describe, expect, it } from 'vitest';
import {
  AgendaDecisionPolicy,
  ProbabilisticOutcomeModel,
  SCORE_NAMES,
  UtilityDecisionPolicy,
  auditSeason,
  createEpochScheduler,
  economyHook,
  interactionHook,
  recompute,
  recomputeScores,
  replaySeason,
  type StoragePort,
} from '../../src/index.js';
import { failAt } from './epoch-kit.js';
import { playSeason, tampered } from './season-kit.js';

export interface SeasonHarness {
  readonly storage: StoragePort;
  reset(): Promise<void>;
}

const kinds = (issues: readonly { readonly kind: string }[]): string[] =>
  [...new Set(issues.map((i) => i.kind))].sort();

/** Rejeu de bout en bout d'une saison de 5 époques, recalcul des scores et détection de corruptions. */
export function replaySeasonSuite(name: string, factory: () => Promise<SeasonHarness>): void {
  describe(`rejeu de saison (${name})`, () => {
    it('une saison de 5 époques rejouée depuis le journal redonne exactement l’état stocké', async () => {
      const { storage, reset } = await factory();
      await reset();
      const played = await playSeason(storage, 5);

      const journal = await storage.tx(async (s) => {
        const epochs = await Promise.all([0, 1, 2, 3, 4].map((n) => s.epochs.findByNumber(played.worldId, n)));
        return Promise.all(epochs.map((e) => s.journal.read(e!.id)));
      });
      // La saison n’est pas vide : sinon le rejeu ne prouverait rien.
      expect(journal.reduce((n, j) => n + j.effects.length, 0)).toBeGreaterThan(100);
      expect(journal.reduce((n, j) => n + j.interactions.length, 0)).toBeGreaterThan(20);

      const result = await replaySeason(storage, played.worldId, played.seasonNumber);
      expect(result.diffs).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.epochs).toBe(5);
      expect(result.stateHash).toMatch(/^[0-9a-f]{64}$/);
      // Le rejeu est lui-même déterministe.
      expect((await replaySeason(storage, played.worldId, played.seasonNumber)).stateHash).toBe(result.stateHash);
      expect((await auditSeason(storage, played.worldId, played.seasonNumber)).issues).toEqual([]);
    }, 120_000);

    it('une projection ou un effet altéré est signalé par le rejeu', async () => {
      const { storage, reset } = await factory();
      await reset();
      const played = await playSeason(storage, 3);
      const clean = await replaySeason(storage, played.worldId, played.seasonNumber);

      const richer = await replaySeason(
        tampered(storage, {
          states: (rows) => rows.map((r, i) => (i === 0 ? { ...r, credits: r.credits + 7 } : r)),
        }),
        played.worldId,
        played.seasonNumber,
      );
      expect(richer.ok).toBe(false);
      expect(richer.diffs.some((d) => d.kind === 'projection' && d.path?.endsWith('.credits'))).toBe(true);

      let target = '';
      const wrong = await replaySeason(
        tampered(storage, {
          journal: (j) => {
            const fx = j.effects.find((e) => e.targetKind === 'stat' && e.valueAfter !== null);
            if (!fx || target) return j;
            target = fx.id;
            return {
              ...j,
              effects: j.effects.map((e) => (e.id === fx.id ? { ...e, valueAfter: e.valueAfter! + 3 } : e)),
            };
          },
        }),
        played.worldId,
        played.seasonNumber,
      );
      expect(wrong.diffs.some((d) => d.kind === 'effect_value' && d.message.includes('journalisée'))).toBe(true);
      expect(wrong.stateHash).toBe(clean.stateHash);
    }, 120_000);

    it('recompute après changement de poids : entrées re-pondérées, scores cumulés, rejeu toujours cohérent', async () => {
      const { storage, reset } = await factory();
      await reset();
      const played = await playSeason(storage, 3);
      const before = await replaySeason(storage, played.worldId, played.seasonNumber);
      const season = await storage.tx((s) => s.seasons.findByNumber(played.worldId, played.seasonNumber));

      const weights = { social: 2, drama: 0.5, popularity: 3, survival: 4, influence: 1.5 };
      await storage.tx((s) => s.seasons.updateRules(season!.id, { scoreWeights: weights }, season!.rulesVersion + 1));
      await expect(recompute(storage, season!.id, season!.rulesVersion)).rejects.toMatchObject({
        code: 'RULES_VERSION_MISMATCH',
      });

      const result = await recompute(storage, season!.id, season!.rulesVersion + 1);
      expect(result.weights).toEqual(weights);
      expect(result.epochs.map((e) => e.number)).toEqual([0, 1, 2]);

      const { entries, rows } = await storage.tx(async (s) => {
        const epochs = await Promise.all([0, 1, 2].map((n) => s.epochs.findByNumber(played.worldId, n)));
        const journals = await Promise.all(epochs.map((e) => s.journal.read(e!.id)));
        return {
          entries: journals.flatMap((j) => j.scoreEntries),
          rows: await s.characterStates.listByEpoch(epochs[2]!.id),
        };
      });
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((e) => e.weight === weights[e.score])).toBe(true);
      const expected = recomputeScores(entries).byCharacter;
      for (const row of rows) {
        for (const n of SCORE_NAMES) expect(row.scores[n]).toBeCloseTo(expected[row.characterId]?.perScore[n] ?? 0, 6);
      }
      expect(result.byCharacter).toEqual(expected);

      // Les scores stockés suivent la nouvelle pondération et le rejeu les accepte.
      const after = await replaySeason(storage, played.worldId, played.seasonNumber);
      expect(after.diffs).toEqual([]);
      expect(after.stateHash).not.toBe(before.stateHash);
      // Idempotent.
      expect((await recompute(storage, season!.id)).byCharacter).toEqual(expected);
    }, 120_000);

    it('doctor : effet supprimé, effet sans event, tick manquant', async () => {
      const { storage, reset } = await factory();
      await reset();
      const played = await playSeason(storage, 3);
      expect((await auditSeason(storage, played.worldId, played.seasonNumber)).ok).toBe(true);

      const audit = (tamper: Parameters<typeof tampered>[1]) =>
        auditSeason(tampered(storage, tamper), played.worldId, played.seasonNumber);

      // Un effet de crédit supprimé : la chaîne des valeurs et le grand livre ne retombent plus juste.
      const lost = await audit({
        journal: (j) => {
          const fx = j.effects.find((e) => e.targetKind === 'credit');
          return fx ? { ...j, effects: j.effects.filter((e) => e.id !== fx.id) } : j;
        },
      });
      expect(lost.ok).toBe(false);
      expect(kinds(lost.issues)).toEqual(expect.arrayContaining(['effect_value', 'ledger']));

      // Un event supprimé alors que ses effets restent : effets orphelins et trou de séquence.
      const orphan = await audit({
        journal: (j) => {
          const withFx = j.events.find((e) => j.effects.some((fx) => fx.eventId === e.id));
          return withFx ? { ...j, events: j.events.filter((e) => e.id !== withFx.id) } : j;
        },
        events: (events) => {
          const mid = events[Math.floor(events.length / 2)];
          return events.filter((e) => e !== mid);
        },
      });
      expect(kinds(orphan.issues)).toEqual(expect.arrayContaining(['effect_orphan', 'seq_gap']));

      // Un tick entier perdu dans l’époque 1.
      const lostTick = await audit({
        journal: (j) => {
          const t = j.events[Math.floor(j.events.length / 2)]?.tick;
          if (t === undefined) return j;
          return {
            ...j,
            events: j.events.filter((e) => e.tick !== t),
            effects: j.effects.filter((e) => e.tick !== t),
            decisions: j.decisions.filter((d) => d.tick !== t),
            presences: j.presences.filter((p) => p.tickStart !== t),
          };
        },
        events: (events) => events.filter((e) => e.tick !== 5),
      });
      expect(lostTick.ok).toBe(false);
      expect(kinds(lostTick.issues)).toEqual(expect.arrayContaining(['seq_gap']));

      // Un personnage dont les présences ne couvrent plus toute l’époque.
      const absent = await audit({
        journal: (j) => ({ ...j, presences: j.presences.filter((p, i) => i !== 0 || p.tickEnd === null) }),
      });
      expect(kinds(absent.issues)).toEqual(expect.arrayContaining(['presence']));
    }, 120_000);

    it('doctor : époque interrompue non reprise, puis reprise et saison saine', async () => {
      const { storage, reset } = await factory();
      await reset();
      const played = await playSeason(storage, 2);
      const hooks = (extra: ReturnType<typeof failAt>[]) => ({
        tick: [interactionHook(), ...extra],
        economy: economyHook(),
      });
      const scheduler = (extra: ReturnType<typeof failAt>[]) =>
        createEpochScheduler({
          storage,
          decision: new AgendaDecisionPolicy(new UtilityDecisionPolicy()),
          outcome: new ProbabilisticOutcomeModel(),
          hooks: hooks(extra),
        });
      const run = { worldId: played.worldId, seasonNumber: played.seasonNumber, number: 2 };
      await expect(scheduler([failAt(6)]).run(run).done).rejects.toThrow('panne injectée');

      const broken = await auditSeason(storage, played.worldId, played.seasonNumber);
      expect(broken.ok).toBe(false);
      const unfinished = broken.issues.find((i) => i.kind === 'epoch_unfinished');
      expect(unfinished).toMatchObject({ epoch: 2 });
      expect(unfinished?.message).toContain('tick 5');
      const replay = await replaySeason(storage, played.worldId, played.seasonNumber);
      expect(replay.epochs).toBe(2);
      expect(replay.diffs.map((d) => d.kind)).toEqual(['epoch_unfinished']);

      const epoch = await storage.tx((s) => s.epochs.findByNumber(played.worldId, 2));
      await scheduler([]).resume(epoch!.id).done;
      const healed = await auditSeason(storage, played.worldId, played.seasonNumber);
      expect(healed.issues).toEqual([]);
      expect(healed.epochs).toBe(3);
    }, 120_000);
  });
}

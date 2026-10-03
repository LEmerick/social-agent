/** NarrativeEngine : collecte → sélection → arcs → confessionnaux → script → validation → persistance. */
import { DomainError } from '@ai-reality/engine';
import type { Id } from '@ai-reality/engine';
import { buildArcsFrom } from './arcs.js';
import { collectDigest } from './collect.js';
import type { ConfessionalService } from './confessional.js';
import { episodeId, rowsOfScript, scriptOfRecord } from './episode-rows.js';
import type { EpisodeRecord, NarrativeStoragePort } from './ports.js';
import { type SceneSheet, sceneSheetsOf } from './sheets.js';
import { selectMoments } from './select.js';
import type { EpisodeLine, EpisodeScript } from './script.js';
import { type EpisodeValidator, createEpisodeValidator } from './validator.js';
import type { WriterAgent } from './writer.js';
import type { EpochDigest, Moment, NarrativeArc, SelectOptions, ValidationIssue } from './types.js';

export interface NarrativeOptions {
  readonly targetSeconds: number;
  readonly minScreenTimePerPlayer: number;
  /** Importance minimale du remplissage libre de la sélection. */
  readonly minImportance?: number;
  /** Confessionnaux par arc (défaut 1, si un `ConfessionalService` est fourni). */
  readonly confessionalsPerArc?: number;
  /** Écritures du script, première comprise (défaut 2 : une réécriture guidée par les problèmes du validateur). */
  readonly maxAttempts?: number;
  /** Tolérance sur la durée visée avant rejet (défaut 0,1 = 10 %). */
  readonly durationTolerance?: number;
  /** Nombre d'épisodes précédents résumés pour le « précédemment » (défaut 3). */
  readonly previouslyCount?: number;
}

export interface NarrativeEngineDeps {
  readonly storage: NarrativeStoragePort;
  readonly writer: WriterAgent;
  readonly confessional?: ConfessionalService;
  /** Validateur du monde (défaut : `createEpisodeValidator` sur la lecture seule du port). */
  readonly validatorFor?: (worldId: Id) => EpisodeValidator;
  readonly options: NarrativeOptions;
}

export interface Episode extends EpisodeRecord {
  readonly script: EpisodeScript;
  readonly arcs: readonly NarrativeArc[];
  readonly confessionals: readonly EpisodeLine[];
}

export interface NarrativeEngine {
  collect(epochId: Id): Promise<EpochDigest>;
  select(digest: EpochDigest, opts: SelectOptions): Promise<Moment[]>;
  /** Regroupe par chaînes `caused_by_event_id` ; `openArcs` (de `digest.openArcs`) permet de prolonger un arc ouvert. */
  buildArcs(moments: readonly Moment[], openArcs?: readonly NarrativeArc[]): Promise<NarrativeArc[]>;
  produce(epochId: Id): Promise<Episode>;
  /** Fiches `Scene` du Video Engine, avec les versions visuelles lues dans `character_visual`. */
  sceneSheets(episode: EpisodeRecord): Promise<SceneSheet[]>;
}

export function createNarrativeEngine(deps: NarrativeEngineDeps): NarrativeEngine {
  const { storage, options } = deps;
  const validatorFor = deps.validatorFor ?? ((worldId: Id) => createEpisodeValidator({ sim: storage.sim, worldId }));

  const engine: NarrativeEngine = {
    async sceneSheets(episode) {
      const [characters, locations, visuals] = await Promise.all([
        storage.sim.characters(episode.worldId),
        storage.sim.locations(episode.worldId),
        storage.sim.characterVisuals(episode.worldId),
      ]);
      return sceneSheetsOf(episode, { characters, locations, visuals });
    },

    collect: (epochId) => collectDigest(storage, epochId),

    select: (digest, opts) => Promise.resolve(selectMoments(digest, opts)),

    buildArcs: (moments, openArcs = []) => {
      const worldId = openArcs[0]?.worldId ?? '';
      return Promise.resolve(buildArcsFrom(worldId, moments, openArcs));
    },

    async produce(epochId) {
      const digest = await engine.collect(epochId);
      const moments = await engine.select(digest, {
        targetSeconds: options.targetSeconds,
        minScreenTimePerPlayer: options.minScreenTimePerPlayer,
        ...(options.minImportance === undefined ? {} : { minImportance: options.minImportance }),
      });
      if (moments.length === 0) {
        throw new DomainError('NO_MATERIAL', `Aucun moment à raconter pour l'époque ${String(digest.epochNumber)}`);
      }
      const arcs = buildArcsFrom(digest.worldId, moments, digest.openArcs);

      const existing = (await storage.episodes.episodes(digest.worldId)).filter((e) => e.epochId === epochId);
      if (existing.some((e) => e.status !== 'rejected')) {
        throw new DomainError('EPISODE_EXISTS', `L'époque ${String(digest.epochNumber)} a déjà un épisode non rejeté`);
      }
      const version = existing.reduce((max, e) => Math.max(max, e.version), 0) + 1;

      await storage.episodes.upsertArcs(arcs);

      // Confessionnaux : les personnages les plus présents de chaque arc, avec leurs seules connaissances.
      const confessionals: EpisodeLine[] = [];
      if (deps.confessional) {
        for (const arc of arcs) {
          const weight = new Map<Id, number>();
          for (const m of moments.filter((x) => arc.eventIds.includes(x.eventId))) {
            for (const id of m.participantIds) weight.set(id, (weight.get(id) ?? 0) + 1);
          }
          const speakers = [...weight.entries()]
            .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
            .slice(0, options.confessionalsPerArc ?? 1)
            .map(([id]) => id);
          for (const id of speakers) confessionals.push(await deps.confessional.record(id, arc));
        }
      }

      const [characters, locations, all] = await Promise.all([
        storage.sim.characters(digest.worldId),
        storage.sim.locations(digest.worldId),
        storage.episodes.episodes(digest.worldId),
      ]);
      const previously = all
        .filter((e) => e.status === 'validated' && e.number < digest.epochNumber)
        .slice(-(options.previouslyCount ?? 3))
        .map((e) => ({ number: e.number, title: e.title, synopsis: e.synopsis, cliffhanger: e.cliffhanger }));

      const validator = validatorFor(digest.worldId);
      const maxSeconds = Math.ceil(options.targetSeconds * (1 + (options.durationTolerance ?? 0.1)));
      const momentIds = new Set(moments.map((m) => m.eventId));
      let feedback: readonly ValidationIssue[] = [];
      let script: EpisodeScript | undefined;
      let issues: ValidationIssue[] = [];
      let durationSeconds = 0;
      for (let attempt = 1; attempt <= (options.maxAttempts ?? 2); attempt++) {
        script = await deps.writer.write({
          arcs,
          previously,
          moments,
          utterances: digest.utterances.filter((u) => moments.some((m) => m.utteranceIds.includes(u.id))),
          effects: digest.effects.filter((e) => momentIds.has(e.eventId)),
          confessionals,
          world: { characters, locations },
          targetSeconds: options.targetSeconds,
          feedback,
        });
        const verdict = await validator.validate(script, {
          maxSeconds,
          confessionals: confessionals.map((c) => ({ speakerId: c.speakerId, text: c.text })),
        });
        issues = verdict.issues;
        durationSeconds = verdict.durationSeconds;
        if (verdict.ok) break;
        feedback = verdict.issues;
      }
      if (!script) throw new DomainError('NO_SCRIPT', 'Le WriterAgent n’a produit aucun script');

      const id = episodeId(epochId, version);
      const rows = rowsOfScript(id, script);
      const lines = rows.lines.map((l) => {
        const recorded =
          l.kind === 'confessional'
            ? confessionals.find((c) => c.speakerId === l.speakerId && c.text === l.text)
            : undefined;
        return recorded ? { ...l, llmCallId: recorded.llmCallId } : l;
      });
      const draft: EpisodeRecord = {
        id,
        worldId: digest.worldId,
        epochId,
        number: digest.epochNumber,
        version,
        title: script.title,
        synopsis: script.synopsis,
        status: 'draft',
        targetSeconds: options.targetSeconds,
        durationSeconds: 0,
        cliffhanger: script.cliffhanger,
        issues: [],
        arcIds: arcs.map((a) => a.id),
        scenes: rows.scenes,
        lines,
      };
      await storage.episodes.saveEpisode(draft);
      const status = issues.length === 0 ? 'validated' : 'rejected';
      await storage.episodes.setStatus(id, status, issues, durationSeconds);

      const episode: Episode = {
        ...draft,
        status,
        issues,
        durationSeconds,
        script: scriptOfRecord(draft),
        arcs,
        confessionals,
      };
      return episode;
    },
  };
  return engine;
}

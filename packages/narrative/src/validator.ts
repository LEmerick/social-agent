/**
 * EpisodeValidator : un script n'est accepté que s'il tient face au journal de la simulation.
 * Sources existantes, lieu cohérent, personnages réellement présents (table `presence`), dialogues fidèles aux
 * utterances, conséquences annoncées conformes aux effets, confessionnaux réellement enregistrés, durée respectée.
 */
import type { EffectRecord, EpochJournal, EventRecord, Id, UtteranceRecord } from '@ai-reality/engine';
import type { SimulationReader } from './ports.js';
import type { EpisodeScript, ScriptScene } from './script.js';
import type { IssueCode, ValidationIssue } from './types.js';

export interface RecordedConfessional {
  readonly speakerId: Id;
  readonly text: string;
}

export interface ValidateOptions {
  /** Durée maximale de l'épisode en secondes (somme des scènes). Sans valeur : pas de contrôle. */
  readonly maxSeconds?: number;
  /** Confessionnaux réellement enregistrés : une ligne `confessional` qui n'en fait pas partie est rejetée. */
  readonly confessionals?: readonly RecordedConfessional[];
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly issues: ValidationIssue[];
  /** Somme des durées déclarées par les scènes. */
  readonly durationSeconds: number;
}

export interface EpisodeValidator {
  validate(script: EpisodeScript, options?: ValidateOptions): Promise<ValidationResult>;
}

const norm = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function createEpisodeValidator(deps: {
  readonly sim: SimulationReader;
  readonly worldId: Id;
  readonly defaults?: ValidateOptions;
}): EpisodeValidator {
  return {
    async validate(script, options = {}) {
      const opts = { ...deps.defaults, ...options };
      const [events, characters, locations] = await Promise.all([
        deps.sim.eventsOfWorld(deps.worldId),
        deps.sim.characters(deps.worldId),
        deps.sim.locations(deps.worldId),
      ]);
      const eventById = new Map<Id, EventRecord>(events.map((e) => [e.id, e]));
      const characterIds = new Set(characters.map((c) => c.id));
      const locationIds = new Set(locations.map((l) => l.id));
      const journals = new Map<Id, EpochJournal>();
      const journalOf = async (epochId: Id): Promise<EpochJournal> => {
        const cached = journals.get(epochId);
        if (cached) return cached;
        const journal = await deps.sim.journal(epochId);
        journals.set(epochId, journal);
        return journal;
      };

      const issues: ValidationIssue[] = [];
      const report = (
        code: IssueCode,
        message: string,
        sceneIndex: number | null,
        extra: { eventId?: Id; characterId?: Id } = {},
      ): void => {
        issues.push({
          code,
          message,
          sceneIndex,
          eventId: extra.eventId ?? null,
          characterId: extra.characterId ?? null,
        });
      };

      const checkScene = async (scene: ScriptScene, i: number): Promise<void> => {
        if (!locationIds.has(scene.locationId)) report('unknown_location', `Lieu inconnu : ${scene.locationId}`, i);

        const sources: EventRecord[] = [];
        for (const id of new Set(scene.sources)) {
          const event = eventById.get(id);
          if (event) sources.push(event);
          else report('unknown_event', `Source inexistante dans le journal : ${id}`, i, { eventId: id });
        }
        const sourceIds = new Set(sources.map((e) => e.id));

        // Lieu : chaque source se déroule dans le lieu de la scène.
        for (const event of sources) {
          const journal = await journalOf(event.epochId);
          const where = event.locationId ?? journal.scenes.find((s) => s.id === event.sceneId)?.locationId ?? null;
          if (where !== null && where !== scene.locationId) {
            report('source_location_mismatch', `L'event ${event.id} a lieu ailleurs que dans le lieu de la scène`, i, {
              eventId: event.id,
            });
          }
        }

        // Présence : chaque personnage montré est dans le lieu de la scène à l'un des ticks des sources.
        for (const characterId of new Set(scene.characterIds)) {
          if (!characterIds.has(characterId)) {
            report('unknown_character', `Personnage inconnu : ${characterId}`, i, { characterId });
            continue;
          }
          if (sources.length === 0) continue;
          let present = false;
          for (const event of sources) {
            const journal = await journalOf(event.epochId);
            present = journal.presences.some((p) => {
              if (p.characterId !== characterId || p.kind !== 'scene') return false;
              if (event.tick < p.tickStart || (p.tickEnd !== null && event.tick >= p.tickEnd)) return false;
              return journal.scenes.find((s) => s.id === p.sceneId)?.locationId === scene.locationId;
            });
            if (present) break;
          }
          if (!present) {
            report('character_absent', `${characterId} n'est pas présent dans cette scène aux moments cités`, i, {
              characterId,
            });
          }
        }

        // Lignes : dialogues fidèles aux utterances, confessionnaux enregistrés.
        const utterances = new Map<Id, UtteranceRecord>();
        const interactionIds = new Set<Id>();
        for (const event of sources) {
          if (event.interactionId !== null) interactionIds.add(event.interactionId);
        }
        for (const epochId of new Set(sources.map((e) => e.epochId))) {
          for (const u of (await journalOf(epochId)).utterances) utterances.set(u.id, u);
        }
        const inScene = new Set(scene.characterIds);
        for (const line of scene.lines) {
          if (line.speakerId !== null && !characterIds.has(line.speakerId)) {
            report('unknown_character', `Locuteur inconnu : ${line.speakerId}`, i, { characterId: line.speakerId });
            continue;
          }
          if (line.kind === 'confessional') {
            const recorded = opts.confessionals;
            if (recorded && !recorded.some((c) => c.speakerId === line.speakerId && norm(c.text) === norm(line.text))) {
              report(
                'confessional_unrecorded',
                'Confessionnal absent des enregistrements',
                i,
                line.speakerId === null ? {} : { characterId: line.speakerId },
              );
            }
            continue;
          }
          if (line.kind !== 'dialogue') continue;
          if (line.speakerId === null || !inScene.has(line.speakerId)) {
            report(
              'speaker_not_in_scene',
              'Un dialogue est prononcé par quelqu’un qui n’est pas dans la scène',
              i,
              line.speakerId === null ? {} : { characterId: line.speakerId },
            );
          }
          const utterance = line.utteranceId === null ? undefined : utterances.get(line.utteranceId);
          if (!utterance) {
            report(
              'unknown_utterance',
              `Dialogue sans réplique source dans le journal (${line.utteranceId ?? 'aucune'})`,
              i,
            );
          } else if (utterance.speakerId !== line.speakerId || norm(utterance.text) !== norm(line.text)) {
            report('utterance_mismatch', `Le dialogue diffère de la réplique ${utterance.id}`, i);
          } else if (!interactionIds.has(utterance.interactionId)) {
            report(
              'utterance_not_in_sources',
              `La réplique ${utterance.id} ne provient d'aucune source de la scène`,
              i,
            );
          }
        }

        // Conséquences annoncées : conformes aux effets du journal.
        for (const claim of scene.claims) {
          const event = eventById.get(claim.eventId);
          if (!sourceIds.has(claim.eventId) || !event) {
            report('claim_not_in_sources', `Conséquence annoncée sur un event non cité : ${claim.eventId}`, i, {
              eventId: claim.eventId,
            });
            continue;
          }
          const effects: EffectRecord[] = (await journalOf(event.epochId)).effects.filter(
            (e) =>
              e.eventId === claim.eventId &&
              e.characterId === claim.characterId &&
              e.otherCharacterId === claim.otherCharacterId &&
              e.dimension === claim.dimension,
          );
          const delta = effects.reduce((sum, e) => sum + e.delta, 0);
          if (effects.length === 0 || (claim.direction === 'up' ? delta <= 0 : delta >= 0)) {
            report(
              'claim_contradiction',
              `Le journal ne montre pas « ${claim.dimension} ${claim.direction === 'up' ? 'en hausse' : 'en baisse'} » pour l'event ${claim.eventId}`,
              i,
              { eventId: claim.eventId },
            );
          }
        }
      };

      for (const [i, scene] of script.scenes.entries()) await checkScene(scene, i);

      const durationSeconds = script.scenes.reduce((sum, s) => sum + s.seconds, 0);
      if (opts.maxSeconds !== undefined && durationSeconds > opts.maxSeconds) {
        report(
          'duration_exceeded',
          `Durée ${String(durationSeconds)} s au-dessus du maximum de ${String(opts.maxSeconds)} s`,
          null,
        );
      }
      return { ok: issues.length === 0, issues, durationSeconds };
    },
  };
}

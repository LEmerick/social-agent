import type { IdFactory } from '../core/id.js';
import type { EventRecord } from '../state/journal.js';
import type { Id, SimState } from '../state/types.js';
import { clamp01 } from './decay.js';
import { FALLBACK, TEMPLATES, type Viewpoint } from './templates.js';
import type { MemoryDraft } from './types.js';

export interface MemoriesFromEventsOptions {
  /** Ne garde que les `max` souvenirs les plus saillants (restitués dans l'ordre des events). */
  readonly max?: number;
  /** Saillance minimale (défaut 0.15) : en dessous, l'épisode n'est pas retenu. */
  readonly minSalience?: number;
}

/** Part de l'implication dans la saillance, selon le rôle du personnage. */
const INVOLVEMENT: Readonly<Record<'actor' | 'target' | 'subject' | 'witness', number>> = {
  actor: 0.9,
  target: 1,
  subject: 0.8,
  witness: 0.4,
};

/** `saillance = 0.5·importance + 0.3·implication + 0.2·intensité émotionnelle`, bornée à [0, 1]. */
export const salienceOf = (importance: number, involvement: number, intensity: number): number =>
  clamp01(0.5 * importance + 0.3 * involvement + 0.2 * intensity);

const fill = (template: string, names: Readonly<Record<string, string>>): string =>
  template.replace(/\{([ABL])\}/g, (_m, key: string) => names[key] ?? '');

/**
 * Souvenirs à la première personne de `characterId` pour les events qu'il a vécus (acteur, cible, sujet
 * ou témoin). Pur : mêmes entrées et même fabrique d'identifiants ⇒ mêmes souvenirs.
 */
export function memoriesFromEvents(
  state: Readonly<SimState>,
  characterId: Id,
  events: readonly EventRecord[],
  ids: IdFactory,
  options: MemoriesFromEventsOptions = {},
): MemoryDraft[] {
  const minSalience = options.minSalience ?? 0.15;
  const nameOf = (id: Id | undefined): string => (id ? (state.characters[id]?.firstName ?? 'quelqu’un') : 'quelqu’un');

  const candidates = [...events]
    .sort((a, b) => a.seq - b.seq)
    .flatMap((event) => {
      const me = event.participants.find((p) => p.characterId === characterId);
      if (!me) return [];
      const viewpoint: Viewpoint = me.role === 'subject' ? 'target' : me.role;
      const actor = event.participants.find((p) => p.role === 'actor')?.characterId;
      const target = event.participants.find((p) => p.role === 'target')?.characterId;
      const template = TEMPLATES[event.type] ?? FALLBACK;
      const summary = fill(template.text[viewpoint], {
        A: nameOf(actor),
        B: nameOf(target),
        L: event.type.replace(/_/g, ' '),
      });
      const salience = salienceOf(event.importance, INVOLVEMENT[me.role], template.intensity);
      const about = [
        ...new Set(event.participants.map((p) => p.characterId).filter((id) => id !== characterId)),
      ].sort();
      return salience < minSalience ? [] : [{ event, summary, emotion: template.emotion[viewpoint], salience, about }];
    });

  const kept =
    options.max === undefined
      ? candidates
      : [...candidates]
          .sort((a, b) => b.salience - a.salience || a.event.seq - b.event.seq)
          .slice(0, Math.max(0, options.max))
          .sort((a, b) => a.event.seq - b.event.seq);

  return kept.map(({ event, summary, emotion, salience, about }): MemoryDraft => ({
    id: ids.next(),
    characterId,
    eventId: event.id,
    epochId: event.epochId,
    kind: 'episodic',
    summary,
    emotion,
    salience,
    aboutCharacterIds: about,
  }));
}

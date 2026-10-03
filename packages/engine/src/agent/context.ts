/**
 * Contexte d'un agent (engine-architecture.md §8) : tout ce qu'un personnage a le droit de savoir au moment de parler.
 *
 * Règle d'or : les faits ne sont lus QUE via `of()` (index des connaissances du personnage). Ce fichier ne lit jamais
 * `state.facts`. Les relations sont celles que le personnage a envers les autres (arêtes sortantes), pas l'inverse.
 */
import { of } from '../knowledge/query.js';
import type { Axis, Belief, Id, KnowledgeSource, Intention, ScoreName, SimState, StatKey } from '../state/types.js';
import { BASE_AXES, relKey } from '../state/types.js';

export interface PreviousTurn {
  readonly speakerId: Id;
  readonly text: string;
}

/** Situation du moment, fournie par l'appelant (la scène en cours). */
export interface AgentSituation {
  readonly locationId: Id | null;
  /** Personnages de la scène visibles par l'agent (lui-même est ignoré). */
  readonly sceneMemberIds: readonly Id[];
  /** Tours de parole que l'agent a entendus dans cette interaction. */
  readonly previousTurns: readonly PreviousTurn[];
}

export interface PerceivedRelationship {
  readonly targetId: Id;
  readonly targetName: string;
  readonly acquaintance: string;
  readonly axes: Readonly<Record<Axis, number>>;
  readonly labels: readonly string[];
}

export interface ProvenanceSummary {
  readonly source: KnowledgeSource;
  readonly toldById: Id | null;
  readonly toldByName: string | null;
  readonly learnedEpoch: number;
  readonly learnedTick: number;
}

/** Un fait connu : jamais construit sans connaissance du personnage. */
export interface KnownFactView {
  readonly factId: Id;
  readonly text: string;
  readonly sensitivity: number;
  readonly confidence: number;
  readonly belief: Belief;
  readonly provenance: ProvenanceSummary;
}

export interface AgentContext {
  readonly identity: {
    readonly id: Id;
    readonly slug: string;
    readonly firstName: string;
    readonly autonomy: string;
    readonly traits: Readonly<Record<string, number>>;
  };
  readonly stats: Readonly<Record<StatKey, number>>;
  readonly scores: Readonly<Record<ScoreName, number>>;
  readonly credits: number;
  readonly mood: Readonly<Record<string, number>>;
  readonly goals: readonly { kind: string; description: string; targetName: string | null }[];
  readonly agenda: readonly (Omit<Intention, 'factId'> & { factId: Id | null; targetName: string | null })[];
  readonly relationships: readonly PerceivedRelationship[];
  readonly knowledge: readonly KnownFactView[];
  readonly situation: {
    readonly locationName: string | null;
    readonly members: readonly { id: Id; name: string }[];
    readonly previousTurns: readonly { speakerId: Id; speakerName: string; text: string }[];
  };
}

const nameOf = (state: Readonly<SimState>, id: Id | null): string | null =>
  id === null ? null : (state.characters[id]?.firstName ?? null);

/** Phrase lisible d'un fait : « sujet prédicat objet ». */
function factText(
  state: Readonly<SimState>,
  fact: { subjectId: Id | null; predicate: string; objectId: Id | null; objectText: string | null },
): string {
  const parts = [nameOf(state, fact.subjectId), fact.predicate, nameOf(state, fact.objectId), fact.objectText];
  return parts.filter((p): p is string => p !== null && p !== '').join(' ');
}

/** Construit le contexte filtré d'un personnage. Lève une erreur si le personnage est absent. */
export function buildAgentContext(state: Readonly<SimState>, characterId: Id, situation: AgentSituation): AgentContext {
  const c = state.characters[characterId];
  if (!c) throw new Error(`Personnage ${characterId} absent du SimState`);

  // Seul accès aux faits : l'index des connaissances du personnage.
  const known = of(state, characterId);
  const knownIds = new Set(known.map((k) => k.fact.id));

  const knowledge: KnownFactView[] = known.map(({ fact, knowledge: k }) => ({
    factId: fact.id,
    text: factText(state, fact),
    sensitivity: fact.sensitivity,
    confidence: k.confidence,
    belief: k.belief,
    provenance: {
      source: k.sourceType,
      toldById: k.toldById,
      toldByName: nameOf(state, k.toldById),
      learnedEpoch: k.learnedEpoch,
      learnedTick: k.learnedTick,
    },
  }));

  const relationships: PerceivedRelationship[] = [];
  for (const other of Object.keys(state.characters).sort()) {
    const e = other === characterId ? undefined : state.relationships[relKey(characterId, other)];
    if (!e) continue;
    relationships.push({
      targetId: other,
      targetName: nameOf(state, other) ?? other,
      acquaintance: e.acquaintance,
      axes: Object.fromEntries(BASE_AXES.map((a) => [a, e[a]])) as Record<Axis, number>,
      labels: [...e.labels],
    });
  }

  const location = situation.locationId ? state.locations[situation.locationId] : undefined;
  return {
    identity: { id: c.id, slug: c.slug, firstName: c.firstName, autonomy: c.autonomy, traits: { ...c.traits } },
    stats: { ...c.stats },
    scores: { ...c.scores },
    credits: c.credits,
    mood: { ...c.mood },
    goals: c.goals
      .filter((g) => g.status === 'open')
      .map((g) => ({ kind: g.kind, description: g.description, targetName: nameOf(state, g.targetCharacterId) })),
    // Une intention qui référence un fait inconnu du personnage est écartée : elle ne doit pas le révéler.
    agenda: c.agenda
      .filter((i) => i.factId === null || knownIds.has(i.factId))
      .map((i) => ({ ...i, targetName: nameOf(state, i.targetId) })),
    relationships,
    knowledge,
    situation: {
      locationName: location?.name ?? null,
      members: situation.sceneMemberIds
        .filter((id) => id !== characterId && state.characters[id])
        .map((id) => ({ id, name: nameOf(state, id) ?? id })),
      previousTurns: situation.previousTurns.map((t) => ({
        speakerId: t.speakerId,
        speakerName: nameOf(state, t.speakerId) ?? t.speakerId,
        text: t.text,
      })),
    },
  };
}

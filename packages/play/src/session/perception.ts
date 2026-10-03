/**
 * Ce que le personnage joué perçoit d’un tick. Rien d’autre ne sort de ce module vers l’interface.
 *
 * Règles de perception :
 * - on entend une interaction dont on est acteur, destinataire ou témoin audible ; les actions secrètes
 *   (`hidden`) ne sont perçues que par leur auteur, et par leur cible si elle est découverte (`detected`) ;
 * - un énoncé résumé du moteur (« lie (believed) ») n’est jamais montré tel quel : il est remis en phrase,
 *   un mensonge passant pour une confidence aux yeux de tous sauf de son auteur ;
 * - on voit (sans entendre) ce qui se dit dans une autre zone du lieu ;
 * - on voit les arrivées et départs des personnes de son lieu, jamais ailleurs ;
 * - on apprend ce que sa propre connaissance du monde (`of`) s’enrichit ; on ne voit jamais si un fait est vrai ;
 * - les effets montrés sont les siens : ses crédits, ses sentiments envers un interlocuteur, son statut.
 */
import {
  type CharacterStatus,
  type EffectRecord,
  type Id,
  type InteractionRecord,
  type RelationshipEdge,
  type SimState,
  type TickContext,
  actionDef,
  BASE_AXES,
  of,
  relKey,
} from '@ai-reality/engine';
import { AXIS_FR, STATUS_FR, capitalize, factText, nameOf, narrate } from './fr.js';
import type { EpochSummary, PlayEventKind, RelationChange } from './types.js';

export interface PerceivedDraft {
  readonly kind: PlayEventKind;
  readonly text: string;
  readonly tick: number;
  readonly interactionId?: Id;
  readonly speakerId?: Id;
  readonly otherId?: Id;
  readonly factId?: Id;
}

export type Emit = (draft: PerceivedDraft) => void;

const round = (n: number): number => Math.round(n * 10) / 10;
const signed = (n: number): string => (n > 0 ? `+${String(round(n))}` : String(round(n)));

/** Les autres personnes visibles depuis le lieu du joueur (une scène = un lieu). */
export function visibleOthers(state: Readonly<SimState>, playerId: Id): Id[] {
  const me = state.positions[playerId];
  if (me?.kind !== 'at') return [];
  return Object.keys(state.characters)
    .filter((id) => {
      const p = state.positions[id];
      return id !== playerId && p?.kind === 'at' && p.locationId === me.locationId;
    })
    .sort((a, b) => nameOf(state, a).localeCompare(nameOf(state, b), 'fr') || (a < b ? -1 : 1));
}

interface Snapshot {
  readonly credits: number;
  readonly status: CharacterStatus;
  readonly edges: Readonly<Record<Id, RelationshipEdge>>;
}

export class Perception {
  readonly #playerId: Id;
  readonly #emit: Emit;
  #placeId: Id | null = null;
  #present = new Set<Id>();
  #knownFacts = new Set<Id>();
  #before: Snapshot | null = null;
  #interactions = 0;
  #learned = 0;

  constructor(playerId: Id, emit: Emit) {
    this.#playerId = playerId;
    this.#emit = emit;
  }

  /** Début d’époque : photographie de départ (résumé) et connaissances déjà acquises (non annoncées). */
  begin(state: Readonly<SimState>): void {
    const me = state.characters[this.#playerId];
    const edges: Record<Id, RelationshipEdge> = {};
    for (const id of Object.keys(state.characters)) {
      const e = state.relationships[relKey(this.#playerId, id)];
      if (e) edges[id] = structuredClone(e);
    }
    this.#before = { credits: me?.credits ?? 0, status: me?.status ?? 'active', edges };
    this.#knownFacts = new Set(of(state, this.#playerId).map((k) => k.fact.id));
    this.#interactions = 0;
    this.#learned = 0;
    this.#placeId = null;
    this.#present = new Set();
  }

  /** Dernier hook de chaque tick, avant le commit : tout est en mémoire, tout est daté de ce tick. */
  onTick(ctx: TickContext): void {
    const { state, batch, tick } = ctx;
    this.#presence(state, tick);
    for (const interaction of batch.interactions) this.#interaction(ctx, interaction);
    this.#knowledge(state, tick);
    this.#effects(state, batch.effects, batch.events, tick, false);
  }

  /** Phase de clôture : bilan économique et statut. */
  onClose(ctx: TickContext): void {
    this.#effects(ctx.state, ctx.batch.effects, ctx.batch.events, ctx.tick, true);
  }

  summary(state: Readonly<SimState>, epoch: number): EpochSummary {
    const me = state.characters[this.#playerId];
    const before = this.#before;
    const changes: RelationChange[] = [];
    for (const id of Object.keys(state.characters).filter((c) => c !== this.#playerId)) {
      const after = state.relationships[relKey(this.#playerId, id)];
      const was = before?.edges[id];
      const deltas: Record<string, number> = {};
      for (const axis of BASE_AXES) {
        const d = (after?.[axis] ?? 0) - (was?.[axis] ?? 0);
        if (d !== 0) deltas[axis] = d;
      }
      const magnitude = Object.values(deltas).reduce((sum, d) => sum + Math.abs(d), 0);
      if (magnitude > 0) changes.push({ otherId: id, name: nameOf(state, id), deltas, magnitude });
    }
    changes.sort((a, b) => b.magnitude - a.magnitude || a.name.localeCompare(b.name, 'fr'));
    return {
      epoch,
      creditsBefore: before?.credits ?? 0,
      creditsAfter: me?.credits ?? 0,
      statusBefore: before?.status ?? 'active',
      statusAfter: me?.status ?? 'active',
      relationChanges: changes,
      interactions: this.#interactions,
      learned: this.#learned,
    };
  }

  #presence(state: Readonly<SimState>, tick: number): void {
    const me = state.positions[this.#playerId];
    const placeId = me?.kind === 'at' ? me.locationId : null;
    const now = new Set(visibleOthers(state, this.#playerId));
    if (placeId !== this.#placeId) {
      if (placeId !== null) {
        const names = [...now].map((id) => nameOf(state, id));
        const where = state.locations[placeId]?.name ?? '?';
        const who = names.length > 0 ? ` Tu y vois : ${names.join(', ')}.` : ' Il n’y a personne.';
        this.#emit({ kind: 'arrived', tick, text: `Lieu : ${where}.${who}` });
      }
    } else {
      for (const id of now) {
        if (!this.#present.has(id)) {
          this.#emit({ kind: 'arrived', tick, otherId: id, text: `${nameOf(state, id)} arrive.` });
        }
      }
      for (const id of this.#present) {
        if (!now.has(id)) {
          this.#emit({ kind: 'left', tick, otherId: id, text: `${nameOf(state, id)} s’en va.` });
        }
      }
    }
    this.#placeId = placeId;
    this.#present = now;
  }

  #interaction(ctx: TickContext, interaction: InteractionRecord): void {
    const { state, batch, tick } = ctx;
    const me = this.#playerId;
    const def = actionDef(interaction.action);
    const actorId = interaction.initiatorId ?? interaction.participants.find((p) => p.role === 'speaker')?.characterId;
    if (!def || actorId === undefined) return;
    const targetId = interaction.participants.find((p) => p.role === 'addressee')?.characterId ?? null;
    const mine = interaction.participants.find((p) => p.characterId === me);
    const secret = def.defaultVolume === 'hidden';
    const base = { tick, interactionId: interaction.id, speakerId: actorId };

    const heard = mine !== undefined && (!secret || mine.role === 'speaker' || interaction.outcome === 'detected');
    if (heard) {
      this.#interactions += 1;
      if (interaction.mode === 'dialogue') {
        for (const u of batch.utterances.filter((x) => x.interactionId === interaction.id)) {
          const youSay = u.speakerId === me;
          const who = youSay ? 'Toi' : nameOf(state, u.speakerId);
          this.#emit({ ...base, kind: 'heard', speakerId: u.speakerId, text: `${who} : « ${u.text} »` });
        }
      } else {
        const text = narrate(state, me, interaction.action, actorId, targetId, interaction.outcome);
        this.#emit({ ...base, kind: 'heard', text });
      }
      return;
    }

    // Vu mais pas entendu : une autre zone du lieu, hors des actions secrètes.
    if (secret || mine !== undefined || targetId === null) return;
    const volume = def.defaultVolume;
    const sees = ctx.audience(interaction.sceneId, actorId, volume).find((l) => l.characterId === me);
    if (sees?.perception !== 'sees') return;
    this.#emit({
      ...base,
      kind: 'seen',
      text: `Tu vois ${nameOf(state, actorId)} parler avec ${nameOf(state, targetId)}, sans entendre.`,
    });
  }

  #knowledge(state: Readonly<SimState>, tick: number): void {
    for (const known of of(state, this.#playerId)) {
      if (this.#knownFacts.has(known.fact.id)) continue;
      this.#knownFacts.add(known.fact.id);
      this.#learned += 1;
      const k = known.knowledge;
      const from = k.toldById === null ? '' : ` (${nameOf(state, k.toldById)} te l’a dit)`;
      const doubt = k.belief === 'believes' ? '' : k.belief === 'doubts' ? ' Tu as des doutes.' : ' Tu n’y crois pas.';
      this.#emit({
        kind: 'learned',
        tick,
        factId: known.fact.id,
        ...(k.toldById === null ? {} : { otherId: k.toldById }),
        text: `Tu apprends que ${factText(state, known.fact)}${from}.${doubt}`,
      });
    }
  }

  #effects(
    state: Readonly<SimState>,
    effects: readonly EffectRecord[],
    events: TickContext['batch']['events'],
    tick: number,
    closing: boolean,
  ): void {
    const me = this.#playerId;
    const mine = effects.filter((e) => e.characterId === me);

    const credits = mine.filter((e) => e.targetKind === 'credit');
    if (credits.length > 0) {
      const delta = credits.reduce((sum, e) => sum + e.delta, 0);
      const balance = credits[credits.length - 1]?.valueAfter ?? state.characters[me]?.credits ?? 0;
      if (delta !== 0) {
        const label = closing ? 'Bilan de l’époque' : 'Crédits';
        this.#emit({ kind: 'credits', tick, text: `${label} : ${signed(delta)} crédits (solde ${String(balance)}).` });
      }
    }

    // Ses sentiments envers un interlocuteur ne bougent à l’écran que s’il a vécu l’événement qui les a causés.
    const lived = new Set(events.filter((ev) => ev.participants.some((p) => p.characterId === me)).map((ev) => ev.id));
    const sums = new Map<string, { other: Id; axis: string; delta: number; after: number | null }>();
    for (const e of mine) {
      if (e.targetKind !== 'relationship' || e.otherCharacterId === null || !lived.has(e.eventId)) continue;
      const key = `${e.otherCharacterId}|${e.dimension}`;
      const prev = sums.get(key);
      sums.set(key, {
        other: e.otherCharacterId,
        axis: e.dimension,
        delta: (prev?.delta ?? 0) + e.delta,
        after: e.valueAfter,
      });
    }
    for (const s of sums.values()) {
      if (s.delta === 0) continue;
      const axis = capitalize(AXIS_FR[s.axis] ?? s.axis);
      const now = s.after === null ? '' : ` (maintenant ${String(round(s.after))})`;
      this.#emit({
        kind: 'relation',
        tick,
        otherId: s.other,
        text: `${axis} envers ${nameOf(state, s.other)} : ${signed(s.delta)}${now}.`,
      });
    }

    for (const ev of events) {
      if (ev.type !== 'status_changed') continue;
      const p = ev.payload as { characterId?: Id; from?: CharacterStatus; to?: CharacterStatus };
      if (p.characterId === me && p.to !== undefined) {
        this.#emit({
          kind: 'status',
          tick,
          text: `Ton statut change : ${p.from === undefined ? '?' : STATUS_FR[p.from]} → ${STATUS_FR[p.to]}.`,
        });
      }
    }
  }
}

/**
 * Port de génération du dialogue d'une interaction (action-catalog.md §4, étape « dialogue »).
 * M3 fournit `SummaryDialogue` (un énoncé résumé, sans LLM) ; M5 le remplace par une implémentation LLM.
 */
import type { Rng } from '../core/rng.js';
import type { ActionOption } from '../decision/ports.js';
import type { Listener } from '../scene/audience.js';
import { actionDef } from '../rules/catalog.js';
import type { Id, SimState, Volume } from '../state/types.js';

/** Énoncé produit par un générateur ; l'identifiant, la séquence et le tick sont attribués par le moteur. */
export interface UtteranceDraft {
  readonly speakerId: Id;
  readonly addresseeIds: readonly Id[];
  readonly text: string;
  readonly intent: string | null;
  readonly tone: string | null;
  readonly emotion: string | null;
  readonly volume: Volume;
  readonly revealedFactIds: readonly Id[];
  readonly llmCallId: Id | null;
}

export interface DialogueInput {
  readonly state: Readonly<SimState>;
  readonly interactionId: Id;
  readonly sceneId: Id;
  readonly option: ActionOption;
  readonly actorId: Id;
  /** Issue déjà décidée par l'`OutcomeModel` : le dialogue la met en scène, il ne la change pas. */
  readonly outcome: string;
  /** Volume de l'action, ramené à `Volume` (`hidden` ⇒ `whisper`). */
  readonly volume: Volume;
  /** Ceux qui perçoivent l'acteur (cible comprise si elle est dans la scène). */
  readonly listeners: readonly Listener[];
  readonly rng: Rng;
}

/**
 * Résultat de la vérification d'un dialogue LLM (JSON simple). L'intégrateur peut le placer dans
 * `InteractionRecord.classification` (action-catalog.md §6).
 */
export interface DialogueVerification {
  /** Le dialogue retenu aboutit à l'issue tirée. Faux après repli sur un dialogue résumé. */
  readonly verified: boolean;
  /** Générations tentées (1 = bon du premier coup). */
  readonly attempts: number;
  readonly fallback: boolean;
  /** Raisons d'incohérence données par le vérificateur à chaque échec. */
  readonly reasons: readonly string[];
  /** Faits cités par un locuteur qui ne les connaît pas : ignorés. */
  readonly ignoredReveals: readonly string[];
}

export interface DialogueResult {
  readonly mode: 'dialogue' | 'summarized';
  readonly utterances: readonly UtteranceDraft[];
  /** Renseigné par les générateurs qui vérifient leur dialogue (`LlmDialogue`) ; absent pour `SummaryDialogue`. */
  readonly verification?: DialogueVerification;
}

export interface DialogueGenerator {
  generate(input: DialogueInput): Promise<DialogueResult>;
}

/** Un seul énoncé résumé : « Alexandre → Sarah : propose_alliance (accepted_conditional) », volume par défaut de l'action. */
export class SummaryDialogue implements DialogueGenerator {
  generate(input: DialogueInput): Promise<DialogueResult> {
    const { state, option, actorId, outcome } = input;
    const name = (id: Id): string => state.characters[id]?.firstName ?? id;
    const target = option.targetId === null ? '' : ` → ${name(option.targetId)}`;
    const volume = actionDef(option.action)?.defaultVolume;
    return Promise.resolve({
      mode: 'summarized',
      utterances: [
        {
          speakerId: actorId,
          addresseeIds: option.targetId === null ? [] : [option.targetId],
          text: `${name(actorId)}${target} : ${option.action} (${outcome})`,
          intent: option.action,
          tone: null,
          emotion: null,
          volume: volume === undefined || volume === 'hidden' ? input.volume : volume,
          revealedFactIds: option.factId === null ? [] : [option.factId],
          llmCallId: null,
        },
      ],
    });
  }
}

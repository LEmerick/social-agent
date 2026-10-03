/**
 * Replis sans LLM quand le budget de l'époque est épuisé (voir `llm/budget.ts`).
 *
 * Chaque enveloppe essaie d'abord l'implémentation LLM, sauf si le compteur annonce déjà le budget épuisé (on évite alors
 * de construire un prompt pour rien). Un refus `LLM_BUDGET_EXCEEDED` en cours de route reprend aussi la main du repli.
 * Tout repli est compté (`LlmMetrics.fallbacks`) et laisse sa trace dans le journal :
 * - décision et issue : le champ `policy` de la décision porte l'identifiant de la politique de repli ;
 * - dialogue : `mode: 'summarized'` et `verification.fallback = true` avec la raison `LLM_BUDGET_EXCEEDED` ;
 * - hooks de phase 2 et 6 : sautés (agendas et bilans inchangés), sans trace dans le journal hors métriques.
 */
import type { DecisionPolicy, OutcomeModel } from '../decision/ports.js';
import { SummaryDialogue, type DialogueGenerator } from '../interaction/dialogue.js';
import type { LlmMeter } from '../llm/budget.js';
import { LlmBudgetExceededError } from '../llm/budget.js';
import type { TickHook } from './types.js';

/** Exécute `primary` ; bascule sur `fallback` si le budget est épuisé avant ou pendant. */
async function guarded<T>(meter: LlmMeter, primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  if (meter.exhausted) {
    meter.noteFallback();
    return fallback();
  }
  try {
    return await primary();
  } catch (error) {
    if (!(error instanceof LlmBudgetExceededError)) throw error;
    meter.noteFallback();
    return fallback();
  }
}

/** Politique de décision : `choose` bascule sur `fallback` ; `chooseDestination` n'utilise jamais le LLM. */
export function budgetedDecision(primary: DecisionPolicy, fallback: DecisionPolicy, meter: LlmMeter): DecisionPolicy {
  return {
    choose: (input) =>
      guarded(
        meter,
        () => primary.choose(input),
        () => fallback.choose(input),
      ),
    chooseDestination: (input) => primary.chooseDestination(input),
  };
}

export function budgetedOutcome(primary: OutcomeModel, fallback: OutcomeModel, meter: LlmMeter): OutcomeModel {
  return {
    resolve: (input) =>
      guarded(
        meter,
        () => primary.resolve(input),
        () => fallback.resolve(input),
      ),
  };
}

/** Dialogue : le repli est le dialogue résumé (`SummaryDialogue` par défaut), marqué comme tel dans la vérification. */
export function budgetedDialogue(
  primary: DialogueGenerator,
  meter: LlmMeter,
  fallback: DialogueGenerator = new SummaryDialogue(),
): DialogueGenerator {
  return {
    generate: (input) =>
      guarded(
        meter,
        () => primary.generate(input),
        async () => ({
          ...(await fallback.generate(input)),
          mode: 'summarized' as const,
          verification: {
            verified: false,
            attempts: 0,
            fallback: true,
            reasons: ['LLM_BUDGET_EXCEEDED'],
            ignoredReveals: [],
          },
        }),
      ),
  };
}

/** Hook de phase qui appelle le LLM (agendas, mémoire) : sauté si le budget est épuisé, interrompu à son premier refus. */
export function budgetedHook(hook: TickHook, meter: LlmMeter): TickHook {
  return (ctx) =>
    guarded(
      meter,
      async () => {
        await hook(ctx);
      },
      () => Promise.resolve(),
    );
}

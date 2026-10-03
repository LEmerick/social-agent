/**
 * Enveloppe de `LLMPort` : concurrence maximale, budget par époque, métriques (appels, jetons, coût estimé).
 *
 * - `maxConcurrency` borne le nombre d'appels en vol ; les suivants attendent leur tour (FIFO).
 * - `budget` borne les jetons et/ou le coût estimé d'une époque. Une fois atteint, ou si un appel dépasserait la limite
 *   avec ses réservations en cours, l'appel est refusé par `LlmBudgetExceededError` (`LLM_BUDGET_EXCEEDED`) : les
 *   appelants basculent sur leurs repli sans LLM (voir `epoch/budget-fallback.ts`).
 * - Le budget compte les jetons réels des appels terminés plus une estimation (taille du prompt + `maxTokens`) pour
 *   ceux en vol. Avec `maxConcurrency` 1, le refus est donc entièrement déterministe ; au-delà, il peut dépendre de
 *   l'ordre d'arrivée des réponses (le journal garde la trace de chaque repli, donc un rejeu depuis le journal reste exact).
 * - `beginEpoch()` remet les compteurs de l'époque à zéro ; `snapshot()` les lit.
 */
import { DomainError } from '../core/errors.js';
import { lockstepAround } from './lockstep.js';
import type { LLMPort, LlmPurpose, LlmRequest, LlmResult, LlmUsage } from './port.js';

/** Tarif en dollars par million de jetons. `cachedInputPerMTok` : jetons d'entrée lus au cache (défaut : tarif d'entrée). */
export interface LlmPrice {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  readonly cachedInputPerMTok?: number;
}

/** Tarifs par identifiant de modèle ; `'*'` sert de tarif par défaut. Un modèle sans tarif ne coûte rien. */
export type LlmPricing = Readonly<Record<string, LlmPrice>>;

export interface LlmBudget {
  /** Jetons (entrée + sortie) par époque. */
  readonly maxTokensPerEpoch?: number;
  /** Coût estimé par époque, en dollars. */
  readonly maxCostPerEpoch?: number;
}

export interface BudgetedLlmOptions {
  readonly maxConcurrency?: number;
  readonly budget?: LlmBudget;
  readonly pricing?: LlmPricing;
  /** Sortie maximale supposée d'un appel sans `maxTokens` (pour la réservation). Défaut : 1 000. */
  readonly defaultMaxOutputTokens?: number;
  /** Horloge en millisecondes (défaut : `performance.now`). */
  readonly now?: () => number;
}

export interface LlmPurposeMetrics {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface LlmMetrics {
  /** Appels terminés avec succès. */
  readonly calls: number;
  /** Appels qui ont échoué (erreur du fournisseur, sortie invalide, délai dépassé…). */
  readonly failures: number;
  /** Appels refusés par le budget. */
  readonly rejected: number;
  /** Décisions, dialogues et bilans repris sans LLM faute de budget (voir `epoch/budget-fallback.ts`). */
  readonly fallbacks: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly costUsd: number;
  /** Durée cumulée des appels réussis, en millisecondes. */
  readonly latencyMs: number;
  /** Plus grand nombre d'appels simultanés observé. */
  readonly peakInFlight: number;
  readonly byPurpose: Readonly<Partial<Record<LlmPurpose, Readonly<LlmPurposeMetrics>>>>;
}

/** Ce que le scheduler attend d'un compteur d'époque. */
export interface LlmMeter {
  beginEpoch(): void;
  snapshot(): LlmMetrics;
  /** Compte un repli sans LLM. */
  noteFallback(): void;
  /** Vrai si le budget de l'époque est épuisé : les appelants peuvent éviter de construire un prompt pour rien. */
  readonly exhausted: boolean;
}

export class LlmBudgetExceededError extends DomainError {
  constructor(message: string) {
    super('LLM_BUDGET_EXCEEDED', message);
    this.name = 'LlmBudgetExceededError';
  }
}

const PER_MILLION = 1_000_000;

/** Coût estimé d'un usage selon le tarif du modèle (`'*'` en défaut ; 0 sans tarif). */
export function costOf(pricing: LlmPricing, model: string, usage: LlmUsage): number {
  const price = pricing[model] ?? pricing['*'];
  return price ? priceOf(price, usage) : 0;
}

function priceOf(price: LlmPrice, usage: LlmUsage): number {
  const cached = Math.min(usage.cachedTokens, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  return (
    (fresh * price.inputPerMTok +
      cached * (price.cachedInputPerMTok ?? price.inputPerMTok) +
      usage.outputTokens * price.outputPerMTok) /
    PER_MILLION
  );
}

const CHARS_PER_TOKEN = 4;

function estimateInputTokens(req: LlmRequest): number {
  const chars =
    req.system.stable.length +
    (req.system.variable?.length ?? 0) +
    req.messages.reduce((total, m) => total + m.content.length, 0);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

interface Counters {
  calls: number;
  failures: number;
  rejected: number;
  fallbacks: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  latencyMs: number;
  peakInFlight: number;
  byPurpose: Partial<Record<LlmPurpose, LlmPurposeMetrics>>;
}

const zero = (): Counters => ({
  calls: 0,
  failures: 0,
  rejected: 0,
  fallbacks: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  costUsd: 0,
  latencyMs: 0,
  peakInFlight: 0,
  byPurpose: {},
});

export class BudgetedLlm implements LLMPort, LlmMeter {
  readonly #inner: LLMPort;
  readonly #maxConcurrency: number;
  readonly #budget: LlmBudget;
  readonly #pricing: LlmPricing;
  readonly #defaultOutput: number;
  readonly #waiting: (() => void)[] = [];
  #inFlight = 0;
  #reservedTokens = 0;
  #reservedCost = 0;
  #counters: Counters = zero();

  constructor(inner: LLMPort, options: BudgetedLlmOptions = {}) {
    this.#inner = inner;
    const max = options.maxConcurrency ?? Number.POSITIVE_INFINITY;
    if (!(max >= 1)) throw new DomainError('INVALID_CONFIG', `maxConcurrency invalide : ${String(max)}`);
    this.#maxConcurrency = max;
    this.#budget = options.budget ?? {};
    this.#pricing = options.pricing ?? {};
    this.#defaultOutput = options.defaultMaxOutputTokens ?? 1_000;
  }

  beginEpoch(): void {
    this.#counters = zero();
  }

  snapshot(): LlmMetrics {
    const c = this.#counters;
    return { ...c, byPurpose: structuredClone(c.byPurpose) };
  }

  noteFallback(): void {
    this.#counters.fallbacks += 1;
  }

  get exhausted(): boolean {
    const { maxTokensPerEpoch, maxCostPerEpoch } = this.#budget;
    const c = this.#counters;
    return (
      (maxTokensPerEpoch !== undefined && c.inputTokens + c.outputTokens + this.#reservedTokens >= maxTokensPerEpoch) ||
      (maxCostPerEpoch !== undefined && c.costUsd + this.#reservedCost >= maxCostPerEpoch)
    );
  }

  complete<T = unknown>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    // Hors d'une exécution en pas de course, `lockstepAround` appelle simplement `#perform`.
    return lockstepAround(() => this.#perform(req));
  }

  async #perform<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    // Admission : avant tout `await`, donc à l'intérieur du tour de l'appelant.
    if (this.exhausted) {
      this.#counters.rejected += 1;
      throw new LlmBudgetExceededError(`Budget LLM de l'époque épuisé (appel « ${req.purpose} » refusé)`);
    }
    const reservedTokens = estimateInputTokens(req) + (req.maxTokens ?? this.#defaultOutput);
    // Le coût réservé suppose le modèle le plus cher du barème : on ne sait pas encore lequel répondra.
    const reservedCost = Math.max(
      0,
      ...Object.values(this.#pricing).map((price) =>
        priceOf(price, {
          inputTokens: estimateInputTokens(req),
          outputTokens: req.maxTokens ?? this.#defaultOutput,
          cachedTokens: 0,
        }),
      ),
    );
    this.#reservedTokens += reservedTokens;
    this.#reservedCost += reservedCost;
    // Les compteurs ne se remettent à zéro qu'entre deux époques : on garde celui de l'appel pour y imputer le résultat.
    const counters = this.#counters;
    try {
      await this.#acquire();
      counters.peakInFlight = Math.max(counters.peakInFlight, this.#inFlight);
      try {
        const result = await this.#inner.complete(req);
        this.#record(counters, req, result);
        return result;
      } catch (error) {
        counters.failures += 1;
        throw error;
      } finally {
        this.#release();
      }
    } finally {
      this.#reservedTokens -= reservedTokens;
      this.#reservedCost -= reservedCost;
    }
  }

  #record(counters: Counters, req: LlmRequest, result: LlmResult): void {
    const cost = costOf(this.#pricing, result.model, result.usage);
    counters.calls += 1;
    counters.inputTokens += result.usage.inputTokens;
    counters.outputTokens += result.usage.outputTokens;
    counters.cachedTokens += result.usage.cachedTokens;
    counters.costUsd += cost;
    counters.latencyMs += result.latencyMs;
    const purpose = (counters.byPurpose[req.purpose] ??= { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    purpose.calls += 1;
    purpose.inputTokens += result.usage.inputTokens;
    purpose.outputTokens += result.usage.outputTokens;
    purpose.costUsd += cost;
  }

  #acquire(): Promise<void> {
    if (this.#inFlight < this.#maxConcurrency) {
      this.#inFlight += 1;
      return Promise.resolve();
    }
    // Le créneau est transmis tel quel par `#release` : `#inFlight` ne bouge pas.
    return new Promise<void>((resolve) => {
      this.#waiting.push(resolve);
    });
  }

  #release(): void {
    const next = this.#waiting.shift();
    if (next) next();
    else this.#inFlight -= 1;
  }
}

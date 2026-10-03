import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type LLMPort,
  type LlmPurpose,
  type LlmRequest,
  type LlmResult,
  type LlmUsage,
  type PromptFingerprint,
  canonicalJson,
  deriveUuid,
  llmCassetteMissing,
  parseStructuredOutput,
  promptFingerprint,
  hashFingerprint,
} from '@ai-reality/engine/llm';

/** Contenu d'un fichier `<hash>.json` : lisible à la main et stable (clés triées, retour à la ligne final). */
export interface Cassette {
  readonly promptHash: string;
  readonly purpose: LlmPurpose;
  readonly model: string;
  readonly request: PromptFingerprint;
  readonly response: { readonly text: string };
  readonly usage: LlmUsage;
}

/** Dossier `packages/testkit/cassettes/<suite>` (fonctionne depuis `src` comme depuis `dist`). */
export function cassetteDir(suite: string): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cassettes', suite);
}

export interface ReplayLLMOptions {
  /** Dossier des cassettes (voir `cassetteDir`). */
  readonly dir: string;
  /** Mode enregistrement : une cassette absente est produite en appelant `inner`. Défaut : `RECORD=1`. */
  readonly record?: boolean;
  /** LLM réel (ou scripté) utilisé en mode enregistrement. */
  readonly inner?: LLMPort;
}

/**
 * Rejoue des cassettes indexées par `prompt_hash`. Cassette absente ⇒ `LLM_CASSETTE_MISSING`,
 * sauf en mode enregistrement. Les identifiants d'appel sont dérivés du hash et du rang de répétition :
 * deux rejeux de la même séquence donnent les mêmes `llmCallId`.
 */
export class ReplayLLM implements LLMPort {
  private readonly dir: string;
  private readonly record: boolean;
  private readonly inner: LLMPort | undefined;
  private readonly seen = new Map<string, number>();

  constructor(options: ReplayLLMOptions) {
    this.dir = options.dir;
    this.record = options.record ?? process.env.RECORD === '1';
    this.inner = options.inner;
    if (this.record && !this.inner)
      throw new Error('ReplayLLM : le mode enregistrement exige un LLM interne (`inner`)');
  }

  async complete<T = unknown>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const fingerprint = promptFingerprint(req);
    const hash = hashFingerprint(fingerprint);
    const file = join(this.dir, `${hash}.json`);

    let cassette: Cassette | undefined = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as Cassette)
      : undefined;
    if (!cassette) {
      if (!this.record || !this.inner) throw llmCassetteMissing(hash, ` (${file})`);
      const real = await this.inner.complete(req);
      cassette = {
        promptHash: hash,
        purpose: req.purpose,
        model: real.model,
        request: fingerprint,
        response: { text: real.text },
        usage: real.usage,
      };
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(file, `${canonicalJson(cassette, 2)}\n`);
    }

    const rank = this.seen.get(hash) ?? 0;
    this.seen.set(hash, rank + 1);
    return {
      text: cassette.response.text,
      ...(req.output ? { data: parseStructuredOutput(cassette.response.text, req.output) } : {}),
      llmCallId: deriveUuid(`replay:${hash}:${String(rank)}`),
      model: cassette.model,
      usage: cassette.usage,
      latencyMs: 0,
    };
  }
}

import { defineConfig } from 'vitest/config';
import base from './vitest.config.js';

/**
 * Évaluations live (hors CI) : appellent le vrai LLM, coûtent de l'argent et ne sont jamais déterministes.
 * Chaque fichier se saute lui-même sans `ANTHROPIC_API_KEY`. Lancer : `ANTHROPIC_API_KEY=… pnpm test:live`.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['packages/*/tests/live/**/*.live.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});

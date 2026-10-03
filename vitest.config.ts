import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (path: string): string => fileURLToPath(new URL(`./packages/${path}`, import.meta.url));

export default defineConfig({
  // Les tests lisent les paquets du dépôt depuis leurs sources : une seule copie du moteur est chargée,
  // pas de dépendance cyclique de paquets, pas de `dist` périmé.
  // Alias exacts (regex ancrées) : `@ai-reality/engine` ne doit pas capter `@ai-reality/engine/llm`.
  resolve: {
    alias: [
      { find: /^@ai-reality\/engine$/, replacement: src('engine/src/index.ts') },
      { find: /^@ai-reality\/engine\/llm$/, replacement: src('engine/src/llm/index.ts') },
      { find: /^@ai-reality\/testkit$/, replacement: src('testkit/src/index.ts') },
      { find: /^@ai-reality\/storage-memory$/, replacement: src('storage-memory/src/index.ts') },
      { find: /^@ai-reality\/storage-prisma$/, replacement: src('storage-prisma/src/index.ts') },
      { find: /^@ai-reality\/llm-anthropic$/, replacement: src('llm-anthropic/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
    passWithNoTests: true,
    // Les tests Postgres partagent une seule base de test (vidée entre les cas) : un fichier à la fois.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
    },
  },
});

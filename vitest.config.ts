import { defineConfig } from 'vitest/config';

export default defineConfig({
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

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (pkg: string): string => fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  // Les tests du moteur (epoch, reprise) utilisent les adaptateurs et le testkit : on les lit depuis les sources,
  // pour qu'une seule copie du moteur soit chargée (pas de dépendance cyclique de paquets, pas de `dist` périmé).
  resolve: {
    alias: {
      '@ai-reality/engine': src('engine'),
      '@ai-reality/testkit': src('testkit'),
      '@ai-reality/storage-memory': src('storage-memory'),
      '@ai-reality/storage-prisma': src('storage-prisma'),
    },
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

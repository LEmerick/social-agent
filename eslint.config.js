import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Le moteur est déterministe : pas de source de hasard ni d'horloge réelle.
// Les adaptateurs (cli, storage, llm) peuvent les utiliser.
const engineFiles = ['packages/engine/src/**/*.ts'];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '.claude/**', '.claude-flow/**', '.swarm/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: engineFiles,
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Utiliser Rng (graine) — déterminisme requis.' },
        { object: 'Date', property: 'now', message: 'Utiliser Clock injectée — déterminisme requis.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
          message: 'Utiliser Clock injectée — déterminisme requis.',
        },
      ],
    },
  },
  {
    files: ['**/tests/**/*.ts', 'eslint.config.js', 'vitest.config.ts', 'vitest.live.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
);

#!/usr/bin/env node
/** Point d’entrée de `pnpm play` : lance l’interface terminal sur l’entrée et la sortie standard. */
import { runPlayApp } from './tui/app.js';

const seed = process.env['PLAY_SEED'];
const epochs = Number(process.env['PLAY_EPOCHS'] ?? '');

runPlayApp({
  input: process.stdin,
  output: process.stdout,
  env: process.env,
  ...(seed ? { seed } : {}),
  ...(Number.isInteger(epochs) && epochs > 0 ? { epochs } : {}),
}).then(
  (code) => {
    process.exitCode = code;
    process.stdin.destroy();
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    process.stdin.destroy();
  },
);

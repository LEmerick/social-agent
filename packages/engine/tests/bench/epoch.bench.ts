/**
 * Benchmarks du moteur (Vitest bench, `pnpm bench`) : époque scriptée de 12 personnages sur storage-memory,
 * ticks par seconde, requêtes (transactions et appels aux dépôts) par tick.
 */
import { test } from 'vitest';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { countingStorage, playScriptedEpoch, seeded12 } from '../helpers/bench-kit.js';

// Mesure unique, hors des itérations : requêtes par tick et ticks par seconde.
{
  const memory = createMemoryStorage();
  const fixture = await seeded12(memory);
  const { storage, counts, reset } = countingStorage(memory);
  reset();
  const start = performance.now();
  const result = await playScriptedEpoch(storage, fixture);
  const elapsed = performance.now() - start;
  const ticks = result.ticksPerEpoch + 1;
  const top = Object.entries(counts.byMethod)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ');
  console.log(
    [
      `[bench] époque de 12 personnages : ${elapsed.toFixed(0)} ms, ${((result.ticksPerEpoch * 1000) / elapsed).toFixed(0)} ticks/s`,
      `[bench] ${String(counts.tx)} transactions et ${String(counts.calls)} appels aux dépôts, soit ${(counts.tx / ticks).toFixed(2)} tx et ${(counts.calls / ticks).toFixed(1)} appels par tick`,
      `[bench] appels les plus fréquents : ${top}`,
      `[bench] phases (ms) : ${JSON.stringify(Object.fromEntries(Object.entries(result.metrics.phaseMs).map(([k, v]) => [k, Math.round(v)])))}`,
    ].join('\n'),
  );
}

test('époque scriptée, 12 personnages, storage-memory', async ({ bench }) => {
  await bench('une époque complète (32 ticks + clôture)', async () => {
    const storage = createMemoryStorage();
    const fixture = await seeded12(storage);
    await playScriptedEpoch(storage, fixture);
  }).run({ iterations: 5, warmupIterations: 1, time: 0 });
});

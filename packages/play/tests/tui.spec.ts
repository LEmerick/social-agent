import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runPlayApp } from '../src/index.js';

interface Run {
  readonly out: string;
  readonly code: number;
}

/** Joue l’interface en mode non-TTY : soit des lignes fixes, soit un répondeur qui lit l’écran. */
async function run(lines: readonly string[], env: Record<string, string> = {}, seed = 'tui'): Promise<Run> {
  const input = new PassThrough();
  const output = new PassThrough();
  let out = '';
  output.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
  const done = runPlayApp({ input, output, env, seed, epochs: 2 });
  for (const line of lines) input.write(`${line}\n`);
  input.end();
  const code = await done;
  return { out, code };
}

/** Répond selon la dernière question affichée ; `epochEndAnswer` répond à « époque suivante ». */
async function runAuto(
  answers: { character: string; epochEnd: string[] },
  env: Record<string, string> = {},
): Promise<Run> {
  const input = new PassThrough();
  const output = new PassThrough();
  let out = '';
  let screenStart = 0;
  const epochEnd = [...answers.epochEnd];
  output.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    out += text;
    if (!text.endsWith('> ')) return;
    const screen = out.slice(screenStart);
    screenStart = out.length;
    if (screen.includes('Ton choix')) input.write(`${answers.character}\n`);
    else if (screen.includes('Jouer l’époque suivante')) input.write(`${epochEnd.shift() ?? 'n'}\n`);
    else input.write('1\n');
  });
  const code = await runPlayApp({ input, output, env, seed: 'auto', epochs: 2 });
  return { out, code };
}

describe('interface terminal (sans TTY)', () => {
  it('affiche le choix du personnage, l’en-tête, les présents, le fil et la demande numérotée', async () => {
    const { out, code } = await run(['2', '1', 'q'], { NO_COLOR: '1' });
    expect(code).toBe(0);
    expect(out).toContain('Qui veux-tu incarner ?');
    for (const name of ['Alexandre', 'Sarah', 'Léa', 'Thomas']) expect(out).toContain(name);
    expect(out).toContain('tu es Sarah');
    expect(out).toMatch(/Époque 1 · tick 0\/32 · 08:00/);
    expect(out).toContain('Ce que tu perçois');
    expect(out).toContain('Où vas-tu ?');
    expect(out).toMatch(/\s1\) Aller : Chambres/);
    expect(out).toContain('Que fais-tu ?');
    expect(out).toContain('Ne rien faire');
    expect(out).toContain('À bientôt.');
  });

  it('répond aux raccourcis r, k, l et refuse une saisie invalide sans perdre la demande', async () => {
    const { out, code } = await run(['2', 'x', '99', 'r', 'k', 'l', '?', 'q'], { NO_COLOR: '1' });
    expect(code).toBe(0);
    expect(out).toContain('Réponse inconnue « x »');
    expect(out).toContain('hors de 1..8');
    expect(out).toContain('── Relations');
    expect(out).toContain('Léa (proche)');
    expect(out).toContain('── Ce que je sais');
    expect(out).toContain('a déjà participé à une autre émission');
    expect(out).toContain('── Journal');
    expect(out).toContain('Raccourcis : r relations');
  });

  it('répond aux raccourcis en pleine partie avec une entrée redirigée, et rappelle la demande', async () => {
    const { out } = await run(['1', '7', 'r', 'k', 'l', 'q'], { NO_COLOR: '1' });
    const afterRelations = out.slice(out.indexOf('── Relations'));
    expect(afterRelations).toContain('── Ce que je sais');
    expect(afterRelations).toContain('── Journal');
    // La demande est réaffichée après chaque raccourci : 1 fois à l’ouverture + 3 rappels.
    expect(out.split('Que fais-tu ?').length - 1).toBe(4);
    expect(out.trimEnd().endsWith('À bientôt.')).toBe(true);
  });

  it('quitte proprement quand l’entrée se termine', async () => {
    const { out, code } = await run(['1']);
    expect(code).toBe(0);
    expect(out).toContain('À bientôt.');
  });

  it('refuse un personnage invalide puis accepte un prénom', async () => {
    const { out } = await run(['9', 'thomas', 'q'], { NO_COLOR: '1' });
    expect(out).toContain('« 9 » n’est pas un choix valide.');
    expect(out).toContain('tu es Thomas');
  });

  it('joue une époque entière : résumé de fin, proposition de la suivante, deuxième époque', async () => {
    const { out, code } = await runAuto({ character: '1', epochEnd: ['o', 'n'] }, { NO_COLOR: '1' });
    expect(code).toBe(0);
    expect(out).toContain('Fin de l’époque 1');
    expect(out).toContain('Crédits : 100 →');
    expect(out).toContain('Statut : en jeu');
    expect(out).toContain('Jouer l’époque suivante ? (o/n)');
    expect(out).toMatch(/Époque 2 · tick 0\/32/);
    expect(out).toContain('Fin de l’époque 2');
    expect(out).toContain('Dernière époque terminée.');
  }, 60_000);

  it('est déterministe : même graine, mêmes réponses, même sortie', async () => {
    const a = await runAuto({ character: '3', epochEnd: ['n'] }, { NO_COLOR: '1' });
    const b = await runAuto({ character: '3', epochEnd: ['n'] }, { NO_COLOR: '1' });
    expect(b.out).toBe(a.out);
  }, 60_000);

  it('NO_COLOR coupe les couleurs ; FORCE_COLOR les active hors terminal', async () => {
    const plain = await run(['2', 'q'], { NO_COLOR: '1', FORCE_COLOR: '1' });
    expect(plain.out).not.toContain('\u001b[');
    const colored = await run(['2', 'q'], { FORCE_COLOR: '1' });
    expect(colored.out).toContain('\u001b[');
    const auto = await run(['2', 'q']);
    expect(auto.out).not.toContain('\u001b[');
  });

  it('signale une erreur de session sans planter', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let out = '';
    output.on('data', (c: Buffer) => (out += c.toString('utf8')));
    const done = runPlayApp({
      input,
      output,
      env: { NO_COLOR: '1' },
      createSession: () => Promise.reject(new Error('panne simulée')),
    });
    input.write('1\n');
    input.end();
    await expect(done).resolves.toBe(1);
    expect(out).toContain('panne simulée');
  });
});

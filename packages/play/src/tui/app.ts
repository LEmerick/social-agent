/**
 * Boucle de l’interface terminal (`node:readline` + ANSI). Fonctionne en terminal comme en entrée redirigée :
 * une ligne = une réponse, la fin du flux = quitter. Aucune dépendance.
 */
import { createInterface } from 'node:readline';
import type { LLMPort } from '@ai-reality/engine';
import { anthropicLLM } from '@ai-reality/llm-anthropic';
import { PLAYABLE_CHARACTERS, type PlaySession, type PlaySessionOptions, createPlaySession } from '../session/index.js';
import { CLEAR_SCREEN, colorEnabled, createStyle } from './ansi.js';
import {
  HELP,
  feedLines,
  headerLines,
  journalLines,
  knowledgeLines,
  relationsLines,
  requestLines,
  rule,
  summaryLines,
} from './render.js';

export interface PlayAppOptions {
  readonly input: NodeJS.ReadableStream & { readonly isTTY?: boolean };
  readonly output: NodeJS.WritableStream & { readonly isTTY?: boolean };
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Graine du monde. */
  readonly seed?: string;
  /** Nombre d’époques proposées (défaut 7). */
  readonly epochs?: number;
  /** Remplace la création de la session (tests). */
  readonly createSession?: (options: PlaySessionOptions) => Promise<PlaySession>;
}

/** Lignes d’entrée mises en file ; `null` quand le flux est fini. */
class LineReader {
  readonly #lines: string[] = [];
  readonly #waiters: ((line: string | null) => void)[] = [];
  #ended = false;

  constructor(input: NodeJS.ReadableStream, terminal: boolean, output: NodeJS.WritableStream) {
    const rl = createInterface({ input, ...(terminal ? { output } : {}), terminal });
    rl.on('line', (line) => {
      const waiter = this.#waiters.shift();
      if (waiter) waiter(line);
      else this.#lines.push(line);
    });
    rl.on('close', () => {
      this.#ended = true;
      for (const w of this.#waiters.splice(0)) w(null);
    });
  }

  read(): Promise<string | null> {
    const line = this.#lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.#ended) return Promise.resolve(null);
    return new Promise((resolve) => this.#waiters.push(resolve));
  }
}

const NUMBER = /^\d+$/;

/** Rend le code de sortie du processus. */
export async function runPlayApp(options: PlayAppOptions): Promise<number> {
  const env = options.env ?? {};
  const out = options.output;
  const tty = options.output.isTTY === true && options.input.isTTY === true;
  const style = createStyle(colorEnabled(env, options.output.isTTY === true));
  const print = (...lines: string[]): void => {
    out.write(`${lines.join('\n')}\n`);
  };
  const reader = new LineReader(options.input, tty, out);
  const ask = async (prompt: string): Promise<string | null> => {
    out.write(prompt);
    const line = await reader.read();
    // Sans terminal, la saisie n'est pas répétée à l'écran : on termine la ligne de prompt nous-mêmes.
    if (line === null || !tty) out.write('\n');
    return line?.trim() ?? null;
  };

  print(style.bold(style.cyan('AI Reality — incarne un personnage de la Maison des Palmiers')), '');

  // ── Choix du personnage ──
  let slug: string | null = null;
  while (slug === null) {
    print('Qui veux-tu incarner ?');
    PLAYABLE_CHARACTERS.forEach((c, i) => {
      print(`  ${style.bold(String(i + 1))}) ${c.name}`);
    });
    const answer = await ask('Ton choix (1-4, q pour quitter) > ');
    if (answer === null || answer.toLowerCase() === 'q') return farewell(print, style);
    const byNumber = NUMBER.test(answer) ? PLAYABLE_CHARACTERS[Number(answer) - 1] : undefined;
    const lowered = answer.toLowerCase();
    const byName = PLAYABLE_CHARACTERS.find((c) => c.slug === lowered || c.name.toLowerCase() === lowered);
    slug = (byNumber ?? byName)?.slug ?? null;
    if (slug === null) print(style.red(`« ${answer} » n’est pas un choix valide.`), '');
  }

  const llm: LLMPort | undefined =
    (env['ANTHROPIC_API_KEY'] ?? '') !== '' ? anthropicLLM({ apiKey: env['ANTHROPIC_API_KEY'] ?? '' }) : undefined;
  const create = options.createSession ?? createPlaySession;
  let session: PlaySession;
  try {
    session = await create({
      characterSlug: slug,
      epochs: options.epochs ?? 7,
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...(llm ? { llm } : {}),
    });
  } catch (error) {
    print(style.red(`Impossible de démarrer la partie : ${error instanceof Error ? error.message : String(error)}`));
    return 1;
  }
  print(
    '',
    style.dim(
      llm ? 'Les autres personnages sont joués par le LLM.' : 'Mode sans LLM : les autres personnages jouent seuls.',
    ),
  );
  print(style.dim(HELP), '');

  let shown = 0;
  try {
    for (;;) {
      const signal = await session.next();

      if (signal.kind === 'epoch_end') {
        print('', rule(style), ...summaryLines(signal.summary, style), rule(style));
        if (!signal.hasNext) return farewell(print, style, 'Dernière époque terminée.');
        const again = await ask('Jouer l’époque suivante ? (o/n) > ');
        if (again === null || !/^(o|oui|y|yes)$/i.test(again)) return farewell(print, style);
        session.nextEpoch();
        continue;
      }

      const { request } = signal;
      const log = session.log();
      const fresh = log.slice(shown);
      shown = log.length;
      if (tty) out.write(CLEAR_SCREEN);
      print(
        '',
        ...headerLines(session, style),
        rule(style, 'Ce que tu perçois'),
        ...feedLines(tty ? log.slice(-8) : fresh.slice(-12), style),
        rule(style),
        ...requestLines(request, style),
      );

      for (;;) {
        const answer = await ask('> ');
        if (answer === null) return farewell(print, style);
        const key = answer.toLowerCase();
        if (key === 'q') return farewell(print, style);
        const shortcut =
          key === 'r'
            ? [rule(style, 'Relations'), ...relationsLines(session, style)]
            : key === 'k'
              ? [rule(style, 'Ce que je sais'), ...knowledgeLines(session, style)]
              : key === 'l'
                ? [rule(style, 'Journal'), ...journalLines(session, style)]
                : key === '?' || key === 'h'
                  ? [style.dim(HELP)]
                  : null;
        // Après un raccourci, la demande en cours est rappelée : on sait toujours à quoi l'on répond.
        if (shortcut) print(...shortcut, rule(style), ...requestLines(request, style));
        else if (NUMBER.test(key)) {
          try {
            session.answer(request.id, Number(key));
            break;
          } catch (error) {
            print(style.red(error instanceof Error ? error.message : String(error)));
          }
        } else print(style.red(`Réponse inconnue « ${answer} ». ${HELP}`));
      }
    }
  } catch (error) {
    print(style.red(`La partie s’arrête : ${error instanceof Error ? error.message : String(error)}`));
    return 1;
  } finally {
    session.close();
  }
}

function farewell(print: (...lines: string[]) => void, style: ReturnType<typeof createStyle>, note?: string): number {
  print(...(note ? [note] : []), style.dim('À bientôt.'));
  return 0;
}

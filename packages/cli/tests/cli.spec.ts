/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des sorties connues */
import { describe, expect, it } from 'vitest';
import { cli, cliJson } from './helpers.js';

interface EpochJson {
  number: number;
  status: string;
  interactions: number;
  events: number;
  effects: number;
  sceneList: { id: string }[];
  important: unknown[];
}
interface CharacterJson {
  character: { slug: string };
  relations: { target: string }[];
  knowledge: { factId: string; text: string }[];
  credits: number;
}

describe('CLI ai-reality (en mémoire, sans sous-processus)', () => {
  it('run-epoch --memory joue l’époque et la résume en français', async () => {
    const { code, out } = await cli(['run-epoch', '--memory', '--epoch', '1', '--seed', 'cli-test']);
    expect(code).toBe(0);
    expect(out).toContain('Maison des Palmiers');
    expect(out).toContain('Époque 1 jouée.');
    expect(out).toContain('Époque 1 — terminée');
    expect(out).toContain('Événements importants');
  }, 60_000);

  it('run-epoch --json : sortie machine, politique aléatoire possible', async () => {
    const utility = await cliJson<EpochJson>(['run-epoch', '--memory', '--epoch', '0', '--seed', 's1']);
    expect(utility.code).toBe(0);
    expect(utility.data).toMatchObject({ number: 0, status: 'completed' });
    expect(utility.data.interactions).toBeGreaterThan(0);
    expect(utility.data.sceneList.length).toBeGreaterThan(0);
    const again = await cliJson<EpochJson>(['run-epoch', '--memory', '--epoch', '0', '--seed', 's1']);
    expect(again.data).toEqual(utility.data);

    const random = await cliJson<EpochJson>([
      'run-epoch',
      '--memory',
      '--epoch',
      '0',
      '--seed',
      's1',
      '--policy',
      'random',
    ]);
    expect(random.data.status).toBe('completed');
    expect(random.data).not.toEqual(utility.data);
  }, 60_000);

  it('replay : OK, empreintes stables, --json', async () => {
    const args = ['replay', '--memory', '--epochs', '2', '--seed', 'cli-replay'];
    const text = await cli(args);
    expect(text.code).toBe(0);
    expect(text.out).toContain('Rejeu de la saison 1 (2 époque(s)) : OK');
    expect(text.out).toMatch(/Empreinte de l’état : [0-9a-f]{64}/);

    const json = await cliJson<{ ok: boolean; epochs: number; stateHash: string; diffs: unknown[] }>(args);
    expect(json.code).toBe(0);
    expect(json.data).toMatchObject({ ok: true, epochs: 2, diffs: [] });
    expect(text.out).toContain(json.data.stateHash);
  }, 60_000);

  it('inspect character / scene / provenance / epoch', async () => {
    const base = ['--memory', '--epochs', '2', '--seed', 'cli-inspect'];

    const text = await cli(['inspect', 'character', 'sarah', ...base]);
    expect(text.code).toBe(0);
    expect(text.out).toContain('Sarah (sarah)');
    expect(text.out).toContain('Relations sortantes');
    expect(text.out).toContain('Connaissances');

    const sarah = await cliJson<CharacterJson>(['inspect', 'character', 'sarah', ...base]);
    expect(sarah.data.character.slug).toBe('sarah');
    expect(sarah.data.relations.length).toBeGreaterThan(0);
    expect(sarah.data.knowledge.length).toBeGreaterThan(0);

    // À la fin de l’époque 0, elle en savait moins qu’à la fin de l’époque 1.
    const early = await cliJson<CharacterJson>(['inspect', 'character', 'sarah', '--epoch', '0', ...base]);
    expect(early.data.knowledge.length).toBeLessThan(sarah.data.knowledge.length);

    const epoch = await cliJson<EpochJson>(['inspect', 'epoch', '1', ...base]);
    expect(epoch.data.number).toBe(1);
    const sceneId = epoch.data.sceneList[0]!.id;
    const scene = await cli(['inspect', 'scene', sceneId, ...base]);
    expect(scene.code).toBe(0);
    expect(scene.out).toContain(`Scène ${sceneId}`);
    expect(scene.out).toContain('Présences');
    expect(scene.out).toContain('Interactions');
    const prefix = await cli(['inspect', 'scene', sceneId.slice(0, 20), ...base]);
    expect(prefix.code === 0 || prefix.err.includes('ambigu')).toBe(true);

    const factId = sarah.data.knowledge[0]!.factId;
    const chain = await cli(['inspect', 'provenance', 'sarah', factId, ...base]);
    expect(chain.code).toBe(0);
    expect(chain.out).toContain('Provenance de');
    expect(chain.out).toContain('1. Sarah');
    const chainJson = await cliJson<{ chain: { step: number }[] }>(['inspect', 'provenance', 'sarah', factId, ...base]);
    expect(chainJson.data.chain.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('doctor : saison saine ⇒ aucun écart, code 0', async () => {
    const text = await cli(['doctor', '--memory', '--epochs', '2', '--seed', 'cli-doctor']);
    expect(text.code).toBe(0);
    expect(text.out).toContain('aucune anomalie');
    const json = await cliJson<{ ok: boolean; issues: unknown[] }>(['doctor', '--memory', '--seed', 'cli-doctor']);
    expect(json.data).toMatchObject({ ok: true, issues: [] });
  }, 60_000);

  it('erreurs d’usage : code 2 et message en français sur la sortie d’erreur', async () => {
    const unknown = await cli(['danse']);
    expect(unknown).toMatchObject({ code: 2, out: '' });
    expect(unknown.err).toContain('Commande inconnue');

    expect((await cli(['inspect', 'character', 'inconnu', '--memory'])).err).toContain('introuvable');
    expect((await cli(['run-epoch', '--epoch', 'x', '--memory'])).err).toContain('--epoch attend un entier');
    expect((await cli(['run-epoch', '--memory'])).code).toBe(0);
    expect((await cli(['run-epoch', '--epoch', '0'])).err).toContain('Aucune base');
    expect((await cli(['replay', '--memory', '--bidule'])).code).toBe(2);
    expect((await cli(['inspect', '--memory'])).err).toContain('inspect exige une cible');
    expect((await cli(['replay', '--memory', '--world', 'autre'])).err).toContain('introuvable');

    const help = await cli(['--help']);
    expect(help.code).toBe(0);
    expect(help.out).toContain('Usage : ai-reality');
    expect((await cli([])).code).toBe(2);
  }, 60_000);
});

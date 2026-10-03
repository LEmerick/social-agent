import { useEffect, useState } from 'react';
import type { Api } from '../api.js';
import type { Character } from '../types.js';

const BLURBS: Readonly<Record<string, string>> = {
  alexandre: 'Ancien commercial, séducteur et stratège.',
  sarah: 'Discrète, elle cache un secret.',
  lea: 'Chaleureuse et directe, alliée de Sarah.',
  thomas: 'Vif et taquin, rival d’Alexandre.',
};

interface Props {
  readonly api: Api;
  readonly onChoose: (slug: string, seed: string) => void;
  readonly error: string | null;
}

export function CharacterSelect({ api, onChoose, error }: Props) {
  const [characters, setCharacters] = useState<readonly Character[]>([]);
  const [seed, setSeed] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.characters().then(setCharacters, (e: unknown) => {
      setLoadError(e instanceof Error ? e.message : String(e));
    });
  }, [api]);

  return (
    <main className="choose">
      <h1>AI Reality</h1>
      <p className="lede">Incarne un personnage de la Maison des Palmiers et joue une époque.</p>
      {(error ?? loadError) !== null && (
        <p role="alert" className="alert">
          {error ?? loadError} — le serveur de jeu est-il lancé (<code>pnpm play:server</code>) ?
        </p>
      )}
      <ul className="cards">
        {characters.map((c) => (
          <li key={c.slug}>
            <button
              type="button"
              className="card"
              onClick={() => {
                onChoose(c.slug, seed.trim());
              }}
            >
              <strong>{c.name}</strong>
              <span>{BLURBS[c.slug] ?? ''}</span>
            </button>
          </li>
        ))}
      </ul>
      <label className="seed">
        Graine (facultatif)
        <input
          value={seed}
          onChange={(e) => {
            setSeed(e.target.value);
          }}
          placeholder="même graine, même monde"
        />
      </label>
    </main>
  );
}

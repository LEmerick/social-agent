import type { PlayMap, PlayerStatus } from '../types.js';

interface Props {
  readonly map: PlayMap | null;
  readonly status: PlayerStatus | null;
}

export function MapPanel({ map, status }: Props) {
  const here = status?.placeId ?? null;
  return (
    <aside className="panel left" aria-label="Carte et présents">
      <h2>Lieux</h2>
      <ul className="places">
        {(map?.locations ?? []).map((l) => {
          const route = map?.routes.find((r) => r.from === here && r.to === l.id);
          const current = l.id === here;
          return (
            <li
              key={l.id}
              className={current ? 'place current' : 'place'}
              aria-current={current ? 'location' : undefined}
            >
              <span className="place-name">{l.name}</span>
              <span className="place-meta">
                {current
                  ? status?.zone
                    ? `ici · ${status.zone}`
                    : 'ici'
                  : route
                    ? `${String(route.minutes)} min`
                    : l.zones.length > 0
                      ? l.zones.join(', ')
                      : ''}
              </span>
            </li>
          );
        })}
      </ul>
      {status?.moving === true && <p className="muted">Tu es en chemin…</p>}
      <h2>Présents</h2>
      {status === null || status.present.length === 0 ? (
        <p className="muted">{here === null ? 'Tu ne vois personne.' : 'Personne d’autre ici.'}</p>
      ) : (
        <ul className="people">
          {status.present.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
    </aside>
  );
}

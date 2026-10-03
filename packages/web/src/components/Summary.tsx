import { AXIS_LABELS, STATUS_LABELS } from '../labels.js';
import type { EpochEnd } from '../types.js';

interface Props {
  readonly end: EpochEnd;
  readonly onNext: () => void;
  readonly onQuit: () => void;
}

const signed = (n: number): string => (n > 0 ? `+${String(n)}` : String(n));

export function Summary({ end, onNext, onQuit }: Props) {
  const s = end.summary;
  return (
    <main className="summary">
      <h1>Fin de l’époque {s.epoch + 1}</h1>
      <dl>
        <dt>Crédits</dt>
        <dd>
          {s.creditsBefore} → <strong>{s.creditsAfter}</strong> ({signed(s.creditsAfter - s.creditsBefore)})
        </dd>
        <dt>Statut</dt>
        <dd>
          {STATUS_LABELS[s.statusBefore] ?? s.statusBefore}
          {s.statusBefore !== s.statusAfter && (
            <>
              {' '}
              → <strong>{STATUS_LABELS[s.statusAfter] ?? s.statusAfter}</strong>
            </>
          )}
        </dd>
        <dt>Vécu</dt>
        <dd>
          {s.interactions} interactions · {s.learned} choses apprises
        </dd>
      </dl>
      <h2>Tes sentiments qui ont le plus changé</h2>
      {s.relationChanges.length === 0 ? (
        <p className="muted">Rien n’a bougé.</p>
      ) : (
        <ul className="changes">
          {s.relationChanges.slice(0, 4).map((c) => (
            <li key={c.name}>
              <strong>{c.name}</strong> :{' '}
              {Object.entries(c.deltas)
                .map(([axis, d]) => `${(AXIS_LABELS[axis] ?? axis).toLowerCase()} ${signed(d)}`)
                .join(', ')}
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        {end.hasNext && (
          <button type="button" className="primary" onClick={onNext}>
            Époque suivante
          </button>
        )}
        <button type="button" onClick={onQuit}>
          Changer de personnage
        </button>
      </div>
    </main>
  );
}

import { AXES, AXIS_LABELS, STATUS_LABELS, STAT_LABELS } from '../labels.js';
import { gauge } from '../state.js';
import type { PlayerKnowledge, PlayerRelation, PlayerStatus } from '../types.js';

interface Props {
  readonly status: PlayerStatus | null;
  readonly relations: readonly PlayerRelation[];
  readonly knowledge: readonly PlayerKnowledge[];
}

function Bar({ label, pct, value, tone }: { label: string; pct: number; value: number; tone: string }) {
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div
        className={`bar ${tone}`}
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="fill" style={{ width: `${String(pct)}%` }} />
      </div>
      <span className="bar-value">{Math.round(value)}</span>
    </div>
  );
}

export function SidePanel({ status, relations, knowledge }: Props) {
  return (
    <aside className="panel right" aria-label="Toi, tes relations, ce que tu sais">
      <h2>{status?.name ?? 'Toi'}</h2>
      {status && (
        <>
          <div className="bars">
            {Object.entries(status.stats).map(([k, v]) => (
              <Bar key={k} label={STAT_LABELS[k] ?? k} pct={gauge(v)} value={v} tone="stat" />
            ))}
          </div>
          <p className="credits">
            Crédits <strong>{status.credits}</strong> · {STATUS_LABELS[status.status] ?? status.status}
          </p>
        </>
      )}
      <h2>Relations</h2>
      {relations.length === 0 && <p className="muted">Aucun lien pour l’instant.</p>}
      {relations.map((r) => (
        <details key={r.otherId} className="relation" open>
          <summary>
            <strong>{r.name}</strong> <span className="muted">{r.acquaintance}</span>
            {r.labels.length > 0 && <span className="muted"> · {r.labels.join(', ')}</span>}
          </summary>
          {AXES.filter((a) => (r.axes[a.key] ?? 0) !== 0).map((a) => (
            <Bar
              key={a.key}
              label={AXIS_LABELS[a.key] ?? a.key}
              pct={gauge(r.axes[a.key] ?? 0, a.min, a.max)}
              value={r.axes[a.key] ?? 0}
              tone={a.tone}
            />
          ))}
        </details>
      ))}
      <h2>Ce que je sais</h2>
      {knowledge.length === 0 && <p className="muted">Rien de particulier.</p>}
      <ul className="facts">
        {knowledge.map((k) => (
          <li key={k.factId}>
            {k.text}
            <span className="muted">
              {' '}
              ({k.source} ; {k.belief})
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

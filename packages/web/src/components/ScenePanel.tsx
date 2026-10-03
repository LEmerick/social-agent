import { useEffect, useRef } from 'react';
import { KIND_LABELS } from '../labels.js';
import type { PlayClock, PlayEvent, PlayRequest } from '../types.js';

interface Props {
  readonly events: readonly PlayEvent[];
  readonly request: PlayRequest | null;
  readonly clock: PlayClock | null;
  readonly waiting: boolean;
  readonly onAnswer: (n: number) => void;
}

function groups(request: PlayRequest): { title: string | null; options: PlayRequest['options'] }[] {
  const out: { title: string | null; options: PlayRequest['options'][number][] }[] = [];
  for (const o of request.options) {
    const title = o.group ?? null;
    const last = out[out.length - 1];
    if (last && last.title === title) last.options.push(o);
    else out.push({ title, options: [o] });
  }
  return out;
}

export function ScenePanel({ events, request, clock, waiting, onAnswer }: Props) {
  const feed = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <section className="panel center" aria-label="Scène">
      <header className="scene-head">
        <h2>Scène</h2>
        {clock && (
          <span className="clock">
            Époque {clock.epoch + 1} · tick {clock.tick}/{clock.ticksPerEpoch} · <strong>{clock.time}</strong>
          </span>
        )}
      </header>
      <ol className="feed" ref={feed} aria-live="polite">
        {events.length === 0 && <li className="muted">Rien ne s’est encore passé.</li>}
        {events.map((e) => (
          <li key={e.seq} className={`ev ev-${e.kind}`}>
            <time>{e.time}</time>
            <span className="tag">{KIND_LABELS[e.kind]}</span>
            <span className="text">{e.text}</span>
          </li>
        ))}
      </ol>
      <div className="ask">
        {request ? (
          <>
            <h3 id="prompt">{request.prompt}</h3>
            <div role="group" aria-labelledby="prompt">
              {groups(request).map((g, i) => (
                <div key={`${g.title ?? ''}-${String(i)}`} className="choices">
                  {g.title !== null && <h4>{g.title}</h4>}
                  {g.options.map((o) => (
                    <button
                      type="button"
                      key={o.n}
                      className="choice"
                      onClick={() => {
                        onAnswer(o.n);
                      }}
                    >
                      <kbd>{o.n}</kbd> {o.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <p className="muted hint">Touches 1 à 9 pour répondre au clavier.</p>
          </>
        ) : (
          <p className="muted">{waiting ? 'Le monde avance…' : ''}</p>
        )}
      </div>
    </section>
  );
}

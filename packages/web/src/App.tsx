import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { type Api, type ServerMessage, createApi } from './api.js';
import { CharacterSelect } from './components/CharacterSelect.js';
import { MapPanel } from './components/MapPanel.js';
import { ScenePanel } from './components/ScenePanel.js';
import { SidePanel } from './components/SidePanel.js';
import { Summary } from './components/Summary.js';
import { initialState, optionForKeys, reducer } from './state.js';

export function App({ api: injected }: { readonly api?: Api }) {
  const api = useMemo(() => injected ?? createApi(), [injected]);
  const [state, dispatch] = useReducer(reducer, initialState);
  const unsubscribe = useRef<(() => void) | null>(null);
  const sessionId = state.sessionId;

  const refresh = useCallback(
    async (id: string) => {
      const [s, relations, knowledge] = await Promise.all([api.status(id), api.relations(id), api.knowledge(id)]);
      dispatch({ type: 'snapshot', status: s.status, clock: s.clock, relations, knowledge });
    },
    [api],
  );

  const connect = useCallback(
    (id: string) => {
      unsubscribe.current?.();
      unsubscribe.current = api.subscribe(
        id,
        (m: ServerMessage) => {
          switch (m.type) {
            case 'hello':
              dispatch({ type: 'hello', player: m.player, map: m.map });
              break;
            case 'play':
              dispatch({ type: 'play', event: m.event });
              break;
            case 'request':
              dispatch({ type: 'request', request: m.request });
              void refresh(id).catch(() => undefined);
              break;
            case 'epoch_end':
              dispatch({ type: 'epoch_end', end: m.end });
              void refresh(id).catch(() => undefined);
              break;
            case 'error':
              dispatch({ type: 'failed', message: m.message });
              break;
          }
        },
        () => undefined,
      );
    },
    [api, refresh],
  );

  useEffect(
    () => () => {
      unsubscribe.current?.();
    },
    [],
  );

  const choose = (slug: string, seed: string): void => {
    dispatch({ type: 'creating' });
    api.create(slug, seed === '' ? undefined : seed).then(
      (created) => {
        dispatch({ type: 'created', sessionId: created.id, player: created.player, map: created.map });
        connect(created.id);
      },
      (e: unknown) => {
        dispatch({ type: 'failed', message: e instanceof Error ? e.message : String(e) });
      },
    );
  };

  const answer = useCallback(
    (n: number): void => {
      const request = state.request;
      if (!request || sessionId === null) return;
      dispatch({ type: 'answering' });
      api.answer(sessionId, request.id, n).catch((e: unknown) => {
        dispatch({ type: 'request', request });
        dispatch({ type: 'failed', message: e instanceof Error ? e.message : String(e) });
      });
    },
    [api, sessionId, state.request],
  );

  // Raccourcis clavier : chiffres (deux chiffres au-delà de 9 options, avec une courte attente).
  const keys = useRef({ buffer: '', timer: 0 });
  useEffect(() => {
    const request = state.request;
    if (!request) return;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || !/^\d$/.test(e.key) || target?.tagName === 'INPUT') return;
      window.clearTimeout(keys.current.timer);
      keys.current.buffer += e.key;
      const { n, wait } = optionForKeys(keys.current.buffer, request.options.length);
      if (n === null) {
        keys.current.buffer = '';
      } else if (wait) {
        keys.current.timer = window.setTimeout(() => {
          keys.current.buffer = '';
          answer(n);
        }, 600);
      } else {
        keys.current.buffer = '';
        answer(n);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(keys.current.timer);
      keys.current.buffer = '';
    };
  }, [state.request, answer]);

  const quit = (): void => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    dispatch({ type: 'reset' });
  };

  if (state.screen === 'choose') return <CharacterSelect api={api} onChoose={choose} error={state.error} />;
  if (state.screen === 'failed') {
    return (
      <main className="choose">
        <p role="alert" className="alert">
          {state.error}
        </p>
        <button type="button" onClick={quit}>
          Revenir au choix du personnage
        </button>
      </main>
    );
  }
  if (state.screen === 'epoch_end' && state.end) {
    return (
      <Summary
        end={state.end}
        onNext={() => {
          if (sessionId === null) return;
          dispatch({ type: 'next_epoch' });
          api.nextEpoch(sessionId).catch((e: unknown) => {
            dispatch({ type: 'failed', message: e instanceof Error ? e.message : String(e) });
          });
        }}
        onQuit={quit}
      />
    );
  }
  return (
    <div className="game">
      <MapPanel map={state.map} status={state.status} />
      <ScenePanel
        events={state.events}
        request={state.request}
        clock={state.clock}
        waiting={state.waiting || state.screen === 'loading'}
        onAnswer={answer}
      />
      <SidePanel status={state.status} relations={state.relations} knowledge={state.knowledge} />
    </div>
  );
}

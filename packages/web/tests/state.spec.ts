import { describe, expect, it } from 'vitest';
import { MAX_EVENTS, gauge, initialState, optionForKeys, reducer } from '../src/state.js';
import type { EpochEnd, PlayEvent, PlayRequest } from '../src/types.js';

const event = (seq: number): PlayEvent => ({
  seq,
  epoch: 0,
  tick: seq,
  time: '08:00',
  kind: 'heard',
  text: `e${String(seq)}`,
});
const request: PlayRequest = {
  id: 'req-1',
  kind: 'action',
  epoch: 0,
  tick: 1,
  time: '08:30',
  prompt: 'Que fais-tu ?',
  options: [{ n: 1, label: 'Ne rien faire' }],
  context: { place: 'Salon', zone: null, present: [] },
};
const end: EpochEnd = {
  kind: 'epoch_end',
  hasNext: true,
  summary: {
    epoch: 0,
    creditsBefore: 100,
    creditsAfter: 90,
    statusBefore: 'active',
    statusAfter: 'active',
    relationChanges: [],
    interactions: 3,
    learned: 1,
  },
};
const player = { id: 'p', slug: 'sarah', name: 'Sarah' };
const map = { locations: [], routes: [] };

describe('réducteur', () => {
  it('suit le cycle création, demande, réponse, fin d’époque, époque suivante', () => {
    let s = reducer(initialState, { type: 'creating' });
    expect(s.screen).toBe('loading');
    s = reducer(s, { type: 'created', sessionId: 'abc', player, map });
    expect(s).toMatchObject({ sessionId: 'abc', player });
    s = reducer(s, { type: 'request', request });
    expect(s).toMatchObject({ screen: 'playing', request, waiting: false });
    s = reducer(s, { type: 'answering' });
    expect(s).toMatchObject({ request: null, waiting: true });
    s = reducer(s, { type: 'epoch_end', end });
    expect(s).toMatchObject({ screen: 'epoch_end', end });
    s = reducer(s, { type: 'next_epoch' });
    expect(s).toMatchObject({ screen: 'loading', end: null, waiting: true });
    s = reducer(s, { type: 'request', request });
    expect(s.screen).toBe('playing');
  });

  it('ajoute les événements dans l’ordre, ignore les doublons rejoués et borne le fil', () => {
    let s = initialState;
    for (const seq of [0, 1, 2, 1, 0]) s = reducer(s, { type: 'play', event: event(seq) });
    expect(s.events.map((e) => e.seq)).toEqual([0, 1, 2]);
    for (let i = 3; i < MAX_EVENTS + 20; i++) s = reducer(s, { type: 'play', event: event(i) });
    expect(s.events).toHaveLength(MAX_EVENTS);
    expect(s.events[s.events.length - 1]?.seq).toBe(MAX_EVENTS + 19);
  });

  it('range un instantané sans toucher à la demande en cours', () => {
    const s = reducer(reducer(initialState, { type: 'request', request }), {
      type: 'snapshot',
      status: {
        name: 'Sarah',
        status: 'active',
        stats: { energy: 90 },
        credits: 100,
        place: 'Salon',
        placeId: 'l',
        zone: null,
        moving: false,
        present: [],
      },
      clock: { epoch: 0, tick: 1, ticksPerEpoch: 32, time: '08:30' },
      relations: [],
      knowledge: [],
    });
    expect(s.request).toBe(request);
    expect(s.status?.credits).toBe(100);
    expect(s.clock?.time).toBe('08:30');
  });

  it('une erreur avant la session revient au choix ; après, à l’écran d’échec', () => {
    expect(reducer({ ...initialState, screen: 'loading' }, { type: 'failed', message: 'x' })).toMatchObject({
      screen: 'choose',
      error: 'x',
    });
    expect(
      reducer({ ...initialState, sessionId: 's', screen: 'playing' }, { type: 'failed', message: 'y' }).screen,
    ).toBe('failed');
    expect(reducer({ ...initialState, sessionId: 's' }, { type: 'reset' })).toEqual(initialState);
  });
});

describe('raccourcis clavier', () => {
  it('répond tout de suite jusqu’à 9 options', () => {
    expect(optionForKeys('3', 8)).toEqual({ n: 3, wait: false });
    expect(optionForKeys('9', 9)).toEqual({ n: 9, wait: false });
    expect(optionForKeys('9', 5)).toEqual({ n: null, wait: false });
    expect(optionForKeys('0', 5)).toEqual({ n: null, wait: false });
  });

  it('attend la touche suivante quand le numéro peut se prolonger', () => {
    expect(optionForKeys('1', 25)).toEqual({ n: 1, wait: true });
    expect(optionForKeys('12', 25)).toEqual({ n: 12, wait: false });
    expect(optionForKeys('3', 25)).toEqual({ n: 3, wait: false });
    expect(optionForKeys('1', 9)).toEqual({ n: 1, wait: false });
  });
});

describe('jauges', () => {
  it('ramène une valeur à un pourcentage borné', () => {
    expect(gauge(50)).toBe(50);
    expect(gauge(150)).toBe(100);
    expect(gauge(-5)).toBe(0);
    expect(gauge(0, -100, 100)).toBe(50);
  });
});

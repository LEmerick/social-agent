import { describe, expect, it } from 'vitest';
import { shortestRoute } from '../../src/world/shortest-route.js';

const r = (fromLocationId: string, toLocationId: string, travelTicks: number) => ({
  fromLocationId,
  toLocationId,
  travelTicks,
});

describe('shortestRoute', () => {
  it('même lieu : 0 tick, chemin réduit au départ', () => {
    expect(shortestRoute({ routes: [] }, 'a', 'a')).toEqual({ travelTicks: 0, path: ['a'] });
  });

  it('route directe', () => {
    expect(shortestRoute({ routes: [r('a', 'b', 2)] }, 'a', 'b')).toEqual({ travelTicks: 2, path: ['a', 'b'] });
  });

  it('préfère un détour plus court à une route directe plus longue', () => {
    const routes = [r('a', 'c', 5), r('a', 'b', 1), r('b', 'c', 2)];
    expect(shortestRoute({ routes }, 'a', 'c')).toEqual({ travelTicks: 3, path: ['a', 'b', 'c'] });
  });

  it('respecte le sens des routes', () => {
    const routes = [r('a', 'b', 1)];
    expect(shortestRoute({ routes }, 'a', 'b')?.travelTicks).toBe(1);
    expect(shortestRoute({ routes }, 'b', 'a')).toBeUndefined();
  });

  it('renvoie undefined si la destination est inaccessible ou inconnue', () => {
    const routes = [r('a', 'b', 1), r('c', 'd', 1)];
    expect(shortestRoute({ routes }, 'a', 'd')).toBeUndefined();
    expect(shortestRoute({ routes }, 'a', 'inconnu')).toBeUndefined();
    expect(shortestRoute({ routes: [] }, 'a', 'b')).toBeUndefined();
  });

  it('égalité de durée : départage de façon déterministe, quel que soit l’ordre des routes', () => {
    const routes = [r('a', 'x', 1), r('a', 'y', 1), r('x', 'z', 1), r('y', 'z', 1)];
    const forward = shortestRoute({ routes }, 'a', 'z');
    const backward = shortestRoute({ routes: [...routes].reverse() }, 'a', 'z');
    expect(forward).toEqual({ travelTicks: 2, path: ['a', 'x', 'z'] });
    expect(backward).toEqual(forward);
  });

  it('gère un cycle sans boucler', () => {
    const routes = [r('a', 'b', 1), r('b', 'a', 1), r('b', 'c', 1)];
    expect(shortestRoute({ routes }, 'a', 'c')).toEqual({ travelTicks: 2, path: ['a', 'b', 'c'] });
  });
});

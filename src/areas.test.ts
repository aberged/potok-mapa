import { describe, expect, it } from 'vitest';
import {
  areasAt,
  contains,
  distance,
  inBox,
  isDrawn,
  isLine,
  levelFor,
  lineEnd,
  lineLatLngs,
  outerRings,
  shapeArea,
  shown,
  spanPx,
  type Geo,
} from './areas';
import catalogue from './dev-catalogue.json';
import { iconKeys, type Pins } from './places';
import type { PotokPlace } from './potok';

const square = (lat: number, lng: number, half: number): [number, number][] => [
  [lng - half, lat - half],
  [lng + half, lat - half],
  [lng + half, lat + half],
  [lng - half, lat + half],
  [lng - half, lat - half],
];

const geo = (...polygons: [number, number][][][]): Geo => ({ type: 'MultiPolygon', coordinates: polygons });

const point = (id: number, kind = 'chat', areas: number[] = []): PotokPlace => ({
  id,
  name: `Mesto ${id}`,
  lat: 45.25,
  lng: 19.85,
  kind,
  pin: null,
  picture_url: null,
  is_public: true,
  shape: 'point',
  areas,
});

const area = (id: number, half: number, areas: number[] = []): PotokPlace => ({
  ...point(id, 'folder', areas),
  shape: 'area',
  bbox: [19.85 - half, 45.25 - half, 19.85 + half, 45.25 + half],
  v: 1,
});

describe('drawing an area', () => {
  it('asks for borders at the level of detail at or above its zoom', () => {
    expect(levelFor(3)).toBe(6);
    expect(levelFor(11)).toBe(12);
    expect(levelFor(12)).toBe(12);
    expect(levelFor(19)).toBe(16);
  });

  it('draws a border once the area is 64 pixels wide, two pins, as Potok does', () => {
    // 0.1° wide and ~0.14° tall as Mercator stretches it: ~52 px at zoom 9,
    // ~103 px at zoom 10.
    expect(spanPx(area(1, 0.05), 9)).toBeLessThan(64);
    expect(isDrawn(area(1, 0.05), 9)).toBe(false);
    expect(isDrawn(area(1, 0.05), 10)).toBe(true);
    expect(isDrawn(point(2), 18)).toBe(false);
  });
});

describe('what the map shows', () => {
  const city = area(10, 0.2);
  const quarter = area(11, 0.05, [10]);
  const shop = point(1, 'chat', [11, 10]);
  const poll = point(2, 'polls', []);
  const places = [shop, poll, quarter, city];
  const layers = { places: true, areas: true, routes: true };

  it('borders of the wide areas, biggest first; every place a pin, areas too', () => {
    const { borders, pins } = shown(places, { layers, kind: null, inside: null, zoom: 10 });
    expect(borders.map((place) => place.id)).toEqual([10, 11]);
    expect(pins.map((place) => place.id)).toEqual([1, 2, 11, 10]);

    const far = shown(places, { layers, kind: null, inside: null, zoom: 8 });
    expect(far.borders.map((place) => place.id)).toEqual([10]);
    expect(far.pins.map((place) => place.id)).toEqual([1, 2, 11, 10]);
  });

  it('the kind chips and the search keep areas or leave them out like any place', () => {
    const chips = shown(places, { layers, kind: 'polls', inside: null, zoom: 8 });
    expect(chips.borders).toEqual([]);
    expect(chips.pins.map((place) => place.id)).toEqual([2]);

    const folders = shown(places, { layers, kind: 'folder', inside: null, zoom: 8 });
    expect(folders.borders.map((place) => place.id)).toEqual([10]);
    expect(folders.pins.map((place) => place.id)).toEqual([11, 10]);

    const named = shown(places, { layers, kind: null, inside: null, zoom: 10, search: 'МЕСТО 1' });
    expect(named.borders.map((place) => place.id)).toEqual([10, 11]);
    expect(named.pins.map((place) => place.id)).toEqual([1, 11, 10]);
  });

  it('with places off, only the areas', () => {
    const off = shown(places, { layers: { places: false, areas: true, routes: false }, kind: null, inside: null, zoom: 8 });
    expect(off.borders.map((place) => place.id)).toEqual([10]);
    expect(off.pins.map((place) => place.id)).toEqual([11, 10]);
  });

  it('draws only the borders reaching into the view', () => {
    const { borders } = shown(places, { layers, kind: null, inside: null, zoom: 10 });
    expect(inBox(borders, [19.0, 45.0, 20.5, 45.5], 300).map((place) => place.id)).toEqual([10, 11]);
    expect(inBox(borders, [21.0, 44.0, 22.0, 44.5], 300)).toEqual([]);
    expect(inBox(borders, [19.0, 45.0, 20.5, 45.5], 1).map((place) => place.id)).toEqual([10]);
  });

  it('with areas off, every place is a pin by the chips', () => {
    const { borders, pins } = shown(places, { layers: { places: true, areas: false, routes: true }, kind: null, inside: null, zoom: 10 });
    expect(borders).toEqual([]);
    expect(pins.map((place) => place.id)).toEqual([1, 2, 11, 10]);
  });

  it('only inside an area: the places it holds, not the area itself', () => {
    const { borders, pins } = shown(places, { layers, kind: null, inside: 10, zoom: 8 });
    expect(borders).toEqual([]);
    expect(pins.map((place) => place.id)).toEqual([1, 11]);
  });
});

describe('the pin filter', () => {
  const icons = iconKeys(catalogue.pins as Pins);
  const layers = { places: true, areas: true, routes: true };
  const killed = { ...point(1), name: 'Poginuli · Barajevo', pin: 'problem' };
  const injured = { ...point(2), name: 'Povređeni · Barajevo', pin: 'warning' };
  const damage = { ...point(3), name: 'Materijalna šteta · Niš', pin: 'transport' };
  const plain = point(4);
  const retired = { ...point(5), pin: 'retired' };
  const city = { ...area(10, 0.2), pin: 'institution' };
  const places = [killed, injured, damage, plain, retired, city];
  const only = (...keys: string[]) => ({ keys: new Set(keys), icons });
  const ids = (options: Parameters<typeof shown>[1]) => shown(places, options).pins.map((place) => place.id);

  it('keeps the places that show any of the pins picked', () => {
    expect(ids({ layers, kind: null, inside: null, zoom: 8, pins: only('problem') })).toEqual([1]);
    expect(ids({ layers, kind: null, inside: null, zoom: 8, pins: only('problem', 'warning') })).toEqual([1, 2]);
  });

  it('keeps every place with none picked', () => {
    expect(ids({ layers, kind: null, inside: null, zoom: 8, pins: only() })).toEqual([1, 2, 3, 4, 5, 10]);
    expect(ids({ layers, kind: null, inside: null, zoom: 8, pins: null })).toEqual([1, 2, 3, 4, 5, 10]);
  });

  it('"kind" keeps the places that show their kind, an icon the catalogue lost too', () => {
    expect(ids({ layers, kind: null, inside: null, zoom: 8, pins: only('kind') })).toEqual([4, 5]);
  });

  it('works with the search, and keeps an area by its pin and its border with it', () => {
    expect(ids({ layers, kind: null, inside: null, zoom: 8, pins: only('problem', 'transport'), search: 'barajevo' })).toEqual([1]);

    const areas = shown(places, { layers, kind: null, inside: null, zoom: 8, pins: only('institution') });
    expect(areas.pins.map((place) => place.id)).toEqual([10]);
    expect(areas.borders.map((place) => place.id)).toEqual([10]);
    expect(shown(places, { layers, kind: null, inside: null, zoom: 8, pins: only('problem') }).borders).toEqual([]);
  });
});

describe('a border', () => {
  // A square with a hole in its middle, and a second part to the north.
  const holed = geo([square(45.25, 19.85, 0.1), square(45.25, 19.85, 0.02)], [square(45.6, 19.85, 0.05)]);

  it('holds a point inside, not one in its hole or outside', () => {
    expect(contains(holed, 45.3, 19.85)).toBe(true);
    expect(contains(holed, 45.25, 19.85)).toBe(false);
    expect(contains(holed, 45.6, 19.85)).toBe(true);
    expect(contains(holed, 44.0, 19.85)).toBe(false);
  });

  it('measures its size without its holes', () => {
    const plain = geo([square(45.25, 19.85, 0.1)]);
    expect(shapeArea(plain)).toBeCloseTo(0.04, 6);
    expect(shapeArea(holed)).toBeCloseTo(0.04 - 0.0016 + 0.01, 6);
  });

  it('lists the areas at a spot, smallest first', () => {
    const drawn = [
      { id: 10, geo: geo([square(45.25, 19.85, 0.2)]) },
      { id: 11, geo: geo([square(45.25, 19.85, 0.05)]) },
      { id: 12, geo: geo([square(44.0, 21.0, 0.05)]) },
    ];

    expect(areasAt(drawn, 45.26, 19.86)).toEqual([11, 10]);
    expect(areasAt(drawn, 43.0, 19.86)).toEqual([]);
  });

  it('gives its outer rings as holes for the dimming', () => {
    expect(outerRings(holed)).toHaveLength(2);
    expect(outerRings(holed)[0][0]).toEqual([45.15, 19.75]);
  });
});

describe('a route', () => {
  const quarter = area(11, 0.05);
  // From west of the quarter, through it: it lies in the quarter by its line.
  const walk: PotokPlace = {
    ...point(30, 'chat', [11]),
    lng: 19.6,
    shape: 'route',
    bbox: [19.6, 45.25, 19.95, 45.26],
    v: 1,
    length: 27_400,
  };
  const shop = point(1, 'chat', [11]);
  const places = [shop, quarter, walk];
  const layers = { places: true, areas: true, routes: true };

  it('is a line once 64 pixels wide, a pin before that', () => {
    // 0.35 degrees: 63.7 px at zoom 8, 127 px at zoom 9.
    expect(isLine(walk, 8)).toBe(false);
    expect(isLine(walk, 9)).toBe(true);
    expect(isLine(quarter, 12)).toBe(false);

    const far = shown(places, { layers, kind: null, inside: null, zoom: 7 });
    expect(far.lines).toEqual([]);
    expect(far.pins.map((place) => place.id)).toEqual([1, 11, 30]);

    const near = shown(places, { layers, kind: null, inside: null, zoom: 12 });
    expect(near.lines.map((place) => place.id)).toEqual([30]);
    expect(near.pins.map((place) => place.id)).toContain(30);
  });

  it('has a layer of its own, and without places the shapes whose layer is on', () => {
    expect(shown(places, { layers: { ...layers, routes: false }, kind: null, inside: null, zoom: 12 }).lines).toEqual([]);

    const onlyRoutes = shown(places, { layers: { places: false, areas: false, routes: true }, kind: null, inside: null, zoom: 12 });
    expect(onlyRoutes.pins.map((place) => place.id)).toEqual([30]);

    const shapes = shown(places, { layers: { places: false, areas: true, routes: true }, kind: null, inside: null, zoom: 12 });
    expect(shapes.pins.map((place) => place.id)).toEqual([11, 30]);
  });

  it('stays "only inside" an area it passes through', () => {
    const { lines, pins } = shown(places, { layers, kind: null, inside: 11, zoom: 12 });
    expect(pins.map((place) => place.id)).toEqual([1, 30]);
    expect(lines.map((place) => place.id)).toEqual([30]);
  });

  it('gives its parts to Leaflet and its end, none for a loop', () => {
    const parts = lineLatLngs({ type: 'MultiLineString', coordinates: [[[19.8, 45.2], [19.9, 45.3]], [[20.0, 45.4]]] });
    expect(parts).toEqual([[[45.2, 19.8], [45.3, 19.9]]]);
    expect(lineEnd(parts)).toEqual([45.3, 19.9]);

    const loop = lineLatLngs({ type: 'MultiLineString', coordinates: [[[19.8, 45.2], [19.9, 45.3], [19.8, 45.2]]] });
    expect(lineEnd(loop)).toBeNull();
  });

  it('says its length as a person reads it', () => {
    expect(distance(847, 'sr')).toBe('850 m');
    expect(distance(1_349, 'sr')).toBe('1,3 km');
    expect(distance(1_349, 'sr-Cyrl')).toBe('1,3 km');
    expect(distance(1_349, 'en')).toBe('1.3 km');
    expect(distance(27_400, 'en')).toBe('27 km');
  });
});

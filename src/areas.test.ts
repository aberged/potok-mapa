import { describe, expect, it } from 'vitest';
import { areasAt, contains, isDrawn, levelFor, outerRings, shapeArea, shown, spanPx, type Geo } from './areas';
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

  it('draws a border once the area is 28 pixels wide, as Potok does', () => {
    // 0.1° is ~9 px at zoom 7 and ~36 px at zoom 9.
    expect(spanPx(area(1, 0.05), 7)).toBeLessThan(28);
    expect(isDrawn(area(1, 0.05), 7)).toBe(false);
    expect(isDrawn(area(1, 0.05), 9)).toBe(true);
    expect(isDrawn(point(2), 18)).toBe(false);
  });
});

describe('what the map shows', () => {
  const city = area(10, 0.2);
  const quarter = area(11, 0.05, [10]);
  const shop = point(1, 'chat', [11, 10]);
  const poll = point(2, 'polls', []);
  const places = [shop, poll, quarter, city];
  const layers = { places: true, areas: true };

  it('borders of the wide areas, biggest first; pins of the rest', () => {
    const { borders, pins } = shown(places, { layers, kind: null, inside: null, zoom: 9 });
    expect(borders.map((place) => place.id)).toEqual([10, 11]);
    expect(pins.map((place) => place.id)).toEqual([1, 2]);
  });

  it('an area too small to draw is a pin, whatever the kind chips or with places off', () => {
    const chips = shown(places, { layers, kind: 'polls', inside: null, zoom: 7 });
    expect(chips.borders.map((place) => place.id)).toEqual([10]);
    expect(chips.pins.map((place) => place.id)).toEqual([2, 11]);

    const off = shown(places, { layers: { places: false, areas: true }, kind: null, inside: null, zoom: 7 });
    expect(off.pins.map((place) => place.id)).toEqual([11]);
  });

  it('with areas off, every place is a pin by the chips', () => {
    const { borders, pins } = shown(places, { layers: { places: true, areas: false }, kind: null, inside: null, zoom: 9 });
    expect(borders).toEqual([]);
    expect(pins.map((place) => place.id)).toEqual([1, 2, 11, 10]);
  });

  it('only inside an area: the pins it holds, not the area itself', () => {
    const { borders, pins } = shown(places, { layers, kind: null, inside: 10, zoom: 7 });
    expect(borders.map((place) => place.id)).toEqual([10]);
    expect(pins.map((place) => place.id)).toEqual([1, 11]);
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

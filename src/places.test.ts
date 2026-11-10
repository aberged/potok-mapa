import { describe, expect, it } from 'vitest';
import catalogue from './dev-catalogue.json';
import { keys, translator } from './i18n';
import { clusterHtml, escapeAttribute, pinSvg } from './pins';
import {
  buildIndex,
  clusterSize,
  inView,
  kindsOnMap,
  lookOf,
  ofKind,
  ringGradient,
  sameSpot,
  savedBounds,
  type Pins,
} from './places';
import type { PotokPlace } from './potok';

const pins = catalogue.pins as Pins;

const place = (id: number, lat: number, lng: number, kind = 'chat', pin: string | null = null): PotokPlace => ({
  id,
  name: `Mesto ${id}`,
  lat,
  lng,
  kind,
  pin,
  picture_url: `/avatar/group/${id}`,
  is_public: true,
  shape: 'point',
  areas: [],
});

describe('a pin', () => {
  it('shows its own icon in its tone', () => {
    const look = lookOf(place(1, 44, 20, 'chat', 'shop'), pins);
    expect(look.tone).toBe('places');
    expect(look.color).toBe(pins.tones.places);
    expect(look.paths).toEqual(pins.icons.find((icon) => icon.key === 'shop')!.paths);
  });

  it("shows its kind's when it chose nothing, or an icon the catalogue no longer has", () => {
    const chat = pins.kinds.find((kind) => kind.key === 'chat')!;
    expect(lookOf(place(1, 44, 20, 'chat'), pins).paths).toEqual(chat.paths);
    expect(lookOf(place(1, 44, 20, 'chat', 'retired'), pins).paths).toEqual(chat.paths);
  });

  it('falls back to no kind for a kind it does not know', () => {
    const none = pins.kinds.find((kind) => kind.key === 'none')!;
    expect(lookOf(place(1, 44, 20, 'castle'), pins).paths).toEqual(none.paths);
  });

  it("shows the group's picture when it chose that", () => {
    const look = lookOf(place(7, 44, 20, 'page', 'picture'), pins);
    expect(look.picture).toBe('/avatar/group/7');
    expect(pinSvg(look, pins)).toContain('href="/avatar/group/7"');
  });

  it('draws a lock for a closed group, and escapes what it is given', () => {
    const look = lookOf(place(1, 44, 20), pins);
    expect(pinSvg(look, pins, { locked: true })).toContain('<rect');
    expect(pinSvg(look, pins)).not.toContain('<rect');
    expect(escapeAttribute('"><script>')).toBe('&quot;&gt;&lt;script&gt;');
  });
});

describe('clusters', () => {
  it('grow a step for each order of magnitude', () => {
    expect([1, 9, 10, 99, 100, 999, 1000, 50_000].map(clusterSize)).toEqual([36, 36, 44, 44, 52, 52, 60, 60]);
  });

  it("ring the tones of their places in proportion, in the catalogue's order", () => {
    const ring = ringGradient({ places: 1, kind: 3 }, pins.tones);
    expect(ring).toMatch(/^conic-gradient\(/);
    expect(ring.indexOf(pins.tones.kind)).toBeLessThan(ring.indexOf(pins.tones.places));
    expect(ring).toContain(`${pins.tones.kind} 0deg 270deg`);
    expect(ring).toContain(`${pins.tones.places} 270deg 360deg`);
    expect(ringGradient({ nature: 5 }, pins.tones)).toBe(pins.tones.nature);
  });

  it('count the tones of the places they hold', () => {
    const index = buildIndex(
      [place(1, 44.8, 20.4, 'chat'), place(2, 44.8001, 20.4001, 'chat', 'shop'), place(3, 44.8002, 20.4002, 'page')],
      pins,
      19,
    );
    const [cluster] = index.getClusters([19, 44, 21, 45], 5);

    expect(cluster.properties).toMatchObject({ cluster: true, point_count: 3, tones: { kind: 2, places: 1 } });
    expect(clusterHtml(3, 36, 'red', '3 mesta')).toContain('aria-label="3 mesta"');
  });

  it('hold places at one address together up to the last zoom', () => {
    const index = buildIndex([place(1, 44.8, 20.4), place(2, 44.8, 20.4)], pins, 19);
    const [cluster] = index.getClusters([19, 44, 21, 45], 19);

    expect('cluster' in cluster.properties && cluster.properties.cluster).toBe(true);
    expect(sameSpot([place(1, 44.8, 20.4), place(2, 44.8, 20.4)])).toBe(true);
    expect(sameSpot([place(1, 44.8, 20.4), place(2, 44.81, 20.4)])).toBe(false);
    expect(sameSpot([place(1, 44.8, 20.4)])).toBe(false);
  });
});

describe('the places shown', () => {
  const places = [place(3, 44.8, 20.4, 'page'), place(1, 45.25, 19.85, 'chat'), place(2, 43.3, 21.9, 'chat')];

  it('narrow to one kind, and list the kinds on the map in the catalogue order', () => {
    expect(ofKind(places, 'chat').map((row) => row.id)).toEqual([1, 2]);
    expect(ofKind(places, null)).toHaveLength(3);
    expect(kindsOnMap(places, pins).map((kind) => [kind.key, kind.count])).toEqual([
      ['chat', 2],
      ['page', 1],
    ]);
  });

  it('in view are those inside the bounds, by name', () => {
    expect(inView(places, [[44, 19], [46, 21]], 'sr').map((row) => row.id)).toEqual([1, 3]);
    expect(inView([place(9, 0, 179.5), place(8, 0, -179.5)], [[-1, 179], [1, -179]], 'en')).toHaveLength(2);
  });

  it('the saved view is two corners, or nothing', () => {
    expect(savedBounds({ view: { bounds: [[44, 19], [46, 21]] } })).toEqual([[44, 19], [46, 21]]);
    expect(savedBounds({ view: { bounds: [[44, 19]] } })).toBeNull();
    expect(savedBounds({ view: { bounds: [['44', 19], [46, 21]] } })).toBeNull();
    expect(savedBounds(null)).toBeNull();
  });
});

describe('the words', () => {
  it('every language has every word, and fills in numbers', () => {
    expect(keys.en).toEqual(keys.sr);
    expect(translator('sr')('truncated', { n: 2000 })).toBe('Prikazan je samo deo grupa: 2000.');
    expect(translator('sr-Cyrl')('addPlace')).toBe('Додај место');
    // A name to fill in stays in Latin letters, so Cyrillic fills it in too.
    expect(translator('sr-Cyrl')('truncated', { n: 2000 })).toBe('Приказан је само део група: 2000.');
    expect(translator('sr-Cyrl')('inArea', { n: 'Liman' })).toBe('У: Liman');
    expect(translator('en')('addPlace')).toBe('Add a place');
  });
});

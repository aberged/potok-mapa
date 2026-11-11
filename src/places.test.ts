import { describe, expect, it } from 'vitest';
import catalogue from './dev-catalogue.json';
import { keys, translator } from './i18n';
import { clusterHtml, escapeAttribute, pinSvg } from './pins';
import {
  buildIndex,
  clusterAction,
  clusterKey,
  clusterSize,
  iconKeys,
  inView,
  kindsOnMap,
  legendOf,
  lookOf,
  mergeMarkers,
  ofKind,
  pinCounts,
  pinKeyOf,
  pinOptions,
  placeKey,
  ringGradient,
  sameSpot,
  savedBounds,
  spreadPx,
  syncKeyed,
  togglePin,
  viewBox,
  type Pins,
  type Project,
} from './places';
import type { PotokPlace, PotokPlaceCluster } from './potok';

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

  it("keeps its kind's mark on an icon or the picture it picked, as the avatar does", () => {
    const chat = pins.kinds.find((kind) => kind.key === 'chat')!;
    expect(chat.mark).toBeTruthy();

    for (const pin of ['shop', 'picture']) {
      const look = lookOf(place(1, 44, 20, 'chat', pin), pins);
      expect(look.mark).toEqual(chat.mark);
      expect(pinSvg(look, pins)).toContain('data-pin-mark');
    }
  });

  it('has no mark when the pin already shows the kind, or the group has none', () => {
    for (const look of [
      lookOf(place(1, 44, 20, 'chat'), pins),
      lookOf(place(1, 44, 20, 'chat', 'retired'), pins),
      lookOf(place(1, 44, 20, 'none', 'shop'), pins),
      lookOf(place(1, 44, 20, 'castle', 'shop'), pins),
    ]) {
      expect(look.mark).toBeNull();
      expect(pinSvg(look, pins)).not.toContain('data-pin-mark');
    }
  });

  it('puts the lock on the left and the mark on the right', () => {
    const svg = pinSvg(lookOf(place(1, 44, 20, 'chat', 'shop'), pins), pins, { locked: true });
    expect(svg).toContain('<g data-pin-lock><circle cx="5.5"');
    expect(svg).toContain('<g data-pin-mark><circle cx="26.5"');
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

describe('the pin filter', () => {
  const icons = iconKeys(pins);
  const accidents = [
    place(1, 44.8, 20.4, 'none', 'transport'),
    place(2, 44.8, 20.4, 'none', 'transport'),
    place(3, 44.8, 20.4, 'none', 'transport'),
    place(4, 44.8, 20.4, 'none', 'warning'),
    place(5, 44.8, 20.4, 'none', 'warning'),
    place(6, 44.8, 20.4, 'none', 'problem'),
    place(7, 44.8, 20.4, 'chat', null),
  ];

  it('sees a place as its icon, "picture", or "kind" for one that shows its kind', () => {
    expect(pinKeyOf({ pin: 'shop' }, icons)).toBe('shop');
    expect(pinKeyOf({ pin: 'picture' }, icons)).toBe('picture');
    expect(pinKeyOf({ pin: null }, icons)).toBe('kind');
    expect(pinKeyOf({ pin: 'retired' }, icons)).toBe('kind');
  });

  it('has the warning pin of the injured, in the tone of reports', () => {
    expect(pins.icons.find((row) => row.key === 'warning')).toMatchObject({ tone: 'reports', title: 'Upozorenje' });
    expect(lookOf(place(1, 44, 20, 'none', 'warning'), pins).color).toBe(pins.tones.reports);
  });

  it('counts the places of each pin, the most shown first, as Potok does', () => {
    expect(pinCounts(accidents, pins)).toEqual([
      { pin: 'transport', count: 3 },
      { pin: 'warning', count: 2 },
      { pin: 'kind', count: 1 },
      { pin: 'problem', count: 1 },
    ]);
  });

  it("names the chips as the legend says, as typed, or by the icon's title", () => {
    const legend = { problem: 'Poginuli', warning: 'Povređeni', transport: 'Materijalna šteta' };
    const words = { kind: 'Bez ikonice', picture: 'Slika grupe' };
    const options = pinOptions(pinCounts(accidents, pins), pins, legend, words);

    // Most first; at one count in the catalogue's order, "kind" after the icons.
    expect(options.map((option) => [option.key, option.title, option.count])).toEqual([
      ['transport', 'Materijalna šteta', 3],
      ['warning', 'Povređeni', 2],
      ['problem', 'Poginuli', 1],
      ['kind', 'Bez ikonice', 1],
    ]);
    expect(options[0].fallback).toBe(pins.icons.find((row) => row.key === 'transport')!.title);
    expect(options[0].look.color).toBe(pins.tones.places);
    expect(pinOptions(pinCounts(accidents, pins), pins, {}, words)[0].title).toBe(options[0].fallback);
  });

  it('keeps a chip picked with none left, so the pick can be undone, and leaves out pins it does not know', () => {
    const options = pinOptions(
      [
        { pin: 'transport', count: 3 },
        { pin: 'castle', count: 2 },
      ],
      pins,
      {},
      { kind: 'Bez ikonice', picture: 'Slika grupe' },
      ['problem'],
    );

    expect(options.map((option) => [option.key, option.count])).toEqual([
      ['transport', 3],
      ['problem', 0],
    ]);
  });

  it('picks and unpicks', () => {
    expect(togglePin([], 'problem')).toEqual(['problem']);
    expect(togglePin(['problem', 'warning'], 'problem')).toEqual(['warning']);
  });

  it('reads the legend from the config, leaving out what is not a name', () => {
    expect(legendOf({ legend: { problem: '  Poginuli ', warning: '', transport: 3 }, view: {} })).toEqual({
      problem: 'Poginuli',
    });
    expect(legendOf({ legend: ['Poginuli'] })).toEqual({});
    expect(legendOf(null)).toEqual({});
  });
});

describe("a big map's view", () => {
  // A thousand pixels a degree, north up.
  const project: Project = (lat, lng) => ({ x: lng * 1000, y: -lat * 1000 });
  const cluster = (count: number, lat: number, lng: number, tones: Record<string, number>): PotokPlaceCluster => ({
    count,
    lat,
    lng,
    bounds: [
      [lat - 0.001, lng - 0.001],
      [lat + 0.001, lng + 0.001],
    ],
    tones,
  });

  it('asks for the view with longitudes wrapped, and the whole world past its width', () => {
    expect(viewBox(19, 44, 21, 46)).toEqual([19, 44, 21, 46]);
    expect(viewBox(-200, 10, 200, 20)).toEqual([-180, 10, 180, 20]);
    expect(viewBox(170, -10, 190, 10)).toEqual([170, -10, -170, 10]);
    expect(viewBox(100, -95, 180, 95)).toEqual([100, -90, 180, 90]);
  });

  it('keeps markers apart as they are', () => {
    const merged = mergeMarkers([place(1, 44.8, 20.4), place(2, 44.8, 20.5)], [cluster(5, 45, 20.4, { kind: 5 })], project, pins);
    expect(merged.places.map((row) => row.id)).toEqual([1, 2]);
    expect(merged.clusters).toEqual([cluster(5, 45, 20.4, { kind: 5 })]);
  });

  it('joins two pins that would touch into a cluster of both', () => {
    // 40 px apart: closer than a pin (40) and the gap (8).
    const merged = mergeMarkers(
      [place(1, 44.8, 20.4, 'none', 'problem'), place(2, 44.8, 20.44, 'none', 'warning')],
      [],
      project,
      pins,
    );

    expect(merged.places).toEqual([]);
    expect(merged.clusters).toHaveLength(1);
    expect(merged.clusters[0]).toMatchObject({
      count: 2,
      tones: { alert: 1, reports: 1 },
      bounds: [
        [44.8, 20.4],
        [44.8, 20.44],
      ],
    });
    expect(merged.clusters[0].lng).toBeCloseTo(20.42, 6);
  });

  it('lets a cluster take in a pin by it, its place weighed by the counts', () => {
    // A pin counts from half its height up: 40 px across and 19.5 up is
    // nearer than the cluster's half (18), the pin's (20) and the gap; 50 is not.
    const near = mergeMarkers([place(1, 45, 20.44)], [cluster(9, 45, 20.4, { kind: 9 })], project, pins);
    expect(near.places).toEqual([]);
    expect(near.clusters[0]).toMatchObject({ count: 10, tones: { kind: 10 } });
    expect(near.clusters[0].lng).toBeCloseTo(20.404, 6);
    const [[south, west], [north, east]] = near.clusters[0].bounds;
    expect([south, west, north, east].map((edge) => Number(edge.toFixed(6)))).toEqual([44.999, 20.399, 45.001, 20.44]);

    const far = mergeMarkers([place(1, 45, 20.45)], [cluster(9, 45, 20.4, { kind: 9 })], project, pins);
    expect(far.places).toHaveLength(1);
    expect(far.clusters).toHaveLength(1);
  });

  it('joins the biggest first', () => {
    // The 3 joins the 100 beside it; the 50 is too far from the 100 and is
    // not compared with the 3 that is gone.
    const merged = mergeMarkers(
      [],
      [cluster(3, 45, 20.445, { nature: 3 }), cluster(50, 45, 20.49, { kind: 50 }), cluster(100, 45, 20.4, { kind: 100 })],
      project,
      pins,
    );

    expect(merged.clusters.map((row) => [row.count, row.tones])).toEqual([
      [103, { kind: 100, nature: 3 }],
      [50, { kind: 50 }],
    ]);
  });

  it('knows how far apart places could stand at a zoom', () => {
    // A degree of longitude at zoom 0 is 256 / 360 of a pixel.
    expect(spreadPx([[0, 0], [0, 1]], 0)).toBeCloseTo(256 / 360, 6);
    expect(spreadPx([[0, 0], [0, 1]], 3)).toBeCloseTo((256 * 8) / 360, 6);
  });

  it('a tap on a cluster zooms to its places, at least a level', () => {
    const wide: [[number, number], [number, number]] = [
      [44, 20],
      [45, 21],
    ];
    expect(clusterAction(wide, 7, 19, 9)).toEqual({ list: false, zoom: 9 });
    expect(clusterAction(wide, 7, 19, 6)).toEqual({ list: false, zoom: 8 });
    expect(clusterAction(wide, 18, 19, 22)).toEqual({ list: false, zoom: 19 });
  });

  it('lists a cluster that would never spread: one point, the last zoom, or too close even there', () => {
    expect(clusterAction([[44.8, 20.4], [44.8, 20.4]], 7, 19, 19)).toEqual({ list: true });
    expect(clusterAction([[44, 20], [45, 21]], 19, 19, 19)).toEqual({ list: true });
    // A millionth of a degree is less than a pixel even at zoom 19.
    expect(clusterAction([[44.8, 20.4], [44.800001, 20.400001]], 12, 19, 19)).toEqual({ list: true });
  });

  it('keeps the markers that show the same, takes away the others and makes the new ones', () => {
    const drawn = new Map([
      ['a', 'A'],
      ['b', 'B'],
    ]);
    const made: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];

    syncKeyed(
      drawn,
      new Map([
        ['b', () => (made.push('b'), 'B2')],
        ['c', () => (made.push('c'), 'C')],
      ]),
      (item) => added.push(item),
      (item) => removed.push(item),
    );

    expect([made, added, removed]).toEqual([['c'], ['C'], ['A']]);
    expect([...drawn]).toEqual([
      ['b', 'B'],
      ['c', 'C'],
    ]);
  });

  it('keys a marker by what it shows', () => {
    const pin = place(1, 44.8, 20.4, 'none', 'warning');
    expect(placeKey(pin)).toBe(placeKey({ ...pin }));
    expect(placeKey(pin)).not.toBe(placeKey({ ...pin, pin: 'problem' }));
    expect(placeKey(pin)).not.toBe(placeKey({ ...pin, name: 'Drugo ime' }));

    const gathered = cluster(5, 45, 20.4, { kind: 5 });
    expect(clusterKey(gathered, 'red')).not.toBe(clusterKey({ ...gathered, count: 6 }, 'red'));
    expect(clusterKey(gathered, 'red')).not.toBe(clusterKey(gathered, 'blue'));
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

  it("says what a big map's circles hold", () => {
    expect(translator('sr')('inClusters', { n: '1.234' })).toBe('+1.234 u krugovima, približi mapu');
    expect(translator('sr-Cyrl')('inClusters', { n: '1.234' })).toBe('+1.234 у круговима, приближи мапу');
    expect(translator('en')('inClusters', { n: '1,234' })).toBe('+1,234 in circles, zoom in');
  });
});

import Supercluster from 'supercluster';
import type { PotokMapConfig, PotokPinCount, PotokPinPath, PotokPlace, PotokPlaceCluster } from './potok';

// What the map knows apart from Leaflet: how each place looks, how places
// gather into clusters, and which of them are in view. Kept free of the DOM,
// so it is tested on its own (places.test.ts).
//
// A big map (`listPlaces` in `mode: "view"`) is gathered by Potok into cells
// of a fixed grid; `mergeMarkers` joins what still stands too close on the
// screen, `clusterAction` says what a tap on a cluster does, and `syncKeyed`
// keeps the markers that show the same from one reply to the next.

export type Pins = PotokMapConfig['pins'];
export type Bounds = [[number, number], [number, number]];

/**
 * How one pin is drawn: the tone's colour and the glyph, or the group's
 * picture, and the kind's small `mark` when the group picked its pin.
 */
export type Look = {
  tone: string;
  color: string;
  paths: PotokPinPath[];
  picture: string | null;
  mark: PotokPinPath[] | null;
};

const FALLBACK_COLOR = '#0a5bc4';

/**
 * A place's own icon while the catalogue has it, its kind's otherwise, as
 * Potok does. A pin of its own keeps the kind's mark, as the avatar does.
 */
export function lookOf(place: Pick<PotokPlace, 'kind' | 'pin' | 'picture_url'>, pins: Pins): Look {
  const kind = pins.kinds.find((row) => row.key === place.kind) ?? pins.kinds.find((row) => row.key === 'none');
  const icon = place.pin && place.pin !== 'picture' ? pins.icons.find((row) => row.key === place.pin) : undefined;
  const base = icon ?? kind;
  const tone = base?.tone ?? 'kind';
  const own = icon !== undefined || place.pin === 'picture';

  return {
    tone,
    color: pins.tones[tone] ?? FALLBACK_COLOR,
    paths: base?.paths ?? [],
    picture: place.pin === 'picture' ? place.picture_url : null,
    mark: own ? (kind?.mark ?? null) : null,
  };
}

/** A cluster's size in pixels: a step for each order of magnitude. */
export function clusterSize(count: number): number {
  if (count < 10) return 36;
  if (count < 100) return 44;
  if (count < 1000) return 52;
  return 60;
}

/**
 * The cluster's ring: one arc per tone, as long as its share of the places,
 * in the order of `tones`, so the same mix always reads the same.
 */
export function ringGradient(counts: Record<string, number>, tones: Record<string, string>): string {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) return FALLBACK_COLOR;

  const order = [...Object.keys(tones), ...Object.keys(counts).filter((tone) => !(tone in tones))];
  const stops: string[] = [];
  let start = 0;

  for (const tone of order) {
    const count = counts[tone] ?? 0;
    if (count === 0) continue;

    const end = start + (count / total) * 360;
    const color = tones[tone] ?? FALLBACK_COLOR;
    stops.push(`${color} ${round(start)}deg ${round(end)}deg`);
    start = end;
  }

  return stops.length === 1 ? (stops[0].split(' ')[0] ?? FALLBACK_COLOR) : `conic-gradient(${stops.join(', ')})`;
}

function round(degrees: number): number {
  return Math.round(degrees * 100) / 100;
}

export type PlaceProps = { id: number; tone: string };
export type ClusterProps = { tones: Record<string, number> };
export type Index = Supercluster<PlaceProps, ClusterProps>;

/**
 * Places gathered into clusters by how close they are on screen. Clusters
 * hold on up to the map's last zoom, so places at one address stay one
 * cluster to the end, and a tap on it lists them (`sameSpot`).
 */
export function buildIndex(places: PotokPlace[], pins: Pins, maxZoom: number): Index {
  const index = new Supercluster<PlaceProps, ClusterProps>({
    radius: 60,
    maxZoom,
    map: (props) => ({ tones: { [props.tone]: 1 } }),
    reduce: (accumulated, props) => {
      for (const [tone, count] of Object.entries(props.tones)) {
        accumulated.tones[tone] = (accumulated.tones[tone] ?? 0) + count;
      }
    },
  });

  index.load(
    places.map((place) => ({
      type: 'Feature' as const,
      properties: { id: place.id, tone: lookOf(place, pins).tone },
      geometry: { type: 'Point' as const, coordinates: [place.lng, place.lat] },
    })),
  );

  return index;
}

/** Whether all these places stand at one point, to about ten centimetres. */
export function sameSpot(places: Pick<PotokPlace, 'lat' | 'lng'>[]): boolean {
  if (places.length < 2) return false;

  const key = (place: Pick<PotokPlace, 'lat' | 'lng'>) => `${place.lat.toFixed(6)},${place.lng.toFixed(6)}`;
  return places.every((place) => key(place) === key(places[0]));
}

/** The places of one kind, or all of them. */
export function ofKind(places: PotokPlace[], kind: string | null): PotokPlace[] {
  return kind === null ? places : places.filter((place) => place.kind === kind);
}

/** The kinds that are on the map, in the catalogue's order, with how many places each has. */
export function kindsOnMap(places: PotokPlace[], pins: Pins): { key: string; title: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const place of places) counts.set(place.kind, (counts.get(place.kind) ?? 0) + 1);

  return pins.kinds
    .filter((kind) => counts.has(kind.key))
    .map((kind) => ({ key: kind.key, title: kind.title, count: counts.get(kind.key) ?? 0 }));
}

/** The places inside `bounds`, by name in the viewer's language. */
export function inView(places: PotokPlace[], bounds: Bounds, lang: string): PotokPlace[] {
  const [[south, west], [north, east]] = bounds;
  const collator = new Intl.Collator(lang === 'en' ? 'en' : 'sr');

  return places
    .filter((place) => place.lat >= south && place.lat <= north && inLongitudes(place.lng, west, east))
    .sort((a, b) => collator.compare(a.name, b.name));
}

// A view across the antimeridian has its west edge east of its east edge.
function inLongitudes(lng: number, west: number, east: number): boolean {
  return west <= east ? lng >= west && lng <= east : lng >= west || lng <= east;
}

/** The view a map saved in its config, when it holds one. */
export function savedBounds(data: unknown): Bounds | null {
  const bounds = (data as { view?: { bounds?: unknown } } | null)?.view?.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 2) return null;

  const corners = bounds.map((corner) =>
    Array.isArray(corner) && corner.length === 2 && corner.every((value) => typeof value === 'number')
      ? (corner as [number, number])
      : null,
  );

  return corners[0] && corners[1] ? [corners[0], corners[1]] : null;
}

// --- Pins: the filter and the legend ---

/**
 * What the pin filter sees a place as, as Potok does: the icon it picked
 * while the catalogue has it, "picture", or "kind" for a place that shows its
 * kind (no icon, or one the catalogue no longer has).
 */
export function pinKeyOf(place: Pick<PotokPlace, 'pin'>, icons: ReadonlySet<string>): string {
  if (place.pin === 'picture') return 'picture';
  return place.pin !== null && icons.has(place.pin) ? place.pin : 'kind';
}

/** The keys of the icons in the catalogue. */
export function iconKeys(pins: Pins): Set<string> {
  return new Set(pins.icons.map((icon) => icon.key));
}

/** How many places show each pin (`pinKeyOf`), the most shown first, as Potok counts them. */
export function pinCounts(places: Pick<PotokPlace, 'pin'>[], pins: Pins): PotokPinCount[] {
  const icons = iconKeys(pins);
  const counts = new Map<string, number>();

  for (const place of places) {
    const key = pinKeyOf(place, icons);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts]
    .map(([pin, count]) => ({ pin, count }))
    .sort((a, b) => b.count - a.count || a.pin.localeCompare(b.pin));
}

/** What a map's editors call its pins (`config.data.legend`): pin key → name. */
export type Legend = Record<string, string>;

/** The most a legend's name holds. */
export const LEGEND_MAX = 40;

/**
 * The legend in a map's config: names people typed, kept as they are apart
 * from the spaces around them, never transliterated. Anything else is left out.
 */
export function legendOf(data: unknown): Legend {
  const raw = (data as { legend?: unknown } | null)?.legend;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  return Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) =>
      typeof value === 'string' && value.trim() !== '' ? [[key, value.trim()]] : [],
    ),
  );
}

/** One chip of the pin filter, or one row of the legend's form. */
export type PinOption = {
  key: string;
  /** The legend's name for it, or the icon's title. */
  title: string;
  /** The icon's title, or the app's word for "kind" and "picture". */
  fallback: string;
  count: number;
  look: Look;
};

/**
 * The pins on a map as chips: those `counts` has, and those picked even when
 * none is left, so a pick can always be undone; the most shown first, then in
 * the catalogue's order. A pin the catalogue does not know is left out.
 */
export function pinOptions(
  counts: PotokPinCount[],
  pins: Pins,
  legend: Legend,
  words: { kind: string; picture: string },
  picked: readonly string[] = [],
): PinOption[] {
  const rows = new Map<string, number>();
  for (const { pin, count } of counts) if (count > 0) rows.set(pin, (rows.get(pin) ?? 0) + count);
  for (const key of picked) if (!rows.has(key)) rows.set(key, 0);

  const order = (key: string) => {
    const index = pins.icons.findIndex((icon) => icon.key === key);
    return index >= 0 ? index : key === 'picture' ? pins.icons.length : pins.icons.length + 1;
  };

  return [...rows]
    .flatMap(([key, count]) => {
      const icon = pins.icons.find((row) => row.key === key);
      const fallback = icon?.title ?? (key === 'kind' ? words.kind : key === 'picture' ? words.picture : null);
      if (fallback === null) return [];

      const look = lookOf({ kind: 'none', pin: icon ? key : null, picture_url: null }, pins);
      const named = Object.hasOwn(legend, key) ? legend[key] : undefined;
      return [{ key, title: named ?? fallback, fallback, count, look }];
    })
    .sort((a, b) => b.count - a.count || order(a.key) - order(b.key));
}

/** A pick of the pin filter turned on or off. */
export function togglePin(picked: readonly string[], key: string): string[] {
  return picked.includes(key) ? picked.filter((row) => row !== key) : [...picked, key];
}

// --- A big map's view ---

/**
 * The view's box as `listPlaces` takes it, [west, south, east, north]:
 * longitudes wrapped into -180..180 (west east of east across the
 * antimeridian), the whole world for a view wider than it.
 */
export function viewBox(west: number, south: number, east: number, north: number): [number, number, number, number] {
  const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));
  const [low, high] = [clampLat(Math.min(south, north)), clampLat(Math.max(south, north))];

  if (east - west >= 360) return [-180, low, 180, high];
  return [wrapLng(west), low, wrapLng(east), high];
}

function wrapLng(lng: number): number {
  const wrapped = lng - 360 * Math.floor((lng + 180) / 360);
  // 180 itself wraps to -180; an east edge there means the antimeridian.
  return wrapped === -180 && lng > 0 ? 180 : wrapped;
}

export type Point = { x: number; y: number };
/** Where a point stands on the screen, in pixels. */
export type Project = (lat: number, lng: number) => Point;

/** Markers closer than their half sizes and this much more become one, as on Potok's map. */
export const MERGE_GAP = 8;
const PIN_HEIGHT = 40;
const PIN_TIP = 39;

type Item = PotokPlaceCluster & { size: number; point: Point; place?: PotokPlace };

/**
 * Potok's cells are a fixed grid, so the markers of neighbouring cells can
 * stand closer than they are wide. Those that would cover or touch each other
 * become one cluster, the biggest first, as on Potok's map: its count the sum,
 * its tones added up, its position their average by count, its bounds around
 * them all. A pin stands on its tip, so it counts from half its height up.
 */
export function mergeMarkers(
  places: PotokPlace[],
  clusters: PotokPlaceCluster[],
  project: Project,
  pins: Pins,
): { places: PotokPlace[]; clusters: PotokPlaceCluster[] } {
  const items: Item[] = [
    ...clusters.map((cluster) => ({
      ...cluster,
      tones: cluster.tones ?? {},
      size: clusterSize(cluster.count),
      point: project(cluster.lat, cluster.lng),
    })),
    ...places.map((place) => {
      const point = project(place.lat, place.lng);
      return {
        count: 1,
        lat: place.lat,
        lng: place.lng,
        bounds: [
          [place.lat, place.lng],
          [place.lat, place.lng],
        ] as Bounds,
        tones: { [lookOf(place, pins).tone]: 1 },
        size: PIN_HEIGHT,
        point: { x: point.x, y: point.y - PIN_TIP / 2 },
        place,
      };
    }),
  ].sort((a, b) => b.count - a.count);

  const taken = new Set<number>();
  const single: PotokPlace[] = [];
  const gathered: PotokPlaceCluster[] = [];

  items.forEach((base, index) => {
    if (taken.has(index)) return;

    const near = [base];

    for (let other = index + 1; other < items.length; other++) {
      const item = items[other];
      const apart = Math.hypot(base.point.x - item.point.x, base.point.y - item.point.y);

      if (!taken.has(other) && apart < (base.size + item.size) / 2 + MERGE_GAP) {
        near.push(item);
        taken.add(other);
      }
    }

    if (near.length === 1) {
      if (base.place) single.push(base.place);
      else gathered.push({ count: base.count, lat: base.lat, lng: base.lng, bounds: base.bounds, tones: base.tones });
      return;
    }

    const count = near.reduce((sum, item) => sum + item.count, 0);
    const tones: Record<string, number> = {};
    for (const item of near) {
      for (const [tone, n] of Object.entries(item.tones)) tones[tone] = (tones[tone] ?? 0) + n;
    }

    gathered.push({
      count,
      lat: near.reduce((sum, item) => sum + item.lat * item.count, 0) / count,
      lng: near.reduce((sum, item) => sum + item.lng * item.count, 0) / count,
      bounds: [
        [Math.min(...near.map((item) => item.bounds[0][0])), Math.min(...near.map((item) => item.bounds[0][1]))],
        [Math.max(...near.map((item) => item.bounds[1][0])), Math.max(...near.map((item) => item.bounds[1][1]))],
      ],
      tones,
    });
  });

  return { places: single, clusters: gathered };
}

/** How far apart, in pixels, the places of a cluster could stand at most at `zoom` (Web Mercator). */
export function spreadPx(bounds: Bounds, zoom: number): number {
  const scale = 256 * 2 ** zoom;
  const y = (lat: number) => {
    const rad = (Math.max(-85.0511287798, Math.min(85.0511287798, lat)) * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale;
  };
  const [[south, west], [north, east]] = bounds;
  return Math.hypot(((east - west) / 360) * scale, y(south) - y(north));
}

/**
 * What a tap on a big map's cluster does: zoom in, to the box around its
 * places (with a margin) and at least a level, or list its places when it
 * would never spread: they stand at one point, the map is at its last zoom,
 * or they lie so close that they would still touch there.
 */
export function clusterAction(
  bounds: Bounds,
  zoom: number,
  maxZoom: number,
  fitZoom: number,
): { list: true } | { list: false; zoom: number } {
  const [[south, west], [north, east]] = bounds;
  const onePoint = south === north && west === east;

  if (onePoint || zoom >= maxZoom || spreadPx(bounds, maxZoom) < PIN_HEIGHT + MERGE_GAP) return { list: true };
  return { list: false, zoom: Math.min(maxZoom, Math.max(fitZoom, Math.floor(zoom) + 1)) };
}

/** What a pin shows, so that a marker showing the same stays on the map. */
export function placeKey(place: PotokPlace): string {
  return ['p', place.id, place.lat, place.lng, place.pin, place.kind, place.is_public, place.picture_url, place.name].join(
    ':',
  );
}

/** What a cluster shows: where, how many and its ring. */
export function clusterKey(cluster: PotokPlaceCluster, ring: string): string {
  return ['c', cluster.lat, cluster.lng, cluster.count, ring].join(':');
}

/**
 * Keeps the items of `drawn` (key → item) whose key `next` (key → make) still
 * has, takes the others away and makes the new ones: a marker that shows the
 * same is not drawn again.
 */
export function syncKeyed<T>(
  drawn: Map<string, T>,
  next: Map<string, () => T>,
  add: (item: T) => void,
  remove: (item: T) => void,
): void {
  for (const [key, item] of drawn) {
    if (!next.has(key)) {
      remove(item);
      drawn.delete(key);
    }
  }

  for (const [key, make] of next) {
    if (drawn.has(key)) continue;
    const item = make();
    add(item);
    drawn.set(key, item);
  }
}

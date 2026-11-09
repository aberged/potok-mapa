import Supercluster from 'supercluster';
import type { PotokMapConfig, PotokPinPath, PotokPlace } from './potok';

// What the map knows apart from Leaflet: how each place looks, how places
// gather into clusters, and which of them are in view. Kept free of the DOM,
// so it is tested on its own (places.test.ts).

export type Pins = PotokMapConfig['pins'];
export type Bounds = [[number, number], [number, number]];

/** How one pin is drawn: the tone's colour and the glyph, or the group's picture. */
export type Look = {
  tone: string;
  color: string;
  paths: PotokPinPath[];
  picture: string | null;
};

const FALLBACK_COLOR = '#0a5bc4';

/** A place's own icon while the catalogue has it, its kind's otherwise, as Potok does. */
export function lookOf(place: Pick<PotokPlace, 'kind' | 'pin' | 'picture_url'>, pins: Pins): Look {
  const kind = pins.kinds.find((row) => row.key === place.kind) ?? pins.kinds.find((row) => row.key === 'none');
  const icon = place.pin && place.pin !== 'picture' ? pins.icons.find((row) => row.key === place.pin) : undefined;
  const base = icon ?? kind;
  const tone = base?.tone ?? 'kind';

  return {
    tone,
    color: pins.tones[tone] ?? FALLBACK_COLOR,
    paths: base?.paths ?? [],
    picture: place.pin === 'picture' ? place.picture_url : null,
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

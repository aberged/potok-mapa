import type { PotokPlace, PotokPlaceShape } from './potok';

// Areas among the map's places (`shape: "area"`), as Potok's own map shows
// them: every area is a layer of its own, whatever the kind chips say, drawn
// as a border with its pin once it is wide enough on the screen, and a pin
// among the others before that. Kept free of the DOM (areas.test.ts).

export type Geo = PotokPlaceShape['geojson'];
export type Layers = { places: boolean; areas: boolean };

/** How wide an area must be on the screen to be drawn as a border, as on Potok's map. */
export const DRAWN_PX = 28;

/** The levels of detail Potok simplifies borders for (`placeShapes`). */
export const LEVELS = [6, 8, 10, 12, 14, 16];

/** The level of detail a map at `zoom` asks borders at. */
export function levelFor(zoom: number): number {
  return LEVELS.find((level) => level >= zoom) ?? LEVELS[LEVELS.length - 1];
}

/** How wide an area is on the screen at `zoom`, its height counted as Mercator stretches it. */
export function spanPx(place: Pick<PotokPlace, 'bbox' | 'lat'>, zoom: number): number {
  if (!place.bbox) return 0;

  const [west, south, east, north] = place.bbox;
  const degrees = Math.max(east - west, (north - south) / Math.cos((place.lat * Math.PI) / 180));
  return (degrees * 256 * 2 ** zoom) / 360;
}

/** Whether a place is an area drawn as a border at `zoom`. */
export function isDrawn(place: PotokPlace, zoom: number): boolean {
  return place.shape === 'area' && spanPx(place, zoom) >= DRAWN_PX;
}

export type ShownOptions = { layers: Layers; kind: string | null; inside: number | null; zoom: number };

/**
 * What the map shows at `zoom`. `borders`: the areas drawn as borders, the
 * biggest first so that smaller ones lie on top, each with its own pin.
 * `pins`: what gathers into clusters, the places by the kind chips and the
 * areas too small to draw whatever the chips, or with areas off every place
 * by the chips. `inside` keeps only the pins inside that area.
 */
export function shown(places: PotokPlace[], options: ShownOptions): { borders: PotokPlace[]; pins: PotokPlace[] } {
  const { layers, kind, inside, zoom } = options;
  const within = (place: PotokPlace) => inside === null || (place.id !== inside && place.areas.includes(inside));

  const borders = layers.areas
    ? places.filter((place) => isDrawn(place, zoom)).sort((a, b) => boxSize(b) - boxSize(a))
    : [];

  const pins = places.filter((place) => {
    if (!within(place)) return false;
    if (layers.areas && place.shape === 'area') return !isDrawn(place, zoom);
    return layers.places && (kind === null || place.kind === kind);
  });

  return { borders, pins };
}

function boxSize(place: PotokPlace): number {
  if (!place.bbox) return 0;
  const [west, south, east, north] = place.bbox;
  return (east - west) * (north - south);
}

/** Whether a point lies inside a border: inside an odd number of its rings (holes count out). */
export function contains(geo: Geo, lat: number, lng: number): boolean {
  let inside = false;

  for (const polygon of geo.coordinates) {
    for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];

        if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }

  return inside;
}

/** A border's size in square degrees, holes taken out: enough to tell the smaller of two. */
export function shapeArea(geo: Geo): number {
  return geo.coordinates.reduce(
    (sum, [shell, ...holes]) => sum + ringArea(shell ?? []) - holes.reduce((inner, hole) => inner + ringArea(hole), 0),
    0,
  );
}

function ringArea(ring: [number, number][]): number {
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    twice += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return Math.abs(twice) / 2;
}

/** The areas with a border here whose border holds the point, smallest first. */
export function areasAt(drawn: { id: number; geo: Geo }[], lat: number, lng: number): number[] {
  return drawn
    .filter(({ geo }) => contains(geo, lat, lng))
    .sort((a, b) => shapeArea(a.geo) - shapeArea(b.geo))
    .map(({ id }) => id);
}

/** The outer rings of a border as Leaflet's [lat, lng] lists: the holes of the dimming around it. */
export function outerRings(geo: Geo): [number, number][][] {
  return geo.coordinates.map(([shell]) => (shell ?? []).map(([lng, lat]) => [lat, lng] as [number, number]));
}

/** A border as Leaflet's nested [lat, lng] lists. */
export function toLatLngs(geo: Geo): [number, number][][][] {
  return geo.coordinates.map((rings) => rings.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number])));
}

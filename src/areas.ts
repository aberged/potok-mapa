import { nameMatches } from './fold';
import type { PotokPlace, PotokPlaceShape } from './potok';

// Areas among the map's places (`shape: "area"`), as Potok's own map shows
// them: an area is only the shape of its group, which the kind chips and the
// search keep or leave out like any place. Its pin is one of the pins, in the
// clusters like any other, and once the area is wide enough on the screen its
// border is drawn under the pins as well. Kept free of the DOM
// (areas.test.ts).

export type Geo = PotokPlaceShape['geojson'];
export type Layers = { places: boolean; areas: boolean };

/** How wide an area must be on the screen to be drawn as a border, two pins wide, as on Potok's map. */
export const DRAWN_PX = 64;

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

export type ShownOptions = {
  layers: Layers;
  kind: string | null;
  inside: number | null;
  zoom: number;
  search?: string;
};

/**
 * The places the kind chip, the search and "only inside" keep, areas as much
 * as points: `inside` keeps the places inside that area, not the area itself.
 * With places off, only the areas.
 */
export function kept(places: PotokPlace[], options: Omit<ShownOptions, 'zoom'>): PotokPlace[] {
  const { layers, kind, inside, search = '' } = options;

  return places.filter(
    (place) =>
      (inside === null || (place.id !== inside && place.areas.includes(inside))) &&
      (kind === null || place.kind === kind) &&
      (layers.places || place.shape === 'area') &&
      nameMatches(place.name, search),
  );
}

/**
 * What the map shows at `zoom`, out of the places kept (`kept`). `pins`:
 * every one of them, which gather into clusters, areas too. `borders`: the
 * areas also drawn as borders (none with areas off), the biggest first so
 * that smaller ones lie on top.
 */
export function shown(places: PotokPlace[], options: ShownOptions): { borders: PotokPlace[]; pins: PotokPlace[] } {
  const keep = kept(places, options);
  const drawn = (place: PotokPlace) => options.layers.areas && isDrawn(place, options.zoom);

  return {
    borders: keep.filter(drawn).sort((a, b) => boxSize(b) - boxSize(a)),
    pins: keep,
  };
}

/** Of `borders`, those reaching into the box `[west, south, east, north]`, at most `limit`. */
export function inBox(borders: PotokPlace[], [west, south, east, north]: number[], limit: number): PotokPlace[] {
  return borders
    .filter((place) => {
      if (!place.bbox) return false;
      const [w, s, e, n] = place.bbox;
      return w <= east && e >= west && s <= north && n >= south;
    })
    .slice(0, limit);
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

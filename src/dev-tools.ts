import './dev-theme.css';
import { contains, shapeArea, type Geo, type Line } from './areas';
import catalogue from './dev-catalogue.json';
import type { PotokMapConfig, PotokPlace } from './potok';

// Dev only (main.ts imports it in its DEV block): fills an empty dev store
// with places around Serbia, a few at one address, and the map's config.
// `dev-catalogue.json` is what potok-ide's `PinIcons.catalogue/0` gave in
// Serbian; tiles come straight from OpenStreetMap here, through Potok there.
// `?lang=en` or `?lang=sr-Cyrl` tries a language, `?viewer=guest` a viewer
// who may not add places. Two areas stand in Novi Sad, the city and a quarter,
// and a walk runs from the west of the city to the river, with their shapes in
// `potok-dev:place-shapes` and the areas of every place worked out here, as
// Potok works them out (a route by its points, near enough). To start over:
// localStorage.removeItem('potok-dev:places').

const PLACES_STORAGE_KEY = 'potok-dev:places';
const SHAPES_STORAGE_KEY = 'potok-dev:place-shapes';
const CONFIG_STORAGE_KEY = 'potok-dev:map-config';

type Seed = [name: string, lat: number, lng: number, kind: string, pin?: string | null, closed?: boolean];

const seeds: Seed[] = [
  ['Pekara na uglu', 44.8176, 20.4569, 'page', 'food'],
  ['Komšijski čet Dorćol', 44.8226, 20.4612, 'chat'],
  ['Biblioteka grada', 44.8169, 20.4597, 'page', 'institution'],
  ['Rupa u Cara Dušana', 44.8238, 20.4661, 'questionnaire', 'problem'],
  ['Akcija čišćenja Ade', 44.7869, 20.4159, 'polls', 'waste'],
  ['Kafana kod Mike', 44.8131, 20.4646, 'chat', 'food'],
  ['Galerija Zvono', 44.8186, 20.4549, 'feed', 'art'],
  ['Kalemegdan', 44.8233, 20.4504, 'page', 'sight'],
  ['Stanari zgrade 12', 44.8051, 20.4781, 'announcements', 'home', true],
  ['Stanari zgrade 12, ulaz B', 44.8051, 20.4781, 'chat', 'home', true],
  ['Kućni savet', 44.8051, 20.4781, 'polls', null, true],
  ['Teretana Zemun', 44.8432, 20.4011, 'chat', 'sport'],
  ['Volonteri Novog Beograda', 44.8086, 20.4192, 'folder', 'help'],
  ['Škola Vuk Karadžić', 44.7996, 20.4887, 'announcements', 'school'],
  ['Petrovaradinska tvrđava', 45.2523, 19.8617, 'page', 'sight'],
  ['Exit tim', 45.2541, 19.8590, 'chat', 'music'],
  ['Pijaca Futoška', 45.2537, 19.8301, 'page', 'market'],
  ['Kvar na Bulevaru', 45.2489, 19.8335, 'questionnaire', 'power'],
  ['Udruženje biciklista', 45.2551, 19.8452, 'folder', 'association'],
  ['Niška tvrđava', 43.3247, 21.8954, 'page', 'sight'],
  ['Burek kod Ćire', 43.3195, 21.8964, 'chat', 'food'],
  ['Dom zdravlja Niš', 43.3166, 21.9105, 'announcements', 'health'],
  ['Knežev arsenal', 44.0153, 20.9158, 'feed', 'event'],
  ['Šumarice izlet', 44.0011, 20.9356, 'polls', 'nature'],
  ['Zlatibor staza', 43.7290, 19.6990, 'page', 'nature'],
  ['Vatrogasci Užice', 43.8586, 19.8488, 'announcements', 'emergency'],
  ['Subotica, Sinagoga', 46.1003, 19.6656, 'page', 'sight'],
  ['Ideje za Vranje', 42.5513, 21.9002, 'questionnaire', 'idea'],
];

const points: PotokPlace[] = seeds.map(([name, lat, lng, kind, pin = null, closed = false], index) => ({
  id: index + 1,
  name,
  lat,
  lng,
  kind,
  pin,
  picture_url: null,
  is_public: !closed,
  shape: 'point',
  areas: [],
}));

const ring = (corners: [number, number][]): [number, number][] => [...corners, corners[0]];

const areaSeeds: { name: string; pin: string; pinAt: [number, number]; geo: Geo }[] = [
  {
    name: 'Grad Novi Sad',
    pin: 'institution',
    pinAt: [45.255, 19.845],
    geo: {
      type: 'MultiPolygon',
      coordinates: [
        [ring([[19.72, 45.21], [19.8, 45.19], [19.93, 45.2], [19.98, 45.25], [19.94, 45.31], [19.82, 45.33], [19.73, 45.29]])],
      ],
    },
  },
  {
    name: 'MZ Stari grad',
    pin: 'association',
    pinAt: [45.2585, 19.8445],
    geo: {
      type: 'MultiPolygon',
      coordinates: [[ring([[19.835, 45.25], [19.866, 45.25], [19.866, 45.266], [19.835, 45.266]])]],
    },
  },
];

const areaPlaces: PotokPlace[] = areaSeeds.map((area, index) => {
  const coords = area.geo.coordinates.flat(2);
  const lngs = coords.map(([lng]) => lng);
  const lats = coords.map(([, lat]) => lat);

  return {
    id: 100 + index,
    name: area.name,
    lat: area.pinAt[0],
    lng: area.pinAt[1],
    kind: 'folder',
    pin: area.pin,
    picture_url: null,
    is_public: true,
    shape: 'area',
    areas: [],
    bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
    v: 1,
  };
});

const geoOf = new Map(areaPlaces.map((place, index) => [place.id, areaSeeds[index].geo]));

const walk: Line = {
  type: 'MultiLineString',
  coordinates: [[[19.7, 45.247], [19.76, 45.246], [19.81, 45.245], [19.84, 45.252], [19.86, 45.256], [19.875, 45.254]]],
};

// Metres along the Earth, near enough for a dev map.
const metres = (line: Line) =>
  line.coordinates.reduce((sum, part) => {
    let total = sum;
    for (let i = 1; i < part.length; i++) {
      const [lng1, lat1] = part[i - 1];
      const [lng2, lat2] = part[i];
      const x = ((lng2 - lng1) * Math.PI * Math.cos(((lat1 + lat2) * Math.PI) / 360)) / 180;
      const y = ((lat2 - lat1) * Math.PI) / 180;
      total += Math.hypot(x, y) * 6_371_000;
    }
    return total;
  }, 0);

const walkPoints = walk.coordinates.flat();

const routePlaces: PotokPlace[] = [
  {
    id: 200,
    name: 'Šetnja do Dunava',
    lat: walkPoints[0][1],
    lng: walkPoints[0][0],
    kind: 'chat',
    pin: 'meetup',
    picture_url: null,
    is_public: true,
    shape: 'route',
    areas: [],
    bbox: [
      Math.min(...walkPoints.map(([lng]) => lng)),
      Math.min(...walkPoints.map(([, lat]) => lat)),
      Math.max(...walkPoints.map(([lng]) => lng)),
      Math.max(...walkPoints.map(([, lat]) => lat)),
    ],
    v: 1,
    length: Math.round(metres(walk)),
  },
];

const lineOf = new Map<number, Line>([[200, walk]]);

// Which areas hold each place: its pin inside, and a bigger area for an area;
// for a route, the areas any of its points lies in.
const places: PotokPlace[] = [...points, ...areaPlaces, ...routePlaces].map((place) => {
  const own = geoOf.get(place.id);
  const line = lineOf.get(place.id);
  const holds = (area: PotokPlace) =>
    line
      ? line.coordinates.flat().some(([lng, lat]) => contains(geoOf.get(area.id)!, lat, lng))
      : contains(geoOf.get(area.id)!, place.lat, place.lng);

  const holders = areaPlaces
    .filter((area) => area.id !== place.id)
    .filter(holds)
    .filter((area) => !own || shapeArea(geoOf.get(area.id)!) > shapeArea(own))
    .sort((a, b) => shapeArea(geoOf.get(a.id)!) - shapeArea(geoOf.get(b.id)!))
    .map((area) => area.id);

  return { ...place, areas: holders };
});

export function seedDevMap() {
  const params = new URLSearchParams(location.search);
  const lang = params.get('lang');
  if (lang) document.documentElement.lang = lang;

  const guest = params.get('viewer') === 'guest';

  const config: Partial<PotokMapConfig> = {
    ...(catalogue as Pick<PotokMapConfig, 'pins' | 'place_kinds'>),
    can_create_places: !guest,
    can_edit_view: !guest,
  };

  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));

  if (!localStorage.getItem(PLACES_STORAGE_KEY)) {
    localStorage.setItem(PLACES_STORAGE_KEY, JSON.stringify(places));
    localStorage.setItem(SHAPES_STORAGE_KEY, JSON.stringify({ ...Object.fromEntries(geoOf), ...Object.fromEntries(lineOf) }));
  }
}

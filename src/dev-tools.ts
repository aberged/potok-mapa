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
//
// `?seed=big` adds 5000 traffic accidents across Serbia, too many for one
// reply, so the mock gathers the map's view as Potok does (`mode: "view"`).
// Their pins say what happened, as the import of the police's records sets
// them: `problem` for the killed, `warning` for the injured and `transport`
// for damage only, and some stand at one spot. `?seed=small` goes back.

const PLACES_STORAGE_KEY = 'potok-dev:places';
const SHAPES_STORAGE_KEY = 'potok-dev:place-shapes';
const CONFIG_STORAGE_KEY = 'potok-dev:map-config';
// Past this many places Potok gathers a map's view.
const ALL_PLACES = 2_000;
const ACCIDENTS = 5_000;
const FIRST_ACCIDENT_ID = 10_000;

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
  ['Stanari zgrade 12', 44.8051, 20.4781, 'chat', 'home', true],
  ['Stanari zgrade 12, ulaz B', 44.8051, 20.4781, 'chat', 'home', true],
  ['Kućni savet', 44.8051, 20.4781, 'polls', null, true],
  ['Teretana Zemun', 44.8432, 20.4011, 'chat', 'sport'],
  ['Volonteri Novog Beograda', 44.8086, 20.4192, 'folder', 'help'],
  ['Škola Vuk Karadžić', 44.7996, 20.4887, 'chat', 'school'],
  ['Petrovaradinska tvrđava', 45.2523, 19.8617, 'page', 'sight'],
  ['Exit tim', 45.2541, 19.8590, 'chat', 'music'],
  ['Pijaca Futoška', 45.2537, 19.8301, 'page', 'market'],
  ['Kvar na Bulevaru', 45.2489, 19.8335, 'questionnaire', 'power'],
  ['Udruženje biciklista', 45.2551, 19.8452, 'folder', 'association'],
  ['Niška tvrđava', 43.3247, 21.8954, 'page', 'sight'],
  ['Burek kod Ćire', 43.3195, 21.8964, 'chat', 'food'],
  ['Dom zdravlja Niš', 43.3166, 21.9105, 'chat', 'health'],
  ['Knežev arsenal', 44.0153, 20.9158, 'feed', 'event'],
  ['Šumarice izlet', 44.0011, 20.9356, 'polls', 'nature'],
  ['Zlatibor staza', 43.7290, 19.6990, 'page', 'nature'],
  ['Vatrogasci Užice', 43.8586, 19.8488, 'chat', 'emergency'],
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

// --- `?seed=big`: a map too big for one reply ---

// Towns, and how many of the accidents happen around each, roughly.
const towns: [name: string, lat: number, lng: number, weight: number][] = [
  ['Beograd', 44.8125, 20.4612, 30],
  ['Novi Sad', 45.2671, 19.8335, 10],
  ['Niš', 43.3209, 21.8958, 7],
  ['Kragujevac', 44.0128, 20.9114, 5],
  ['Subotica', 46.1, 19.6658, 4],
  ['Zrenjanin', 45.3816, 20.3686, 3],
  ['Pančevo', 44.8708, 20.6403, 3],
  ['Čačak', 43.8914, 20.3497, 3],
  ['Kraljevo', 43.7258, 20.6894, 3],
  ['Smederevo', 44.6628, 20.93, 2],
  ['Leskovac', 42.9981, 21.9461, 2],
  ['Valjevo', 44.2751, 19.8982, 2],
  ['Kruševac', 43.58, 21.3339, 2],
  ['Vranje', 42.5514, 21.9003, 2],
  ['Šabac', 44.7489, 19.6908, 2],
  ['Užice', 43.8586, 19.8488, 2],
  ['Sombor', 45.7742, 19.1122, 2],
  ['Požarevac', 44.6213, 21.1878, 2],
  ['Pirot', 43.1531, 22.5861, 1],
  ['Zaječar', 43.9036, 22.2847, 1],
  ['Kikinda', 45.8297, 20.4653, 1],
  ['Sremska Mitrovica', 44.9764, 19.6122, 1],
  ['Jagodina', 43.9771, 21.2612, 1],
  ['Vršac', 45.1167, 21.3036, 1],
  ['Novi Pazar', 43.1367, 20.5122, 2],
  ['Loznica', 44.5333, 19.2258, 1],
  ['Barajevo', 44.58, 20.4167, 1],
];

// The same accidents on every reload: a small seeded random (mulberry32).
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const two = (n: number) => String(n).padStart(2, '0');
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

// Most around the middle of a town, some along its roads further out, and
// one in sixteen where another one happened already.
function accidents(): PotokPlace[] {
  const random = seeded(2025);
  const weights = towns.reduce((sum, [, , , weight]) => sum + weight, 0);
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-9))) * Math.cos(2 * Math.PI * random());
  const pick = () => {
    let left = random() * weights;
    return towns.find(([, , , weight]) => (left -= weight) <= 0) ?? towns[0];
  };

  const made: { place: PotokPlace; town: string }[] = [];

  for (let i = 0; i < ACCIDENTS; i++) {
    const roll = random();
    const [pin, what] = roll < 0.02 ? ['problem', 'Poginuli'] : roll < 0.4 ? ['warning', 'Povređeni'] : ['transport', 'Materijalna šteta'];
    let [town, lat, lng] = pick();

    if (made.length > 0 && random() < 1 / 16) {
      const twin = made[Math.floor(random() * made.length)];
      [town, lat, lng] = [twin.town, twin.place.lat, twin.place.lng];
    } else {
      const spread = random() < 0.8 ? 0.03 : 0.12;
      [lat, lng] = [round6(lat + normal() * spread), round6(lng + normal() * spread * 1.4)];
    }

    const when = new Date(Date.UTC(2025, 0, 1 + Math.floor(random() * 365), Math.floor(random() * 24), Math.floor(random() * 60)));
    const date = `${two(when.getUTCDate())}.${two(when.getUTCMonth() + 1)}.${when.getUTCFullYear()}.`;
    const time = `${two(when.getUTCHours())}:${two(when.getUTCMinutes())}`;

    made.push({
      town,
      place: {
        id: FIRST_ACCIDENT_ID + i,
        name: `${what} · ${town} · ${date} ${time}`,
        lat,
        lng,
        kind: 'none',
        pin,
        picture_url: null,
        is_public: true,
        shape: 'point',
        areas: [],
      },
    });
  }

  return made.map(({ place }) => place);
}

function storedCount(): number {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PLACES_STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.length : 0;
  } catch {
    return 0;
  }
}

function store(seed: PotokPlace[]) {
  try {
    localStorage.setItem(PLACES_STORAGE_KEY, JSON.stringify(seed));
    localStorage.setItem(SHAPES_STORAGE_KEY, JSON.stringify({ ...Object.fromEntries(geoOf), ...Object.fromEntries(lineOf) }));
  } catch {
    console.warn('[potok-dev] The seeded places do not fit in localStorage.');
  }
}

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

  const seed = params.get('seed');
  const big = storedCount() > ALL_PLACES;

  if (seed === 'big' && !big) store([...places, ...accidents()]);
  else if (seed === 'small' && big) store(places);
  else if (!localStorage.getItem(PLACES_STORAGE_KEY)) store(places);
}

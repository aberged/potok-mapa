import './dev-theme.css';
import catalogue from './dev-catalogue.json';
import type { PotokMapConfig, PotokPlace } from './potok';

// Dev only (main.ts imports it in its DEV block): fills an empty dev store
// with places around Serbia, a few at one address, and the map's config.
// `dev-catalogue.json` is what potok-ide's `PinIcons.catalogue/0` gave in
// Serbian; tiles come straight from OpenStreetMap here, through Potok there.
// `?lang=en` or `?lang=sr-Cyrl` tries a language, `?viewer=guest` a viewer
// who may not add places. To start over:
// localStorage.removeItem('potok-dev:places').

const PLACES_STORAGE_KEY = 'potok-dev:places';
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

const places: PotokPlace[] = seeds.map(([name, lat, lng, kind, pin = null, closed = false], index) => ({
  id: index + 1,
  name,
  lat,
  lng,
  kind,
  pin,
  picture_url: null,
  is_public: !closed,
}));

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
  }
}

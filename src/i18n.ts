// The app's words. Potok's page says its language on the frame's <html lang>
// ("sr", "sr-Cyrl" or "en"), and nothing else tells an app. Serbian is the
// reference, as in Potok, and Cyrillic comes from it. `{n}` is filled in.

const sr = {
  appName: 'Mapa',
  loading: 'Učitavam mapu…',
  failed: 'Mapa se nije učitala. Pokušaj ponovo.',
  retry: 'Pokušaj ponovo',
  outdated: 'Otvori stranicu ponovo da bi mapa radila.',
  allKinds: 'Sve',
  showAll: 'Prikaži sva mesta',
  list: 'Lista mesta',
  closeList: 'Zatvori listu',
  inView: 'U prikazu',
  atSpot: 'Na ovom mestu',
  noneInView: 'Nijedno mesto nije u ovom delu mape.',
  empty: 'Još nema mesta na ovoj mapi.',
  emptyCreate: 'Dodirni „Dodaj mesto“ da postaviš prvo.',
  emptySettings: 'Grupa ispod ove dobija mesto u svojim podešavanjima, na kartici Lokacija.',
  truncated: 'Prikazano je prvih {n} mesta.',
  addPlace: 'Dodaj mesto',
  aim: 'Pomeri mapu tako da pin stoji tačno na mestu.',
  here: 'Ovde',
  cancel: 'Otkaži',
  newPlace: 'Novo mesto',
  name: 'Naziv',
  namePlaceholder: 'Na primer: Pekara na uglu',
  kind: 'Vrsta',
  create: 'Napravi',
  creating: 'Pravim…',
  createFailed: 'Mesto nije napravljeno. Pokušaj ponovo.',
  nameNeeded: 'Upiši naziv mesta.',
  startView: 'Početni prikaz',
  saveView: 'Sačuvaj ovaj prikaz kao početni',
  resetView: 'Vrati prikaz na Srbiju',
  viewSaved: 'Početni prikaz je sačuvan.',
  viewFailed: 'Prikaz nije sačuvan. Pokušaj ponovo.',
  openFailed: 'Ova grupa se nije otvorila. Možda više nije na mapi.',
  closed: 'Privatna grupa',
  places: 'mesta',
};

type Key = keyof typeof sr;

const en: Record<Key, string> = {
  appName: 'Map',
  loading: 'Loading the map…',
  failed: 'The map did not load. Try again.',
  retry: 'Try again',
  outdated: 'Open the page again for the map to work.',
  allKinds: 'All',
  showAll: 'Show all places',
  list: 'List of places',
  closeList: 'Close the list',
  inView: 'In view',
  atSpot: 'At this spot',
  noneInView: 'No place is in this part of the map.',
  empty: 'There are no places on this map yet.',
  emptyCreate: 'Tap “Add a place” to put the first one.',
  emptySettings: 'A group below this one gets a place in its settings, on the Location card.',
  truncated: 'Showing the first {n} places.',
  addPlace: 'Add a place',
  aim: 'Move the map until the pin stands right on the spot.',
  here: 'Here',
  cancel: 'Cancel',
  newPlace: 'New place',
  name: 'Name',
  namePlaceholder: 'Say: The bakery on the corner',
  kind: 'Kind',
  create: 'Create',
  creating: 'Creating…',
  createFailed: 'The place was not created. Try again.',
  nameNeeded: 'Type the name of the place.',
  startView: 'Starting view',
  saveView: 'Save this view as the starting one',
  resetView: 'Reset the view to Serbia',
  viewSaved: 'The starting view is saved.',
  viewFailed: 'The view was not saved. Try again.',
  openFailed: 'This group did not open. It may no longer be on the map.',
  closed: 'Private group',
  places: 'places',
};

const LETTERS: Record<string, string> = {
  a: 'а', b: 'б', c: 'ц', č: 'ч', ć: 'ћ', d: 'д', đ: 'ђ', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и',
  j: 'ј', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', š: 'ш', t: 'т', u: 'у',
  v: 'в', z: 'з', ž: 'ж',
};

const PAIRS: Record<string, string> = { lj: 'љ', nj: 'њ', dž: 'џ' };

/** Serbian Latin as Cyrillic: the app's own words, never what people typed. */
export function toCyrillic(text: string): string {
  return text.replace(/lj|nj|dž|[a-zčćđšž]/giu, (latin) => {
    const lower = latin.toLowerCase();
    const cyrillic = PAIRS[lower] ?? LETTERS[lower] ?? latin;

    return latin[0] === latin[0].toUpperCase() && latin[0] !== latin[0].toLowerCase()
      ? cyrillic.toUpperCase()
      : cyrillic;
  });
}

export type Language = 'sr' | 'sr-Cyrl' | 'en';

export function language(tag: string): Language {
  if (tag === 'en') return 'en';
  return tag === 'sr-Cyrl' ? 'sr-Cyrl' : 'sr';
}

export function translator(tag: string) {
  const lang = language(tag);

  return (key: Key, values: Record<string, string | number> = {}): string => {
    const text = lang === 'en' ? en[key] : lang === 'sr-Cyrl' ? toCyrillic(sr[key]) : sr[key];
    return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
  };
}

export type Translate = ReturnType<typeof translator>;

/** For the tests: the keys of each language. */
export const keys = { sr: Object.keys(sr), en: Object.keys(en) };

# potok mapa

Mapa podgrupa jedne grupe: Potok aplikacija koja prikazuje mapu Srbije (ili prikaz koji urednici sačuvaju) i na njoj kao pinove sve podgrupe neposredno ispod svoje grupe koje imaju mesto na mapi. Napravljena je po šablonu [potok-vite](https://github.com/aberged/potok-vite/tree/align-alt-descriptions): Vite, TypeScript, Tailwind, daisyUI sa prefiksom `d-` i lit-html, uz [Leaflet](https://leafletjs.com) i [supercluster](https://github.com/mapbox/supercluster).

Mesto je obična grupa. Dobija ga u svojim podešavanjima, na kartici **Lokacija** (geografska širina, dužina i pin), ili ga neko doda sa mape.

## Šta radi

- `getMapConfig` daje sve što mapa treba pre prvog pina: odakle su pločice, gde se mapa otvara, kako izgleda svaki pin (oblik, tonovi, ikonice sa nazivima na jeziku gledaoca) i šta gledalac sme.
- `listPlaces` daje mesta koja gledalac vidi, do 2000. Pin je ikonica koju je grupa izabrala ili, ako nije, znak njene vrste, isti kao na njenom avataru.
- Gusta mesta se skupljaju u krug sa brojem. Obod kruga je prsten podeljen po tonovima mesta u njemu, pa se vidi mešavina i pre otvaranja. Dodir otvara krug za nivo bliže, a mesta na istoj adresi postaju lista.
- Dodir na pin poziva `showGroup`: Potok otvara opis te grupe preko mape, sa linkom ka celoj grupi. Ako je opis aplikacija (Forma, Glasanje…), ona tu radi sa pravima te grupe. Mapa sama nikad ne pokreće tuđu aplikaciju.
- Čipovi vrsta sužavaju mapu na jednu vrstu, „Prikaži sva mesta“ uklapa sve pinove, a lista pokazuje mesta u trenutnom prikazu.
- Ko sme da pravi podgrupe dodaje mesto: pomeri mapu tako da krstić stoji na mestu, upiše naziv i izabere vrstu. Nastaje podgrupa kao iz menija „Kreiraj podgrupu“ (`createPlace`).
- Ko sme da uređuje grupu čuva trenutni prikaz kao početni, u config-u aplikacije (`saveConfig`).
- Kad se neka podgrupa promeni, Potok javi da nešto jeste (`onSubgroupsChange`), a mapa ponovo pročita mesta, svako u svom trenutku.

Pločice dolaze preko Potoka (`/tiles`), koji ih čuva i šalje dalje sa OpenStreetMap-a. OpenStreetMap tako ne vidi ko gleda, a izvor se menja na serveru, bez novog builda.

## Brzi start

```sh
npm install
npm run dev      # lokalno, na portu 5178, uz dev mock potok API-ja
npm test
npm run build    # tsc + vite build → dist/potok-build.html
```

U dev režimu `src/dev-tools.ts` puni mapu mestima širom Srbije, a pločice idu pravo sa OpenStreetMap-a. `src/dev-catalogue.json` je snimak pinova iz potok-ide-a (`PotokIdeWeb.PinIcons.catalogue/0`). `?viewer=guest` glumi gledaoca koji ne sme da dodaje mesta. Ispočetka: `localStorage.removeItem('potok-dev:places')`.

Ikonice dugmadi piše `python scripts/icons.py` iz Heroicons-a koje potok-ide već ima (`mix deps.get` tamo).

## Jezici

Stranica Potoka upisuje jezik u `<html lang>` okvira: `sr`, `sr-Cyrl` ili `en`. Reči su u `src/i18n.ts`. Srpski je referenca, a ćirilica se računa iz njega i važi samo za reči aplikacije, nikad za ono što su ljudi upisali. Nazivi vrsta i pinova stižu sa stranice, već prevedeni.

U dev režimu jezik se bira sa `?lang=en` ili `?lang=sr-Cyrl`.

## Struktura

- `src/app.ts`: mapa, pinovi, lista, dodavanje mesta i početni prikaz
- `src/places.ts`: izgled pina, klasteri, filteri i granice prikaza, bez DOM-a (testirano u `places.test.ts`)
- `src/pins.ts`: SVG pinova i klastera
- `src/i18n.ts`, `src/icons.ts`, `src/style.css`, `src/leaflet.css`
- `src/potok.ts`, `src/potok-dev.ts`: tipovi i dev mock API-ja, isti bajt po bajt u svim Potok aplikacijama

## Povezani projekti

- [potok-forme](https://github.com/aberged/potok-forme), [potok-glasanje](https://github.com/aberged/potok-glasanje), [potok-feed](https://github.com/aberged/potok-feed) i [potok-feed-creator](https://github.com/aberged/potok-feed-creator): aplikacije koje rade u opisu mesta

## Licenca

MIT, vidi [LICENSE](LICENSE). Tuđi kod u buildu i njegove licence su u [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

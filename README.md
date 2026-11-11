# potok mapa

Mapa podgrupa jedne grupe: Potok aplikacija koja prikazuje mapu Srbije (ili prikaz koji urednici sačuvaju) i na njoj kao pinove sve podgrupe neposredno ispod svoje grupe koje imaju mesto na mapi. Napravljena je po šablonu [potok-vite](https://github.com/aberged/potok-vite/tree/align-alt-descriptions): Vite, TypeScript, Tailwind, daisyUI sa prefiksom `d-` i lit-html, uz [Leaflet](https://leafletjs.com) i [supercluster](https://github.com/mapbox/supercluster).

Mesto je obična grupa. Dobija ga u svojim podešavanjima, na kartici **Lokacija** (geografska širina, dužina i pin), ili ga neko doda sa mape.

## Šta radi

- `getMapConfig` daje sve što mapa treba pre prvog pina: odakle su pločice, gde se mapa otvara, kako izgleda svaki pin (oblik, tonovi, ikonice sa nazivima na jeziku gledaoca) i šta gledalac sme.
- `listPlaces` sa pogledom mape (okvir i zum) daje mesta koja gledalac vidi. Mapa do 2000 mesta dobija sva i sama ih skuplja i filtrira. Veća mapa radi u režimu pogleda (vidi [Velike mape](#velike-mape)). Pin je ikonica koju je grupa izabrala ili, ako nije, znak njene vrste, isti kao na njenom avataru.
- Gusta mesta se skupljaju u krug sa brojem. Obod kruga je prsten podeljen po tonovima mesta u njemu, pa se vidi mešavina i pre otvaranja. Dodir otvara krug za nivo bliže, a mesta na istoj adresi postaju lista.
- Dodir na pin poziva `showGroup`: Potok otvara opis te grupe preko mape, sa linkom ka celoj grupi. Ako je opis aplikacija (Forma, Glasanje…), ona tu radi sa pravima te grupe. Mapa sama nikad ne pokreće tuđu aplikaciju.
- Čipovi vrsta sužavaju mapu na jednu vrstu, „Prikaži sva mesta“ uklapa sve pinove, a lista pokazuje mesta u trenutnom prikazu.
- Filter pinova: čim na mapi postoje bar dva različita pina, ispod pretrage se pojavi red čipova, po jedan za svaki pin, sa brojem mesta. Može se izabrati više čipova, pa mapa pokazuje mesta sa bilo kojim od njih, a krstić na kraju vraća sve. Pored ikonica postoje i „Bez ikonice“ (mesta koja pokazuju znak svoje vrste) i „Slika grupe“.
- Legenda: urednik mape (`can_edit_view`) u meniju za uređivanje bira „Nazivi pinova“ i daje pinovima imena za ovu mapu, na primer „Poginuli“, „Povređeni“ i „Materijalna šteta“. Imena se čuvaju u config-u aplikacije kao `data.legend` (`{"problem": "Poginuli", …}`), kroz isti `saveConfig` kao početni prikaz. Čip pokazuje ime iz legende, a bez njega naziv ikonice. Prazno polje briše ime. Imena su ono što je urednik upisao, pa se nikad ne preslovljavaju u ćirilicu.
- Ko sme da pravi podgrupe dodaje mesto: pomeri mapu tako da krstić stoji na mestu, upiše naziv i izabere vrstu. Nastaje podgrupa kao iz menija „Kreiraj podgrupu“ (`createPlace`).
- Ko sme da uređuje grupu čuva trenutni prikaz kao početni, u config-u aplikacije (`saveConfig`).
- Kad se neka podgrupa promeni, Potok javi da nešto jeste (`onSubgroupsChange`), a mapa ponovo pročita mesta, svako u svom trenutku.

Pločice dolaze preko Potoka (`/tiles`), koji ih čuva i šalje dalje sa OpenStreetMap-a. OpenStreetMap tako ne vidi ko gleda, a izvor se menja na serveru, bez novog builda.

## Velike mape

Mapa sa više od 2000 mesta (na primer, jedna godina saobraćajnih nezgoda ima oko 33.000) ne može da dobije sva mesta odjednom. Zato mapa pri učitavanju šalje `listPlaces` sa pogledom: okvir `[zapad, jug, istok, sever]`, ceo zum, `extent` i `counts`. Odgovor određuje režim:

- **Bez `mode` (stariji Potok) ili `mode: "all"`:** mapa dobija sva mesta i radi kao i do sada: supercluster, čipovi, pretraga, slojevi, granice područja i linije ruta, sve u pregledaču. Napomena „Prikazan je samo deo grupa“ ostaje samo za stari server, kad je odgovor skraćen na 2000.
- **`mode: "view"`:** Potok skuplja mesta u ćelije mreže od oko 64 piksela. Ćelija sa jednim mestom daje to mesto, a ostale daju krug sa brojem i tonovima. Mapa:
  - posle svakog pomeranja traži pogled ponovo, 250 ms pošto se mapa zaustavi, i crta samo najnoviji odgovor (svaki zahtev ima redni broj);
  - spaja markere susednih ćelija koji bi se dodirivali u jedan krug (`mergeMarkers`, kao na mapi korena) i ne crta ponovo marker koji pokazuje isto;
  - šalje pretragu (300 ms posle kucanja) i filter pinova serveru; brojevi na čipovima su za celu mapu (`pins` u odgovoru), bez obzira na filtere;
  - za „Prikaži sve“ koristi okvir koji je server dao za ono što filteri zadržavaju (`extent`);
  - na dodir kruga leti do njegovih mesta; ako su ona u jednoj tački, ako je mapa na najvećem zumu ili ako bi se i tamo dodirivala, `listPlacesAt` daje spisak mesta (najviše 50, po nazivu, uz napomenu kad ih ima još);
  - u listi „U prikazu“ pokazuje pojedinačna mesta i red „+N u krugovima, približi mapu“;
  - područja i rute prikazuje samo kao pinove, pa nema ni dugmeta za slojeve;
  - posle promene podgrupa čita ponovo najviše jednom u 10 sekundi, uz nasumični razmak, jer uvoz javlja promenu za svaki paket;
  - posle dodavanja mesta odmah traži pogled ponovo;
  - kad pogled ima više od 2000 ćelija (`truncated`), piše „Prikazan je deo mape“;
  - kad server javi `timeout`, kratko piše da se mapa predugo učitavala i zadržava poslednji pogled.

Režim se proverava pri svakom odgovoru, pa mapa sama prelazi u `view` kad mesta pređu 2000 i vraća se u `all` kad ih bude manje.

## Brzi start

```sh
npm install
npm run dev      # lokalno, na portu 5178, uz dev mock potok API-ja
npm test
npm run build    # tsc + vite build → dist/potok-build.html
```

U dev režimu `src/dev-tools.ts` puni mapu mestima širom Srbije, a pločice idu pravo sa OpenStreetMap-a. `src/dev-catalogue.json` je snimak pinova iz potok-ide-a (`PotokIdeWeb.PinIcons.catalogue/0`), sa pinom `warning` (Upozorenje). `?viewer=guest` glumi gledaoca koji ne sme da dodaje mesta. Ispočetka: `localStorage.removeItem('potok-dev:places')`.

`?seed=big` dodaje 5000 saobraćajnih nezgoda širom Srbije, sa pinovima `problem` (poginuli), `warning` (povređeni) i `transport` (materijalna šteta), od kojih neke stoje u istoj tački. Mock tada odgovara u režimu `view`, kao Potok. `?seed=small` vraća malu mapu.

Ikonice dugmadi piše `python scripts/icons.py` iz Heroicons-a koje potok-ide već ima (`mix deps.get` tamo).

## Jezici

Stranica Potoka upisuje jezik u `<html lang>` okvira: `sr`, `sr-Cyrl` ili `en`. Reči su u `src/i18n.ts`. Srpski je referenca, a ćirilica se računa iz njega i važi samo za reči aplikacije, nikad za ono što su ljudi upisali. Nazivi vrsta i pinova stižu sa stranice, već prevedeni.

U dev režimu jezik se bira sa `?lang=en` ili `?lang=sr-Cyrl`.

## Struktura

- `src/app.ts`: mapa, pinovi, lista, oba režima, filter pinova, legenda, dodavanje mesta i početni prikaz
- `src/places.ts`: izgled pina, klasteri, filter pinova i legenda, okvir pogleda, spajanje markera i šta radi dodir na krug velike mape, bez DOM-a (testirano u `places.test.ts`)
- `src/areas.ts`: područja i rute i šta mapa zadržava (vrsta, pinovi, pretraga, „samo unutra“), bez DOM-a (testirano u `areas.test.ts`)
- `src/pins.ts`: SVG pinova i klastera
- `src/i18n.ts`, `src/icons.ts`, `src/style.css`, `src/leaflet.css`
- `src/potok.ts`, `src/potok-dev.ts`: tipovi i dev mock API-ja, isti bajt po bajt u svim Potok aplikacijama

## Povezani projekti

- [potok-forme](https://github.com/aberged/potok-forme), [potok-glasanje](https://github.com/aberged/potok-glasanje), [potok-feed](https://github.com/aberged/potok-feed) i [potok-feed-creator](https://github.com/aberged/potok-feed-creator): aplikacije koje rade u opisu mesta

## Licenca

MIT, vidi [LICENSE](LICENSE). Tuđi kod u buildu i njegove licence su u [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

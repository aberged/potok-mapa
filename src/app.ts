import * as L from 'leaflet';
import { html, nothing, render, type TemplateResult } from 'lit-html';
import { unsafeSVG } from 'lit-html/directives/unsafe-svg.js';
import { areasAt, inBox, kept, LEVELS, levelFor, outerRings, shown, toLatLngs, type Geo, type Layers } from './areas';
import { translator, type Translate } from './i18n';
import { icon, type IconName } from './icons';
import { clusterHtml, pinSvg } from './pins';
import {
  buildIndex,
  clusterSize,
  inView,
  kindsOnMap,
  lookOf,
  ringGradient,
  sameSpot,
  savedBounds,
  type Bounds,
  type Index,
  type Pins,
} from './places';
import type { PotokConfig, PotokMapConfig, PotokPlace } from './potok';

// The map app: the sub-groups of its group that have a place, as pins on a
// map of Serbia or of the view its editors saved. A tap on a pin opens the
// group's description on Potok's page, over the map (`showGroup`), where its
// own app works with that group's rights. Whoever may make sub-groups here
// adds a place where the map's middle is.
//
// An area among them (`shape: "area"`) is only the shape of its group, as on
// Potok's map: the kind chips and the search keep it or leave it out like any
// place; it is a border with its pin once wide enough, a pin among the others
// before that. Borders come from `placeShapes` once per level of detail, for
// the part of the map in view, and stay here. A tap on the map off the pins
// shows the areas there, and "only inside" keeps the places of one area,
// which stays outlined.
//
// Leaflet draws the map and the pins; lit-html draws what floats over it.

type Adding =
  | { step: 'aim' }
  | { step: 'form'; lat: number; lng: number; name: string; kind: string; saving: boolean; error: string | null };

type Panel = { kind: 'view' } | { kind: 'spot'; ids: number[] };

type Here = { ids: number[]; selected: number };

type State = {
  status: 'loading' | 'ready' | 'failed' | 'outdated';
  config: PotokMapConfig | null;
  places: PotokPlace[];
  truncated: boolean;
  kind: string | null;
  selected: number | null;
  panel: Panel | null;
  adding: Adding | null;
  menu: boolean;
  notice: { text: string; error: boolean } | null;
  appConfig: PotokConfig | null;
  layers: Layers;
  layerMenu: boolean;
  inside: number | null;
  here: Here | null;
  search: string;
};

const PLACE_ZOOM = 16;
const FIT_PADDING: [number, number] = [56, 56];
const NOTICE_MS = 4000;
// Everyone with the map open hears of a change at once: they read again at
// a moment of their own, not all in the same one.
const REFRESH_SPREAD_MS = 2000;
// A tap waits this long, so that a double tap zooms instead.
const TAP_DELAY_MS = 250;
const SHAPES_PER_CALL = 100;
// Borders a view draws at most, the biggest first, as on Potok's map.
const MAX_BORDERS = 300;
// How long a move to a place or an area takes, in seconds, as on Potok's map.
const FLY_SECONDS = 0.5;
// An area's pin stands over the other pins.
const AREA_PIN_Z = 500;
// The whole world, around the holes of the area "only inside" keeps.
const WORLD: [number, number][] = [
  [-89.9, -540],
  [-89.9, 540],
  [89.9, 540],
  [89.9, -540],
];

export function mountMap(root: HTMLElement) {
  const lang = document.documentElement.lang;
  const t = translator(lang);
  const potok = window.potok;

  const mapEl = document.createElement('div');
  mapEl.className = 'pm-map';
  const overlay = document.createElement('div');
  overlay.className = 'pm-overlay';
  root.replaceChildren(mapEl, overlay);

  let state: State = {
    status: 'loading',
    config: null,
    places: [],
    truncated: false,
    kind: null,
    selected: null,
    panel: null,
    adding: null,
    menu: false,
    notice: null,
    appConfig: null,
    layers: { places: true, areas: true },
    layerMenu: false,
    inside: null,
    here: null,
    search: '',
  };

  let map: L.Map | null = null;
  let index: Index | null = null;
  let draft: L.Marker | null = null;
  const markers = L.layerGroup();
  const areaLayer = L.layerGroup();
  const maskLayer = L.layerGroup();
  const chosenLayer = L.layerGroup();
  const borderPins = L.layerGroup();
  let renderers: { areas: L.Renderer; mask: L.Renderer; chosen: L.Renderer } | null = null;
  // What is shown at the current zoom (`shown`), and which areas are borders.
  let borders: PotokPlace[] = [];
  let pinned: PotokPlace[] = [];
  let shownKey = '';
  // The markers of pins and the borders drawn, by place, so a pick only
  // changes their look.
  const pinMarkers = new Map<number, L.Marker>();
  const areaPaths = new Map<number, L.Polygon>();
  // Borders by `id:v:level`, and those on their way.
  const shapes = new Map<string, Geo>();
  const pendingShapes = new Set<string>();
  let tapTimer: ReturnType<typeof setTimeout> | undefined;
  const byId = new Map<number, PotokPlace>();
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  const set = (patch: Partial<State>) => {
    state = { ...state, ...patch };
    draw();
  };

  const notify = (text: string, error = false) => {
    clearTimeout(noticeTimer);
    set({ notice: { text, error } });
    noticeTimer = setTimeout(() => set({ notice: null }), NOTICE_MS);
  };

  const pins = (): Pins => state.config!.pins;

  // --- Loading ---

  const load = async () => {
    set({ status: 'loading' });

    try {
      const [config, places, appConfig] = await Promise.all([
        potok.getMapConfig(),
        potok.listPlaces(),
        potok.getConfig().catch(() => null),
      ]);

      if (!config.ok || !places.ok) {
        const error = !config.ok ? config.error : !places.ok ? places.error : null;
        set({ status: error === 'unknown_method' ? 'outdated' : 'failed' });
        return;
      }

      const { ok: _ok, ...mapConfig } = config;
      const stored = appConfig && appConfig.ok ? appConfig.config : null;

      state = {
        ...state,
        status: 'ready',
        config: mapConfig,
        places: places.places,
        truncated: places.truncated,
        appConfig: stored,
      };

      startMap(mapConfig, savedBounds(stored?.data) ?? mapConfig.default_bounds);
      rebuild();
      draw();
    } catch {
      set({ status: 'failed' });
    }
  };

  const refresh = async () => {
    const reply = await potok.listPlaces().catch(() => null);
    if (!reply || !reply.ok) return;

    const selected = reply.places.some((place) => place.id === state.selected) ? state.selected : null;
    const panel = state.panel?.kind === 'spot' ? null : state.panel;
    const inside = reply.places.some((place) => place.id === state.inside) ? state.inside : null;
    state = { ...state, places: reply.places, truncated: reply.truncated, selected, panel, inside, here: null };
    rebuild();
    draw();
  };

  // --- The map ---

  const startMap = (config: PotokMapConfig, bounds: Bounds) => {
    if (map) {
      map.fitBounds(bounds);
      return;
    }

    map = L.map(mapEl, {
      zoomControl: false,
      worldCopyJump: true,
      maxZoom: config.tiles.max_zoom,
      minZoom: 2,
    });

    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer(config.tiles.url, { maxZoom: config.tiles.max_zoom, attribution: config.tiles.attribution }).addTo(map);

    // Areas under the pins, the dimming around the one "only inside" keeps
    // above them, and its border above that.
    for (const [name, zIndex] of [
      ['pmAreas', '350'],
      ['pmMask', '360'],
      ['pmChosen', '370'],
    ] as const) {
      map.createPane(name).style.zIndex = zIndex;
    }

    renderers = {
      areas: L.svg({ pane: 'pmAreas', padding: 0.5 }),
      mask: L.svg({ pane: 'pmMask', padding: 0.5 }),
      chosen: L.svg({ pane: 'pmChosen', padding: 0.5 }),
    };

    areaLayer.addTo(map);
    maskLayer.addTo(map);
    chosenLayer.addTo(map);
    borderPins.addTo(map);
    markers.addTo(map);
    map.fitBounds(bounds);

    map.on('moveend', () => {
      // A zoom can turn an area from a pin into a border and back.
      const current = shown(state.places, shownOptions());
      if (signature(current) !== shownKey) rebuild(current);
      else drawMarkers();

      drawAreas();
      fetchShapes();
      if (state.panel?.kind === 'view') draw();
    });

    map.on('click', (event: L.LeafletMouseEvent) => {
      if (state.menu || state.layerMenu) {
        set({ menu: false, layerMenu: false });
        return;
      }

      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => tapAt(event.latlng), TAP_DELAY_MS);
    });

    map.on('dblclick zoomstart', () => clearTimeout(tapTimer));
  };

  const shownOptions = () => ({
    layers: state.layers,
    kind: state.kind,
    inside: state.inside,
    zoom: Math.round(map?.getZoom() ?? 0),
    search: state.search,
  });

  const signature = (current: { borders: PotokPlace[]; pins: PotokPlace[] }) =>
    `${current.borders.map((place) => place.id).join(',')}|${current.pins.map((place) => place.id).join(',')}`;

  const rebuild = (given?: { borders: PotokPlace[]; pins: PotokPlace[] }) => {
    byId.clear();
    state.places.forEach((place) => byId.set(place.id, place));

    const kind = state.kind !== null && state.places.some((place) => place.kind === state.kind) ? state.kind : null;
    const changed = kind !== state.kind;
    state = { ...state, kind };

    const current = given && !changed ? given : shown(state.places, shownOptions());
    borders = current.borders;
    pinned = current.pins;
    shownKey = signature(current);

    index = buildIndex(pinned, pins(), map?.getMaxZoom() ?? 19);
    drawMarkers();
    drawAreas();
    fetchShapes();
  };

  // --- Areas ---

  const shapeKey = (place: PotokPlace, level: number) => `${place.id}:${place.v ?? 0}:${level}`;

  // The border at this zoom's level of detail, or another level of the same
  // version while that one is on its way.
  const shapeOf = (place: PotokPlace): Geo | null => {
    const level = levelFor(Math.round(map?.getZoom() ?? 0));
    const nearest = [...LEVELS].sort((a, b) => Math.abs(a - level) - Math.abs(b - level));

    for (const candidate of nearest) {
      const shape = shapes.get(shapeKey(place, candidate));
      if (shape) return shape;
    }

    return null;
  };

  // The borders in view, the biggest first, at most `MAX_BORDERS`.
  const bordersInView = (): PotokPlace[] => {
    if (!map) return [];
    const box = map.getBounds();
    return inBox(borders, [box.getWest(), box.getSouth(), box.getEast(), box.getNorth()], MAX_BORDERS);
  };

  // The area "only inside" keeps, outlined whatever the zoom and the filters.
  const insideArea = (): PotokPlace | undefined =>
    state.inside === null ? undefined : byId.get(state.inside);

  const fetchShapes = () => {
    const wanted = [...bordersInView(), ...(insideArea()?.bbox ? [insideArea()!] : [])];
    if (!map || wanted.length === 0) return;

    const zoom = Math.round(map.getZoom());
    const level = levelFor(zoom);
    const missing = wanted.filter((place) => {
      const key = shapeKey(place, level);
      return !shapes.has(key) && !pendingShapes.has(key);
    });

    for (let start = 0; start < missing.length; start += SHAPES_PER_CALL) {
      const batch = missing.slice(start, start + SHAPES_PER_CALL);
      const keys = batch.map((place) => shapeKey(place, level));
      keys.forEach((key) => pendingShapes.add(key));

      void potok
        .placeShapes(
          batch.map((place) => place.id),
          zoom,
        )
        .then((reply) => {
          if (!reply.ok) return;
          for (const shape of reply.shapes) shapes.set(`${shape.id}:${shape.v}:${reply.level}`, shape.geojson);
          drawAreas();
        })
        .catch(() => {})
        .finally(() => keys.forEach((key) => pendingShapes.delete(key)));
    }
  };

  const drawAreas = () => {
    if (!map || !renderers || !state.config) return;

    areaLayer.clearLayers();
    maskLayer.clearLayers();
    chosenLayer.clearLayers();
    borderPins.clearLayers();
    areaPaths.clear();
    for (const place of borders) pinMarkers.delete(place.id);

    const view = map.getBounds();
    const holes: [number, number][][] = [];

    for (const place of bordersInView()) {
      const geo = shapeOf(place);
      const color = lookOf(place, pins()).color;

      if (geo && place.bbox) {
        const [west, south, east, north] = place.bbox;
        const covers =
          west <= view.getWest() && east >= view.getEast() && south <= view.getSouth() && north >= view.getNorth();
        const classes = ['pm-area', covers ? 'is-outline' : '', state.here?.selected === place.id ? 'is-selected' : ''];

        const path = L.polygon(toLatLngs(geo), {
          renderer: renderers.areas,
          color,
          fillColor: color,
          weight: 2,
          className: classes.filter(Boolean).join(' '),
        }).addTo(areaLayer);

        areaPaths.set(place.id, path);
      }

      const marker = pinMarker(place, AREA_PIN_Z);
      borderPins.addLayer(marker);
      pinMarkers.set(place.id, marker);
    }

    const inside = insideArea();
    const insideGeo = inside ? shapeOf(inside) : null;

    if (inside && insideGeo) {
      holes.push(...outerRings(insideGeo));

      L.polygon(toLatLngs(insideGeo), {
        renderer: renderers.chosen,
        color: lookOf(inside, pins()).color,
        weight: 3,
        fill: false,
        interactive: false,
        className: 'pm-area-chosen',
      }).addTo(chosenLayer);
    }

    if (holes.length > 0) {
      L.polygon([WORLD, ...holes], {
        renderer: renderers.mask,
        stroke: false,
        interactive: false,
        className: 'pm-area-mask',
      }).addTo(maskLayer);
    }
  };

  // A tap off the pins: the areas drawn there, smallest first.
  const tapAt = (latlng: L.LatLng) => {
    if (!state.layers.areas || state.adding) return;

    const drawn = bordersInView().flatMap((place) => {
      const geo = shapeOf(place);
      return geo ? [{ id: place.id, geo }] : [];
    });

    const ids = areasAt(drawn, latlng.lat, latlng.wrap().lng);
    state = { ...state, here: ids.length > 0 ? { ids, selected: ids[0] } : null };
    if (ids.length > 0) state = { ...state, panel: null };
    draw();
    drawAreas();
  };

  const pickHere = (id: number) => {
    if (!state.here) return;
    state = { ...state, here: { ...state.here, selected: id } };
    draw();
    markAreaSelected();
  };

  const closeHere = () => {
    state = { ...state, here: null };
    draw();
    markAreaSelected();
  };

  // The border picked on a tap stands out and on top; the rest as they were.
  const markAreaSelected = () => {
    for (const [id, path] of areaPaths) {
      const selected = state.here?.selected === id;
      path.getElement()?.classList.toggle('is-selected', selected);
      if (selected) path.bringToFront();
    }
  };

  // The pin of the group open on the page stands out and on top.
  const markSelected = () => {
    for (const [id, marker] of pinMarkers) {
      const selected = state.selected === id;
      marker.getElement()?.classList.toggle('is-selected', selected);
      marker.setZIndexOffset(selected ? 1000 : byId.get(id)?.shape === 'area' && borders.some((b) => b.id === id) ? AREA_PIN_Z : 0);
    }
  };

  const zoomToArea = (place: PotokPlace) => {
    if (!map || !place.bbox) return;
    const [west, south, east, north] = place.bbox;
    map.flyToBounds(
      [
        [south, west],
        [north, east],
      ],
      { padding: FIT_PADDING, duration: FLY_SECONDS },
    );
  };

  // Only the pins inside one area, or all again; going inside fits the map to it.
  const setInside = (id: number | null) => {
    state = { ...state, inside: id, panel: state.panel?.kind === 'spot' ? null : state.panel };
    rebuild();
    draw();

    const place = id === null ? undefined : byId.get(id);
    if (place) zoomToArea(place);
  };

  const toggleLayer = (key: keyof Layers) => {
    const layers = { ...state.layers, [key]: !state.layers[key] };
    state = { ...state, layers, here: layers.areas ? state.here : null };
    rebuild();
    draw();
  };

  const drawMarkers = () => {
    if (!map || !index || !state.config) return;

    const bounds = map.getBounds();
    const zoom = Math.round(map.getZoom());
    const features = index.getClusters([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], zoom);

    markers.clearLayers();
    for (const place of pinned) pinMarkers.delete(place.id);

    for (const feature of features) {
      const [lng, lat] = feature.geometry.coordinates;
      const props = feature.properties;

      if ('cluster' in props && props.cluster) {
        const count = props.point_count;
        const size = clusterSize(count);
        const label = t('groupsHere', { n: count });
        const marker = L.marker([lat, lng], {
          icon: L.divIcon({
            html: clusterHtml(count, size, ringGradient(props.tones, pins().tones), label),
            className: 'pm-cluster-icon',
            iconSize: [size, size],
          }),
          title: label,
          keyboard: true,
        });

        marker.on('click', () => openCluster(props.cluster_id, lat, lng));
        markers.addLayer(marker);
      } else if ('id' in props) {
        const place = byId.get(props.id);
        if (!place) continue;

        const marker = pinMarker(place, 0);
        markers.addLayer(marker);
        pinMarkers.set(place.id, marker);
      }
    }
  };

  const pinMarker = (place: PotokPlace, zIndex: number) => {
    const selected = state.selected === place.id;
    const marker = L.marker([place.lat, place.lng], {
      icon: L.divIcon({
        html: pinSvg(lookOf(place, pins()), pins(), { locked: !place.is_public }),
        className: selected ? 'pm-pin is-selected' : 'pm-pin',
        iconSize: [32, 40],
        iconAnchor: [16, 39],
      }),
      title: place.name,
      alt: place.name,
      keyboard: true,
      riseOnHover: true,
      zIndexOffset: selected ? 1000 : zIndex,
    });

    marker.on('click', () => void select(place));
    return marker;
  };

  // A cluster opens up a zoom level at a time; one that never would (places
  // at one address, or the last zoom) becomes a list.
  const openCluster = (clusterId: number, lat: number, lng: number) => {
    if (!map || !index) return;

    const leaves = index
      .getLeaves(clusterId, Infinity)
      .map((leaf) => byId.get(leaf.properties.id))
      .filter((place): place is PotokPlace => place !== undefined);

    const expansion = index.getClusterExpansionZoom(clusterId);

    if (sameSpot(leaves) || expansion > map.getMaxZoom()) {
      set({ panel: { kind: 'spot', ids: leaves.map((place) => place.id) }, menu: false });
    } else {
      map.flyTo([lat, lng], expansion, { duration: FLY_SECONDS });
    }
  };

  const select = async (place: PotokPlace) => {
    state = { ...state, selected: place.id, menu: false, panel: state.panel?.kind === 'spot' ? null : state.panel };
    draw();
    markSelected();

    const reply = await potok.showGroup(place.id).catch(() => null);

    if (!reply || !reply.ok) {
      state = { ...state, selected: null };
      markSelected();
      notify(reply && !reply.ok && reply.error === 'unknown_method' ? t('outdated') : t('openFailed'), true);
      if (reply && !reply.ok && reply.error === 'not_found') void refresh();
    }
  };

  const goTo = (place: PotokPlace) => {
    map?.flyTo([place.lat, place.lng], Math.max(map.getZoom(), PLACE_ZOOM), { duration: FLY_SECONDS });
    void select(place);
  };

  // Everything the chips, the search and "only inside" keep: areas whole,
  // pins where they stand.
  const fitAll = () => {
    const corners: [number, number][] = kept(state.places, shownOptions()).flatMap((place) => {
      if (state.layers.areas && place.bbox) {
        const [west, south, east, north] = place.bbox;
        return [
          [south, west],
          [north, east],
        ] as [number, number][];
      }

      return [[place.lat, place.lng] as [number, number]];
    });

    if (!map || corners.length === 0) return;
    map.flyToBounds(L.latLngBounds(corners), { padding: FIT_PADDING, maxZoom: PLACE_ZOOM, duration: FLY_SECONDS });
  };

  const setSearch = (search: string) => {
    state = { ...state, search, panel: state.panel?.kind === 'spot' ? null : state.panel, here: null };
    rebuild();
    draw();
  };

  const currentBounds = (): Bounds => {
    const bounds = map!.getBounds();
    return [
      [bounds.getSouth(), bounds.getWest()],
      [bounds.getNorth(), bounds.getEast()],
    ];
  };

  // --- Adding a place ---

  const startAdding = () =>
    set({ adding: { step: 'aim' }, panel: null, menu: false, layerMenu: false, selected: null, here: null });

  const cancelAdding = () => {
    draft?.remove();
    draft = null;
    set({ adding: null });
  };

  const aimHere = () => {
    if (!map || !state.config) return;

    const center = map.getCenter().wrap();
    const kind = state.config.place_kinds[0]?.key ?? 'chat';

    draft?.remove();
    draft = L.marker(center, {
      icon: L.divIcon({
        html: pinSvg(lookOf({ kind, pin: null, picture_url: null }, pins()), pins()),
        className: 'pm-pin is-draft',
        iconSize: [32, 40],
        iconAnchor: [16, 39],
      }),
      interactive: false,
    }).addTo(map);

    set({ adding: { step: 'form', lat: center.lat, lng: center.lng, name: '', kind, saving: false, error: null } });
  };

  const updateForm = (patch: Partial<Extract<Adding, { step: 'form' }>>) => {
    if (state.adding?.step !== 'form') return;

    const adding = { ...state.adding, ...patch };

    if (patch.kind && draft && state.config) {
      draft.setIcon(
        L.divIcon({
          html: pinSvg(lookOf({ kind: patch.kind, pin: null, picture_url: null }, pins()), pins()),
          className: 'pm-pin is-draft',
          iconSize: [32, 40],
          iconAnchor: [16, 39],
        }),
      );
    }

    set({ adding });
  };

  const createPlace = async (event: Event) => {
    event.preventDefault();
    const adding = state.adding;
    if (adding?.step !== 'form' || adding.saving) return;

    const name = adding.name.trim();
    if (name === '') {
      updateForm({ error: t('nameNeeded') });
      return;
    }

    updateForm({ saving: true, error: null });
    const reply = await potok
      .createPlace({ name, kind: adding.kind, lat: round6(adding.lat), lng: round6(adding.lng) })
      .catch(() => null);

    if (!reply || !reply.ok) {
      const message = reply && !reply.ok ? reply.message : undefined;
      updateForm({ saving: false, error: message || t('createFailed') });
      return;
    }

    draft?.remove();
    draft = null;
    state = { ...state, adding: null, places: [...state.places.filter((p) => p.id !== reply.place.id), reply.place] };
    rebuild();
    void select(reply.place);
  };

  // --- The starting view, for editors ---

  const saveView = async (bounds: Bounds | null) => {
    set({ menu: false });

    const write = async (config: PotokConfig | null) => {
      const data = { ...(config?.data ?? {}) } as Record<string, unknown>;
      if (bounds) data.view = { bounds: bounds.map(([lat, lng]) => [round5(lat), round5(lng)]) };
      else delete data.view;

      return potok.saveConfig(data, { revision: config?.revision ?? 0 });
    };

    let reply = await write(state.appConfig).catch(() => null);

    // Someone saved in between: write over what is there now, once.
    if (reply && !reply.ok && reply.error === 'conflict') {
      const fresh = await potok.getConfig().catch(() => null);
      if (fresh && fresh.ok) reply = await write(fresh.config).catch(() => null);
    }

    if (reply && reply.ok) {
      state = { ...state, appConfig: reply.config };
      notify(t('viewSaved'));
      if (!bounds && map && state.config) map.fitBounds(state.config.default_bounds);
    } else {
      notify(t('viewFailed'), true);
    }
  };

  // --- What floats over the map ---

  const view = (): TemplateResult => {
    if (state.status === 'loading') {
      return html`<div class="pm-center"><span class="pm-card">${t('loading')}</span></div>`;
    }

    if (state.status === 'outdated' || state.status === 'failed') {
      return html`<div class="pm-center">
        <div class="pm-card flex flex-col items-center gap-3 text-center">
          <p>${t(state.status === 'outdated' ? 'outdated' : 'failed')}</p>
          ${state.status === 'failed'
            ? html`<button type="button" class="pm-pill pm-pill-primary" @click=${() => void load()}>
                ${icon('retry', 'size-4')} ${t('retry')}
              </button>`
            : nothing}
        </div>
      </div>`;
    }

    const config = state.config!;
    const kinds = kindsOnMap(state.places, config.pins);
    const hasAreas = state.places.some((place) => place.shape === 'area');
    const insidePlace = state.inside === null ? undefined : byId.get(state.inside);

    return html`
      <div class="pm-top">
        ${state.places.length > 0 ? searchField() : nothing}
        ${kinds.length > 1 ? kindChips(kinds) : nothing}
        ${insidePlace
          ? html`<div class="pm-chips">
              <button
                type="button"
                id="pm-inside"
                class="pm-chip is-active"
                aria-label=${t('clearInside')}
                title=${t('clearInside')}
                @click=${() => setInside(null)}
              >
                ${icon('area', 'size-4')}
                <span>${t('inArea', { n: insidePlace.name })}</span>
                ${icon('close', 'size-4')}
              </button>
            </div>`
          : nothing}
        ${state.truncated
          ? html`<p class="pm-note">${t('truncated', { n: state.places.length })}</p>`
          : nothing}
        ${state.places.length === 0 && !state.adding ? emptyCard(config) : nothing}
      </div>
      <div class="pm-tools">
        ${state.places.length > 0 ? roundButton('fit', t('showAll'), fitAll) : nothing}
        ${roundButton(
          'list',
          state.panel?.kind === 'view' ? t('closeList') : t('list'),
          () => set({ panel: state.panel?.kind === 'view' ? null : { kind: 'view' }, menu: false }),
          state.panel?.kind === 'view',
        )}
        ${hasAreas
          ? roundButton(
              'layers',
              t('layers'),
              () => set({ layerMenu: !state.layerMenu, menu: false }),
              state.layerMenu || !state.layers.places || !state.layers.areas,
            )
          : nothing}
        ${config.can_edit_view
          ? roundButton('bookmark', t('startView'), () => set({ menu: !state.menu, layerMenu: false }), state.menu)
          : nothing}
        ${state.menu ? viewMenu() : nothing} ${state.layerMenu ? layerMenu() : nothing}
      </div>
      ${state.panel ? panel(state.panel) : nothing}
      ${state.here && !state.adding && !state.panel ? hereCard(state.here) : nothing}
      ${state.adding?.step === 'aim' ? aimCard() : nothing}
      ${state.adding?.step === 'form' ? placeForm(state.adding, config) : nothing}
      ${config.can_create_places && !state.adding && !state.panel && !state.here
        ? html`<div class="pm-bottom">
            <button type="button" id="pm-add" class="pm-pill pm-pill-primary pm-fab" @click=${startAdding}>
              ${icon('plus', 'size-5')} ${t('addPlace')}
            </button>
          </div>`
        : nothing}
      ${state.notice
        ? html`<div class="pm-notice ${state.notice.error ? 'is-error' : ''}" role="status">${state.notice.text}</div>`
        : nothing}
    `;
  };

  const searchField = () => html`<label class="pm-search">
    ${icon('search', 'size-4')}
    <input
      id="pm-search"
      type="search"
      placeholder=${t('search')}
      aria-label=${t('search')}
      autocomplete="off"
      .value=${state.search}
      @input=${(event: Event) => setSearch((event.target as HTMLInputElement).value)}
    />
  </label>`;

  const kindChips = (kinds: { key: string; title: string; count: number }[]) => html`
    <div class="pm-chips" role="toolbar" aria-label=${t('allKinds')}>
      ${chip(null, t('allKinds'), state.places.length)}
      ${kinds.map((kind) => chip(kind.key, kind.title, kind.count))}
    </div>
  `;

  const chip = (kind: string | null, title: string, count: number) => {
    const active = state.kind === kind;

    return html`<button
      type="button"
      class="pm-chip ${active ? 'is-active' : ''}"
      aria-pressed=${String(active)}
      @click=${() => {
        state = { ...state, kind, panel: state.panel?.kind === 'spot' ? null : state.panel };
        rebuild();
        draw();
      }}
    >
      ${kind ? html`<span class="pm-chip-pin">${unsafeSVG(pinSvg(kindLook(kind), pins(), { size: 18 }))}</span>` : nothing}
      <span>${title}</span>
      <span class="pm-chip-count">${count}</span>
    </button>`;
  };

  const kindLook = (kind: string) => lookOf({ kind, pin: null, picture_url: null }, pins());

  const roundButton = (name: IconName, label: string, onClick: () => void, pressed = false) => html`<button
    type="button"
    class="pm-round ${pressed ? 'is-active' : ''}"
    title=${label}
    aria-label=${label}
    aria-pressed=${String(pressed)}
    @click=${onClick}
  >
    ${icon(name, 'size-5')}
  </button>`;

  const layerMenu = () => html`<div class="pm-menu" role="menu" aria-label=${t('layers')}>
    ${layerItem('places', 'pin', t('layerPlaces'), t('layerPlacesHint'))}
    ${layerItem('areas', 'area', t('layerAreas'), t('layerAreasHint'))}
  </div>`;

  const layerItem = (key: keyof Layers, name: IconName, title: string, hint: string) => {
    const on = state.layers[key];

    return html`<button
      type="button"
      role="menuitemcheckbox"
      id=${`pm-layer-${key}`}
      aria-checked=${String(on)}
      class="pm-menu-item"
      @click=${() => toggleLayer(key)}
    >
      ${icon(name, 'size-4')}
      <span class="min-w-0 flex-1">
        <span class="block font-medium">${title}</span>
        <span class="block text-xs opacity-65">${hint}</span>
      </span>
      <span class="pm-switch ${on ? 'is-on' : ''}" aria-hidden="true"></span>
    </button>`;
  };

  // The areas where the viewer tapped: the one picked, what it does, and the
  // bigger ones around it.
  const hereCard = (here: Here) => {
    const area = byId.get(here.selected);
    if (!area) return nothing;

    const others = here.ids
      .filter((id) => id !== here.selected)
      .map((id) => byId.get(id))
      .filter((place): place is PotokPlace => place !== undefined);
    const chosen = state.inside === area.id;

    return html`<section class="pm-sheet pm-here" id="pm-here" aria-label=${area.name}>
      <header class="flex items-center gap-3">
        <span class="pm-row-pin">${unsafeSVG(pinSvg(lookOf(area, pins()), pins(), { size: 32, locked: !area.is_public }))}</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate font-semibold">${area.name}</span>
          <span class="block truncate text-xs opacity-65">${t('area')}${area.is_public ? '' : ` · ${t('closed')}`}</span>
        </span>
        ${roundButton('close', t('close'), closeHere)}
      </header>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" id="pm-here-open" class="pm-pill" @click=${() => void select(area)}>
          ${icon('open', 'size-4')} ${t('open')}
        </button>
        <button
          type="button"
          id="pm-here-inside"
          class="pm-pill ${chosen ? 'pm-pill-primary' : ''}"
          aria-pressed=${String(chosen)}
          @click=${() => setInside(chosen ? null : area.id)}
        >
          ${icon('area', 'size-4')} ${chosen ? t('allGroups') : t('onlyInside')}
        </button>
        ${roundButton('zoomIn', t('zoomToArea'), () => zoomToArea(area))}
      </div>
      ${others.length > 0
        ? html`<div>
            <p class="text-xs font-semibold opacity-65">${t('alsoHere')}</p>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              ${others.map(
                (other) => html`<button type="button" class="pm-chip" @click=${() => pickHere(other.id)}>
                  <span>${other.name}</span>
                </button>`,
              )}
            </div>
          </div>`
        : nothing}
    </section>`;
  };

  const viewMenu = () => html`<div class="pm-menu" role="menu">
    <button type="button" role="menuitem" class="pm-menu-item" @click=${() => void saveView(currentBounds())}>
      ${icon('bookmark', 'size-4')} ${t('saveView')}
    </button>
    <button type="button" role="menuitem" class="pm-menu-item" @click=${() => void saveView(null)}>
      ${icon('home', 'size-4')} ${t('resetView')}
    </button>
  </div>`;

  const emptyCard = (config: PotokMapConfig) => html`<div class="pm-card pm-empty">
    <span class="pm-empty-icon">${icon('map', 'size-5')}</span>
    <div>
      <p class="font-semibold">${t('empty')}</p>
      <p class="text-sm opacity-70">${config.can_create_places ? t('emptyCreate') : t('emptySettings')}</p>
    </div>
  </div>`;

  const panel = (current: Panel) => {
    const shown =
      current.kind === 'spot'
        ? current.ids.map((id) => byId.get(id)).filter((place): place is PotokPlace => place !== undefined)
        : map
          ? inView([...borders, ...pinned], currentBounds(), lang)
          : [];

    return html`<section class="pm-panel" aria-label=${current.kind === 'spot' ? t('atSpot') : t('list')}>
      <header class="pm-panel-head">
        <h2 class="font-semibold">${current.kind === 'spot' ? t('atSpot') : t('inView')}</h2>
        <span class="pm-chip-count">${shown.length}</span>
        <span class="flex-1"></span>
        ${roundButton('close', t('closeList'), () => set({ panel: null }))}
      </header>
      ${shown.length === 0
        ? html`<p class="px-4 pb-4 text-sm opacity-70">${t('noneInView')}</p>`
        : html`<ul class="pm-panel-list">
            ${shown.map((place) => placeRow(place))}
          </ul>`}
    </section>`;
  };

  const placeRow = (place: PotokPlace) => {
    const kind = pins().kinds.find((row) => row.key === place.kind);
    const holder = place.areas.length > 0 ? byId.get(place.areas[0]) : undefined;
    const what = place.shape === 'area' ? t('area') : (kind?.title ?? '');

    return html`<li>
      <button
        type="button"
        class="pm-row ${state.selected === place.id ? 'is-selected' : ''}"
        @click=${() => goTo(place)}
      >
        <span class="pm-row-pin">${unsafeSVG(pinSvg(lookOf(place, pins()), pins(), { size: 32, locked: !place.is_public }))}</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium">${place.name}</span>
          <span class="block truncate text-xs opacity-65">
            ${what}${holder ? ` · ${t('inArea', { n: holder.name })}` : ''}${place.is_public ? '' : ` · ${t('closed')}`}
          </span>
        </span>
      </button>
    </li>`;
  };

  const aimCard = () => html`
    <div class="pm-aim" aria-hidden="true">${unsafeSVG(pinSvg(kindLook('none'), pins()))}</div>
    <div class="pm-sheet">
      <p class="text-sm">${t('aim')}</p>
      <div class="flex justify-end gap-2">
        <button type="button" class="pm-pill" @click=${cancelAdding}>${t('cancel')}</button>
        <button type="button" id="pm-here" class="pm-pill pm-pill-primary" @click=${aimHere}>
          ${icon('pin', 'size-4')} ${t('here')}
        </button>
      </div>
    </div>
  `;

  const placeForm = (adding: Extract<Adding, { step: 'form' }>, config: PotokMapConfig) => html`
    <form class="pm-sheet" @submit=${createPlace} novalidate>
      <h2 class="font-semibold">${t('newPlace')}</h2>
      <label class="flex flex-col gap-1 text-sm">
        <span class="font-medium">${t('name')}</span>
        <input
          id="pm-name"
          class="pm-input"
          type="text"
          maxlength="120"
          autocomplete="off"
          placeholder=${t('namePlaceholder')}
          .value=${adding.name}
          @input=${(event: Event) => updateForm({ name: (event.target as HTMLInputElement).value, error: null })}
        />
      </label>
      <fieldset class="flex flex-col gap-1.5">
        <legend class="mb-1 text-sm font-medium">${t('kind')}</legend>
        <div class="pm-kinds">
          ${config.place_kinds.map(
            (kind) => html`<label class="pm-kind ${adding.kind === kind.key ? 'is-active' : ''}">
              <input
                type="radio"
                name="kind"
                class="sr-only"
                value=${kind.key}
                .checked=${adding.kind === kind.key}
                @change=${() => updateForm({ kind: kind.key })}
              />
              <span class="pm-kind-pin">${unsafeSVG(pinSvg(kindLook(kind.key), pins(), { size: 30 }))}</span>
              <span class="truncate">${kind.title}</span>
            </label>`,
          )}
        </div>
      </fieldset>
      ${adding.error ? html`<p class="text-sm text-error" role="alert">${adding.error}</p>` : nothing}
      <div class="flex justify-end gap-2">
        <button type="button" class="pm-pill" @click=${cancelAdding}>${t('cancel')}</button>
        <button type="submit" id="pm-create" class="pm-pill pm-pill-primary" ?disabled=${adding.saving}>
          ${icon('check', 'size-4')} ${adding.saving ? t('creating') : t('create')}
        </button>
      </div>
    </form>
  `;

  function draw() {
    render(view(), overlay);
    liftControls();
  }

  // On a phone an open sheet or list covers the bottom of the map: Leaflet's
  // zoom buttons and the map's attribution move up above it. On a wider
  // frame the list stands at the side and a sheet in the middle.
  function liftControls() {
    const cover = overlay.querySelector<HTMLElement>('.pm-sheet, .pm-panel');
    const narrow = window.matchMedia('(max-width: 639.98px)').matches;
    mapEl.style.setProperty('--pm-cover', cover && narrow ? `${cover.offsetHeight}px` : '0px');
  }

  // --- Live ---

  potok.onSubgroupsChange(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), Math.random() * REFRESH_SPREAD_MS);
  });

  potok.onGroupSheetClose((id) => {
    if (state.selected !== id) return;
    state = { ...state, selected: null };
    drawMarkers();
    drawAreas();
    draw();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (state.adding) cancelAdding();
    else if (state.menu || state.layerMenu) set({ menu: false, layerMenu: false });
    else if (state.panel) set({ panel: null });
    else if (state.here) closeHere();
  });

  // Leaflet measures its box once; the frame can change size with the page.
  new ResizeObserver(() => {
    map?.invalidateSize();
    liftControls();
  }).observe(mapEl);

  draw();
  void load();

  return { translate: t as Translate };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

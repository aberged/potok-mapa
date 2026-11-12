import * as L from 'leaflet';
import { html, nothing, render, type TemplateResult } from 'lit-html';
import { unsafeSVG } from 'lit-html/directives/unsafe-svg.js';
import {
  areasAt,
  distance,
  inBox,
  kept,
  LEVELS,
  levelFor,
  lineEnd,
  lineLatLngs,
  outerRings,
  shown,
  toLatLngs,
  type Geo,
  type Layers,
  type Shape,
} from './areas';
import { translator, type Translate } from './i18n';
import { icon, type IconName } from './icons';
import { clusterHtml, pinSvg } from './pins';
import {
  buildIndex,
  clusterAction,
  clusterKey,
  clusterSize,
  iconKeys,
  inView,
  kindsOnMap,
  LEGEND_MAX,
  legendOf,
  lookOf,
  mergeMarkers,
  pinCounts,
  pinOptions,
  placeKey,
  ringGradient,
  sameSpot,
  savedBounds,
  syncKeyed,
  togglePin,
  viewBox,
  type Bounds,
  type Index,
  type PinOption,
  type Pins,
} from './places';
import type {
  PotokConfig,
  PotokMapConfig,
  PotokPinCount,
  PotokPlace,
  PotokPlaceCluster,
  PotokPlacesAll,
  PotokPlacesQuery,
  PotokPlacesView,
} from './potok';

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
// A route (`shape: "route"`) is the same: its pin, at its start, is among the
// pins, and once wide enough its line is drawn over the borders, in the tone
// of its pin over a casing, with a ring at its end. A tap on the line opens
// the group as a tap on its pin does, and "only inside" keeps a route that
// passes through the area.
//
// A big map, of more than 2000 places, comes gathered by Potok: `listPlaces`
// with the view answers `mode: "view"`, the places alone in their cells and
// clusters for the rest. The map asks again for each view it stops at, draws
// only the newest reply and joins markers that would still touch; the search
// and the pin filter go to Potok, a cluster that will not spread lists its
// places (`listPlacesAt`), and areas and routes are only pins. A map of up to
// 2000 places, or an older Potok, gets all of them and does everything here.
//
// The pin filter keeps the places that show the pins picked, and the map's
// editors can name its pins for this map, as a legend (`config.data.legend`).
//
// Leaflet draws the map and the pins; lit-html draws what floats over it.

type Adding =
  | { step: 'aim' }
  | { step: 'form'; lat: number; lng: number; name: string; kind: string; saving: boolean; error: string | null };

// The places at a spot of a small map (`spot`, by id) or of a big one (`at`,
// as `listPlacesAt` gave them).
type Panel =
  | { kind: 'view' }
  | { kind: 'spot'; ids: number[] }
  | { kind: 'at'; places: PotokPlace[]; hasMore: boolean };

type Here = { ids: number[]; selected: number };

// What a big map shows in its view, as the newest reply gave it.
type View = { places: PotokPlace[]; clusters: PotokPlaceCluster[]; total: number; truncated: boolean };

type LegendForm = { names: Record<string, string>; saving: boolean; error: string | null };

type Wants = { extent?: boolean; counts?: boolean };

type State = {
  status: 'loading' | 'ready' | 'failed' | 'outdated';
  config: PotokMapConfig | null;
  // `all`: every place is here (`places`); `view`: Potok gathers them (`view`).
  mode: 'all' | 'view';
  places: PotokPlace[];
  truncated: boolean;
  view: View | null;
  // A big map's: how many places the filters keep and the box around them,
  // and how many show each pin, whatever the filters.
  extent: { count: number; bounds: Bounds | null } | null;
  counts: PotokPinCount[];
  pinFilter: string[];
  legendForm: LegendForm | null;
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
  /** Someone without an account: the map is theirs to look at, not to add to. */
  guest: boolean;
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
// Lines a view draws at most, the widest first, as on Potok's map.
const MAX_LINES = 150;
// How long a move to a place or an area takes, in seconds, as on Potok's map.
const FLY_SECONDS = 0.5;
// A big map asks for its view this long after it stops moving, and after the
// search stops changing.
const MOVE_DELAY_MS = 250;
const SEARCH_DELAY_MS = 300;
// A big map reads a change at most this often: an import changes it every
// second or two.
const VIEW_REFRESH_MS = 10_000;
// Asked again this long after Potok said there were too many asks.
const RETRY_MS = 2000;
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
    mode: 'all',
    places: [],
    truncated: false,
    view: null,
    extent: null,
    counts: [],
    pinFilter: [],
    legendForm: null,
    kind: null,
    selected: null,
    panel: null,
    adding: null,
    menu: false,
    notice: null,
    appConfig: null,
    layers: { places: true, areas: true, routes: true },
    layerMenu: false,
    inside: null,
    here: null,
    search: '',
    guest: false,
  };

  let map: L.Map | null = null;
  let index: Index | null = null;
  let draft: L.Marker | null = null;
  const markers = L.layerGroup();
  const areaLayer = L.layerGroup();
  const maskLayer = L.layerGroup();
  const chosenLayer = L.layerGroup();
  const routeLayer = L.layerGroup();
  let renderers: { areas: L.Renderer; mask: L.Renderer; chosen: L.Renderer; routes: L.Renderer } | null = null;
  // What is shown at the current zoom (`shown`): which areas are borders and
  // which routes are lines.
  let borders: PotokPlace[] = [];
  let lines: PotokPlace[] = [];
  let pinned: PotokPlace[] = [];
  let shownKey = '';
  // The markers of pins and the borders drawn, by place, so a pick only
  // changes their look.
  const pinMarkers = new Map<number, L.Marker>();
  const areaPaths = new Map<number, L.Polygon>();
  const routePaths = new Map<number, L.Polyline>();
  // Borders and lines by `id:v:level`, and those on their way.
  const shapes = new Map<string, Shape>();
  const pendingShapes = new Set<string>();
  let tapTimer: ReturnType<typeof setTimeout> | undefined;
  const byId = new Map<number, PotokPlace>();
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  // The catalogue's icons, for the pin filter.
  let icons: ReadonlySet<string> = new Set();
  // A big map's markers by what they show (`placeKey`, `clusterKey`), and
  // what they show after `mergeMarkers`.
  const viewMarkers = new Map<string, { marker: L.Marker; id: number | null }>();
  let drawnView: { places: PotokPlace[]; clusters: PotokPlaceCluster[] } = { places: [], clusters: [] };
  // Each ask for places has its number; only the newest reply is drawn.
  let placesSeq = 0;
  let countsSeq = 0;
  let spotSeq = 0;
  let viewTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingWants: Wants = {};
  let viewRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let lastViewRefresh = 0;
  let movedEarly = false;
  // How many places show each pin on a small map, by the places it was counted from.
  let countedFrom: PotokPlace[] | null = null;
  let allCounts: PotokPinCount[] = [];

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

  // The map's config first, then the map, then the places in its view: the
  // reply says whether the map gets all of them or Potok gathers them.
  const load = async () => {
    set({ status: 'loading' });

    try {
      const [config, appConfig, profile] = await Promise.all([
        potok.getMapConfig(),
        potok.getConfig().catch(() => null),
        potok.getCurrentProfile().catch(() => undefined),
      ]);

      if (!config.ok) {
        set({ status: config.error === 'unknown_method' ? 'outdated' : 'failed' });
        return;
      }

      const { ok: _ok, ...mapConfig } = config;
      const stored = appConfig && appConfig.ok ? appConfig.config : null;
      const saved = savedBounds(stored?.data);

      state = { ...state, config: mapConfig, appConfig: stored, guest: profile === null };
      icons = iconKeys(mapConfig.pins);
      startMap(mapConfig, saved ?? mapConfig.default_bounds);
      movedEarly = false;

      const { reply } = await askPlaces({ extent: true, counts: true });

      if (reply && !reply.ok && reply.error === 'timeout') {
        // Only a big map's view takes that long: an empty one, until a move.
        state = { ...state, status: 'ready' };
        showView({ ok: true, mode: 'view', places: [], clusters: [], total: 0, truncated: false });
        notify(t('viewTimeout'), true);
        return;
      }

      if (!reply || !reply.ok) {
        set({ status: reply?.error === 'unknown_method' ? 'outdated' : 'failed' });
        return;
      }

      state = { ...state, status: 'ready' };
      take(reply);

      // The view the editors saved is in the app's config, which a guest or a
      // non-member does not get: they open on the places, as "Show all" does.
      if (!saved && !(appConfig && appConfig.ok) && !movedEarly) fitAll(false);
      if (state.mode === 'view' && movedEarly) scheduleView(0);
    } catch {
      set({ status: 'failed' });
    }
  };

  // The places again, after a change: all of them, or the view of a big map
  // with its counts and extent.
  const refresh = () => readView({ extent: true, counts: true });

  // What the search and the pin filter keep, as Potok takes them.
  const filters = (): { search?: string; pins?: string[] } => ({
    ...(state.search.trim() !== '' ? { search: state.search.trim() } : {}),
    ...(state.pinFilter.length > 0 ? { pins: state.pinFilter } : {}),
  });

  const viewQuery = (wants: Wants): PotokPlacesQuery => {
    const bounds = map!.getBounds();

    return {
      bbox: viewBox(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()),
      zoom: Math.max(0, Math.min(24, Math.round(map!.getZoom()))),
      ...filters(),
      ...(wants.extent ? { extent: true } : {}),
      ...(wants.counts ? { counts: true } : {}),
    };
  };

  // Asks for the places in view, and for a big map's counts and extent too
  // while it has none. The counts are kept from the newest reply that has
  // them, the extent from any that still fits the filters, so a move does not
  // lose what a change of the filters asked for.
  const askPlaces = async (wants: Wants) => {
    const seq = ++placesSeq;
    const asked = JSON.stringify(filters());
    const query = viewQuery({
      extent: wants.extent || state.extent === null,
      counts: wants.counts || state.counts.length === 0,
    });
    const reply = await potok.listPlaces(query).catch(() => null);

    if (reply && reply.ok && reply.mode === 'view') {
      if (reply.pins && seq > countsSeq) {
        countsSeq = seq;
        state = { ...state, counts: reply.pins };
      }
      if (reply.extent && asked === JSON.stringify(filters())) state = { ...state, extent: reply.extent };
    }

    return { reply, fresh: seq === placesSeq };
  };

  // A big map's view, or the places again after a change; only the newest
  // reply is drawn. A view that took too long keeps the last one drawn.
  const readView = async (wants: Wants) => {
    if (!map || state.status !== 'ready') return;

    const { reply, fresh } = await askPlaces(wants);

    if (!fresh) {
      if (state.mode === 'view') draw();
      return;
    }

    if (!reply) return;

    if (!reply.ok) {
      if (reply.error === 'timeout') notify(t('viewTimeout'), true);
      else if (reply.error === 'rate_limited') scheduleView(RETRY_MS, wants);
      return;
    }

    take(reply);
  };

  // Asks for a big map's view after `delay`; what any ask in between wanted
  // comes along.
  const scheduleView = (delay: number, wants: Wants = {}) => {
    pendingWants = {
      extent: pendingWants.extent || wants.extent,
      counts: pendingWants.counts || wants.counts,
    };
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => {
      const asked = pendingWants;
      pendingWants = {};
      void readView(asked);
    }, delay);
  };

  const take = (reply: PotokPlacesAll | PotokPlacesView) => {
    if (reply.mode === 'view') showView(reply);
    else showAll(reply);
  };

  // All of a map's places: what stays picked stays, as it did.
  const showAll = (reply: PotokPlacesAll) => {
    if (state.mode === 'view') clearView();

    const selected = reply.places.some((place) => place.id === state.selected) ? state.selected : null;
    const panel = state.panel?.kind === 'spot' || state.panel?.kind === 'at' ? null : state.panel;
    const inside = reply.places.some((place) => place.id === state.inside) ? state.inside : null;
    state = {
      ...state,
      mode: 'all',
      places: reply.places,
      truncated: reply.truncated,
      view: null,
      extent: null,
      counts: [],
      selected,
      panel,
      inside,
      here: null,
    };
    rebuild();
    draw();
  };

  // A big map's view, drawn over the one before.
  const showView = (reply: PotokPlacesView) => {
    if (state.mode === 'all') leaveAll();

    const { places, clusters, total, truncated } = reply;
    state = { ...state, mode: 'view', truncated: false, view: { places, clusters, total, truncated } };
    drawView();
    draw();
  };

  // From all the places to a big map's view: no places, borders or lines of
  // their own, no kind or area to keep.
  const leaveAll = () => {
    index = null;
    borders = [];
    lines = [];
    pinned = [];
    shownKey = '';
    byId.clear();
    markers.clearLayers();
    pinMarkers.clear();
    for (const layer of [areaLayer, maskLayer, chosenLayer, routeLayer]) layer.clearLayers();
    areaPaths.clear();
    routePaths.clear();

    state = {
      ...state,
      places: [],
      kind: null,
      inside: null,
      here: null,
      layerMenu: false,
      panel: state.panel?.kind === 'spot' ? null : state.panel,
    };
  };

  // From a big map's view back to all the places.
  const clearView = () => {
    for (const { marker } of viewMarkers.values()) markers.removeLayer(marker);
    viewMarkers.clear();
    pinMarkers.clear();
    drawnView = { places: [], clusters: [] };
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
    // above them, its border above that, and routes over all of them, still
    // under the pins.
    for (const [name, zIndex] of [
      ['pmAreas', '350'],
      ['pmMask', '360'],
      ['pmChosen', '370'],
      ['pmRoutes', '380'],
    ] as const) {
      map.createPane(name).style.zIndex = zIndex;
    }

    renderers = {
      areas: L.svg({ pane: 'pmAreas', padding: 0.5 }),
      mask: L.svg({ pane: 'pmMask', padding: 0.5 }),
      chosen: L.svg({ pane: 'pmChosen', padding: 0.5 }),
      routes: L.svg({ pane: 'pmRoutes', padding: 0.5 }),
    };

    areaLayer.addTo(map);
    maskLayer.addTo(map);
    chosenLayer.addTo(map);
    routeLayer.addTo(map);
    markers.addTo(map);
    map.fitBounds(bounds);

    map.on('moveend', () => {
      if (state.status === 'loading') movedEarly = true;

      // A big map: the markers joined again for this zoom, and the view asked
      // for once the map stays still.
      if (state.mode === 'view') {
        drawView();
        scheduleView(MOVE_DELAY_MS);
        if (state.panel?.kind === 'view') draw();
        return;
      }

      // A zoom can turn an area or a route from a pin into a shape and back.
      const current = shown(state.places, shownOptions());
      if (signature(current) !== shownKey) rebuild(current);
      else drawMarkers();

      drawAreas();
      drawRoutes();
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
    pins: state.pinFilter.length > 0 ? { keys: new Set(state.pinFilter), icons } : null,
  });

  type Shown = ReturnType<typeof shown>;

  const signature = (current: Shown) =>
    [current.borders, current.lines, current.pins].map((list) => list.map((place) => place.id).join(',')).join('|');

  const rebuild = (given?: Shown) => {
    byId.clear();
    state.places.forEach((place) => byId.set(place.id, place));

    const kind = state.kind !== null && state.places.some((place) => place.kind === state.kind) ? state.kind : null;
    const changed = kind !== state.kind;
    state = { ...state, kind };

    const current = given && !changed ? given : shown(state.places, shownOptions());
    borders = current.borders;
    lines = current.lines;
    pinned = current.pins;
    shownKey = signature(current);

    index = buildIndex(pinned, pins(), map?.getMaxZoom() ?? 19);
    drawMarkers();
    drawAreas();
    drawRoutes();
    fetchShapes();
  };

  // --- Areas ---

  const shapeKey = (place: PotokPlace, level: number) => `${place.id}:${place.v ?? 0}:${level}`;

  // The border or line at this zoom's level of detail, or another level of
  // the same version while that one is on its way.
  const shapeOf = (place: PotokPlace): Shape | null => {
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

  // The lines in view, the widest first, at most `MAX_LINES`.
  const linesInView = (): PotokPlace[] => {
    if (!map) return [];
    const box = map.getBounds();
    return inBox(lines, [box.getWest(), box.getSouth(), box.getEast(), box.getNorth()], MAX_LINES);
  };

  // An area's border, when the shape kept for it is one.
  const borderOf = (place: PotokPlace): Geo | null => {
    const shape = shapeOf(place);
    return shape?.type === 'MultiPolygon' ? shape : null;
  };

  // The area "only inside" keeps, outlined whatever the zoom and the filters.
  const insideArea = (): PotokPlace | undefined =>
    state.inside === null ? undefined : byId.get(state.inside);

  const fetchShapes = () => {
    const wanted = [...bordersInView(), ...linesInView(), ...(insideArea()?.bbox ? [insideArea()!] : [])];
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
          drawRoutes();
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
    areaPaths.clear();

    const view = map.getBounds();
    const holes: [number, number][][] = [];

    for (const place of bordersInView()) {
      const geo = borderOf(place);
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
    }

    const inside = insideArea();
    const insideGeo = inside ? borderOf(inside) : null;

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

  // The lines of the routes in view: a casing, the line in the tone of the
  // route's pin, a wider line nobody sees that takes a tap, and a ring at its
  // end (none for a loop). A tap opens the group, as its pin does.
  const drawRoutes = () => {
    if (!map || !renderers || !state.config) return;

    routeLayer.clearLayers();
    routePaths.clear();
    const renderer = renderers.routes;

    for (const place of linesInView()) {
      const shape = shapeOf(place);
      if (shape?.type !== 'MultiLineString') continue;

      const parts = lineLatLngs(shape);
      if (parts.length === 0) continue;

      const color = lookOf(place, pins()).color;
      const common = { renderer, lineCap: 'round' as const, lineJoin: 'round' as const };

      L.polyline(parts, { ...common, color: '#ffffff', weight: 6.5, interactive: false, className: 'pm-route-casing' }).addTo(
        routeLayer,
      );

      const line = L.polyline(parts, {
        ...common,
        color,
        weight: 3.5,
        interactive: false,
        className: state.selected === place.id ? 'pm-route is-selected' : 'pm-route',
      }).addTo(routeLayer);

      L.polyline(parts, { ...common, color, opacity: 0, weight: 18, bubblingMouseEvents: false, className: 'pm-route-hit' })
        .on('click', () => void select(place))
        .addTo(routeLayer);

      const end = lineEnd(parts);

      if (end) {
        L.circleMarker(end, {
          renderer,
          radius: 4.5,
          color,
          weight: 2.5,
          fillColor: '#ffffff',
          fillOpacity: 1,
          interactive: false,
          className: 'pm-route-end',
        }).addTo(routeLayer);
      }

      routePaths.set(place.id, line);
    }
  };

  // A tap off the pins: the areas drawn there, smallest first.
  const tapAt = (latlng: L.LatLng) => {
    if (!state.layers.areas || state.adding) return;

    const drawn = bordersInView().flatMap((place) => {
      const geo = borderOf(place);
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

  // The pin of the group open on the page stands out and on top, and so does
  // its line for a route.
  const markSelected = () => {
    for (const [id, marker] of pinMarkers) {
      const selected = state.selected === id;
      marker.getElement()?.classList.toggle('is-selected', selected);
      marker.setZIndexOffset(selected ? 1000 : 0);
    }

    for (const [id, line] of routePaths) {
      line.getElement()?.classList.toggle('is-selected', state.selected === id);
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
        const ring = ringGradient(props.tones, pins().tones);
        markers.addLayer(clusterMarker(props.point_count, lat, lng, ring, () => openCluster(props.cluster_id, lat, lng)));
      } else if ('id' in props) {
        const place = byId.get(props.id);
        if (!place) continue;

        const marker = pinMarker(place);
        markers.addLayer(marker);
        pinMarkers.set(place.id, marker);
      }
    }
  };

  const pinMarker = (place: PotokPlace) => {
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
      zIndexOffset: selected ? 1000 : 0,
    });

    marker.on('click', () => void select(place));
    return marker;
  };

  // A cluster: its count on a disc, in the ring of its tones.
  const clusterMarker = (count: number, lat: number, lng: number, ring: string, onClick: () => void) => {
    const size = clusterSize(count);
    const label = t('groupsHere', { n: count });
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        html: clusterHtml(count, size, ring, label),
        className: 'pm-cluster-icon',
        iconSize: [size, size],
      }),
      title: label,
      keyboard: true,
    });

    marker.on('click', onClick);
    return marker;
  };

  // --- A big map's view ---

  // The reply's places and clusters, joined where they would touch at this
  // zoom; a marker that shows the same as before stays as it is.
  const drawView = () => {
    if (!map || !state.view || !state.config) return;

    const current = map;
    drawnView = mergeMarkers(state.view.places, state.view.clusters, (lat, lng) => current.latLngToLayerPoint([lat, lng]), pins());

    const next = new Map<string, () => { marker: L.Marker; id: number | null }>();

    for (const cluster of drawnView.clusters) {
      const ring = ringGradient(cluster.tones, pins().tones);
      next.set(clusterKey(cluster, ring), () => ({
        marker: clusterMarker(cluster.count, cluster.lat, cluster.lng, ring, () => openViewCluster(cluster)),
        id: null,
      }));
    }

    for (const place of drawnView.places) {
      next.set(placeKey(place), () => ({ marker: pinMarker(place), id: place.id }));
    }

    syncKeyed(
      viewMarkers,
      next,
      (item) => markers.addLayer(item.marker),
      (item) => markers.removeLayer(item.marker),
    );

    pinMarkers.clear();
    for (const { marker, id } of viewMarkers.values()) if (id !== null) pinMarkers.set(id, marker);
    markSelected();
  };

  // A big map's cluster spreads as the map zooms in; one that never would
  // becomes a list of its places, from Potok.
  const openViewCluster = (cluster: PotokPlaceCluster) => {
    if (!map) return;

    const box = L.latLngBounds(cluster.bounds);
    const action = clusterAction(cluster.bounds, map.getZoom(), map.getMaxZoom(), map.getBoundsZoom(box.pad(0.2)));

    if (action.list) void openSpot(cluster.bounds);
    else map.flyTo(box.getCenter(), action.zoom, { duration: FLY_SECONDS });
  };

  // The places at one spot of a big map, by name, as many as Potok gives.
  const openSpot = async (bounds: Bounds) => {
    const seq = ++spotSeq;
    const reply = await potok.listPlacesAt(bounds, filters()).catch(() => null);
    if (seq !== spotSeq || state.mode !== 'view') return;

    if (!reply || !reply.ok) {
      notify(reply && !reply.ok && reply.error === 'unknown_method' ? t('outdated') : t('spotFailed'), true);
      return;
    }

    set({ panel: { kind: 'at', places: reply.places, hasMore: reply.has_more }, menu: false, here: null });
  };

  // The markers a big map draws in view: places alone, and how many the
  // clusters hold.
  const viewInView = (): { places: PotokPlace[]; gathered: number } => {
    if (!map) return { places: [], gathered: 0 };

    const bounds = map.getBounds();
    const gathered = drawnView.clusters
      .filter((cluster) => bounds.contains([cluster.lat, cluster.lng]))
      .reduce((sum, cluster) => sum + cluster.count, 0);

    return { places: inView(drawnView.places, currentBounds(), lang), gathered };
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

  // Everything the chips, the search and "only inside" keep: areas and
  // routes whole, pins where they stand. A big map: the box Potok gave
  // around what the filters keep.
  const fitAll = (animate = true) => {
    const fit = (bounds: L.LatLngBoundsExpression) => {
      if (!map) return;

      if (animate) map.flyToBounds(bounds, { padding: FIT_PADDING, maxZoom: PLACE_ZOOM, duration: FLY_SECONDS });
      else map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: PLACE_ZOOM });
    };

    if (state.mode === 'view') {
      const bounds = state.extent?.bounds;
      if (bounds) fit(bounds);
      return;
    }

    const corners: [number, number][] = kept(state.places, shownOptions()).flatMap((place) => {
      const whole = place.shape === 'area' ? state.layers.areas : place.shape === 'route' && state.layers.routes;

      if (whole && place.bbox) {
        const [west, south, east, north] = place.bbox;
        return [
          [south, west],
          [north, east],
        ] as [number, number][];
      }

      return [[place.lat, place.lng] as [number, number]];
    });

    if (corners.length === 0) return;
    fit(L.latLngBounds(corners));
  };

  // The search and the pin filter: here on a small map, at Potok on a big one,
  // where the places at a spot are listed again by a tap.
  const setSearch = (search: string) => {
    if (state.mode === 'view') {
      set({ search, panel: state.panel?.kind === 'at' ? null : state.panel });
      scheduleView(SEARCH_DELAY_MS, { extent: true });
      return;
    }

    state = { ...state, search, panel: state.panel?.kind === 'spot' ? null : state.panel, here: null };
    rebuild();
    draw();
  };

  const setPinFilter = (pinFilter: string[]) => {
    if (state.mode === 'view') {
      set({ pinFilter, panel: state.panel?.kind === 'at' ? null : state.panel });
      scheduleView(0, { extent: true });
      return;
    }

    state = { ...state, pinFilter, panel: state.panel?.kind === 'spot' ? null : state.panel, here: null };
    rebuild();
    draw();
  };

  // The pins on the map as chips: counted here on a small map, by Potok on a
  // big one, named as the legend says.
  const pinChipOptions = (): PinOption[] => {
    if (state.mode === 'all' && countedFrom !== state.places) {
      countedFrom = state.places;
      allCounts = pinCounts(state.places, pins());
    }

    return pinOptions(
      state.mode === 'view' ? state.counts : allCounts,
      pins(),
      legendOf(state.appConfig?.data),
      { kind: t('pinKind'), picture: t('pinPicture') },
      state.pinFilter,
    );
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
    set({
      adding: { step: 'aim' },
      panel: null,
      menu: false,
      layerMenu: false,
      selected: null,
      here: null,
      legendForm: null,
    });

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

    // A big map: the view again, with the new place in it and in the counts.
    if (state.mode === 'view') {
      state = { ...state, adding: null };
      void readView({ extent: true, counts: true });
      void select(reply.place);
      return;
    }

    state = { ...state, adding: null, places: [...state.places.filter((p) => p.id !== reply.place.id), reply.place] };
    rebuild();
    void select(reply.place);
  };

  // --- The starting view and the legend, for editors ---

  // Writes one change into the app's config, keeping the rest of it; true
  // once it is saved.
  const writeConfig = async (change: (data: Record<string, unknown>) => void): Promise<boolean> => {
    const write = async (config: PotokConfig | null) => {
      const data = { ...(config?.data ?? {}) } as Record<string, unknown>;
      change(data);

      return potok.saveConfig(data, { revision: config?.revision ?? 0 });
    };

    let reply = await write(state.appConfig).catch(() => null);

    // Someone saved in between: write over what is there now, once.
    if (reply && !reply.ok && reply.error === 'conflict') {
      const fresh = await potok.getConfig().catch(() => null);
      if (fresh && fresh.ok) reply = await write(fresh.config).catch(() => null);
    }

    if (!reply || !reply.ok) return false;

    state = { ...state, appConfig: reply.config };
    return true;
  };

  const saveView = async (bounds: Bounds | null) => {
    set({ menu: false });

    const saved = await writeConfig((data) => {
      if (bounds) data.view = { bounds: bounds.map(([lat, lng]) => [round5(lat), round5(lng)]) };
      else delete data.view;
    });

    if (saved) {
      notify(t('viewSaved'));
      if (!bounds && map && state.config) map.fitBounds(state.config.default_bounds);
    } else {
      notify(t('viewFailed'), true);
    }
  };

  // The legend: the names the editors give the map's pins, as they typed
  // them; an empty one brings back the icon's own.
  const startLegend = () =>
    set({
      legendForm: { names: { ...legendOf(state.appConfig?.data) }, saving: false, error: null },
      menu: false,
      layerMenu: false,
      panel: null,
      here: null,
    });

  const nameLegend = (key: string, name: string) => {
    if (!state.legendForm) return;
    set({ legendForm: { ...state.legendForm, names: { ...state.legendForm.names, [key]: name }, error: null } });
  };

  const saveLegend = async (event: Event) => {
    event.preventDefault();
    const form = state.legendForm;
    if (!form || form.saving) return;

    const legend = legendOf({ legend: form.names });
    set({ legendForm: { ...form, saving: true, error: null } });

    const saved = await writeConfig((data) => {
      if (Object.keys(legend).length > 0) data.legend = legend;
      else delete data.legend;
    });

    if (saved) {
      state = { ...state, legendForm: null };
      notify(t('legendSaved'));
    } else {
      set({ legendForm: { ...form, saving: false, error: t('legendFailed') } });
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
    const big = state.mode === 'view';
    const hasPlaces = big || state.places.length > 0;
    const kinds = kindsOnMap(state.places, config.pins);
    const hasAreas = state.places.some((place) => place.shape === 'area');
    const hasRoutes = state.places.some((place) => place.shape === 'route');
    const insidePlace = state.inside === null ? undefined : byId.get(state.inside);
    const pinChoices = pinChipOptions();
    const hasPinChips = pinChoices.length > 1 || state.pinFilter.length > 0;
    const canFit = big ? Boolean(state.extent?.bounds) : state.places.length > 0;

    return html`
      <div class="pm-top">
        ${hasPlaces ? searchField() : nothing}
        ${kinds.length > 1 ? kindChips(kinds) : nothing}
        ${hasPinChips ? pinChips(pinChoices) : nothing}
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
        ${big && state.view?.truncated ? html`<p class="pm-note">${t('viewTruncated')}</p>` : nothing}
        ${!hasPlaces && !state.adding ? emptyCard(config) : nothing}
      </div>
      <div class="pm-tools">
        ${canFit ? roundButton('fit', t('showAll'), () => fitAll()) : nothing}
        ${roundButton(
          'list',
          state.panel?.kind === 'view' ? t('closeList') : t('list'),
          () => set({ panel: state.panel?.kind === 'view' ? null : { kind: 'view' }, menu: false }),
          state.panel?.kind === 'view',
        )}
        ${hasAreas || hasRoutes
          ? roundButton(
              'layers',
              t('layers'),
              () => set({ layerMenu: !state.layerMenu, menu: false }),
              state.layerMenu ||
                !state.layers.places ||
                (hasAreas && !state.layers.areas) ||
                (hasRoutes && !state.layers.routes),
            )
          : nothing}
        ${config.can_edit_view
          ? roundButton(
              'bookmark',
              hasPinChips ? t('editMap') : t('startView'),
              () => set({ menu: !state.menu, layerMenu: false }),
              state.menu,
            )
          : nothing}
        ${state.menu ? viewMenu(hasPinChips) : nothing} ${state.layerMenu ? layerMenu(hasAreas, hasRoutes) : nothing}
      </div>
      ${state.panel ? panel(state.panel) : nothing}
      ${state.here && !state.adding && !state.panel ? hereCard(state.here) : nothing}
      ${state.adding?.step === 'aim' ? aimCard() : nothing}
      ${state.adding?.step === 'form' ? placeForm(state.adding, config) : nothing}
      ${state.legendForm && !state.adding ? legendSheet(state.legendForm, pinChoices) : nothing}
      ${config.can_create_places && !state.adding && !state.panel && !state.here && !state.legendForm
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

  const numbers = new Intl.NumberFormat(lang === 'en' ? 'en' : 'sr-Latn');

  // The pin filter: any of the pins picked, every pin when none is.
  const pinChips = (options: PinOption[]) => html`
    <div class="pm-chips" role="toolbar" aria-label=${t('pinFilter')} id="pm-pins">
      ${options.map((option) => {
        const active = state.pinFilter.includes(option.key);

        return html`<button
          type="button"
          class="pm-chip ${active ? 'is-active' : ''}"
          aria-pressed=${String(active)}
          data-pin=${option.key}
          @click=${() => setPinFilter(togglePin(state.pinFilter, option.key))}
        >
          <span class="pm-chip-pin">${unsafeSVG(pinSvg(option.look, pins(), { size: 18 }))}</span>
          <span>${option.title}</span>
          <span class="pm-chip-count">${numbers.format(option.count)}</span>
        </button>`;
      })}
      ${state.pinFilter.length > 0
        ? html`<button
            type="button"
            id="pm-pins-clear"
            class="pm-chip pm-chip-clear"
            aria-label=${t('clearPins')}
            title=${t('clearPins')}
            @click=${() => setPinFilter([])}
          >
            ${icon('close', 'size-4')}
          </button>`
        : nothing}
    </div>
  `;

  // The editors' names for the pins on the map, each over the icon's own.
  const legendSheet = (form: LegendForm, options: PinOption[]) => html`
    <form class="pm-sheet" id="pm-legend" @submit=${saveLegend} novalidate>
      <div>
        <h2 class="font-semibold">${t('legend')}</h2>
        <p class="mt-1 text-sm opacity-70">${t('legendHint')}</p>
      </div>
      <div class="pm-legend">
        ${options.map(
          (option) => html`<label class="pm-legend-row">
            <span class="pm-row-pin">${unsafeSVG(pinSvg(option.look, pins(), { size: 28 }))}</span>
            <input
              class="pm-input"
              type="text"
              maxlength=${LEGEND_MAX}
              autocomplete="off"
              data-pin=${option.key}
              aria-label=${option.fallback}
              placeholder=${option.fallback}
              .value=${form.names[option.key] ?? ''}
              @input=${(event: Event) => nameLegend(option.key, (event.target as HTMLInputElement).value)}
            />
          </label>`,
        )}
      </div>
      ${form.error ? html`<p class="text-sm text-error" role="alert">${form.error}</p>` : nothing}
      <div class="flex justify-end gap-2">
        <button type="button" class="pm-pill" @click=${() => set({ legendForm: null })}>${t('cancel')}</button>
        <button type="submit" id="pm-legend-save" class="pm-pill pm-pill-primary" ?disabled=${form.saving}>
          ${icon('check', 'size-4')} ${form.saving ? t('saving') : t('save')}
        </button>
      </div>
    </form>
  `;

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

  const layerMenu = (areas: boolean, routes: boolean) => html`<div class="pm-menu" role="menu" aria-label=${t('layers')}>
    ${layerItem('places', 'pin', t('layerPlaces'), t('layerPlacesHint'))}
    ${areas ? layerItem('areas', 'area', t('layerAreas'), t('layerAreasHint')) : nothing}
    ${routes ? layerItem('routes', 'route', t('layerRoutes'), t('layerRoutesHint')) : nothing}
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

  const viewMenu = (legend: boolean) => html`<div class="pm-menu" role="menu">
    <button type="button" role="menuitem" class="pm-menu-item" @click=${() => void saveView(currentBounds())}>
      ${icon('bookmark', 'size-4')} ${t('saveView')}
    </button>
    <button type="button" role="menuitem" class="pm-menu-item" @click=${() => void saveView(null)}>
      ${icon('home', 'size-4')} ${t('resetView')}
    </button>
    ${legend
      ? html`<button type="button" role="menuitem" id="pm-legend-open" class="pm-menu-item" @click=${startLegend}>
          ${icon('legend', 'size-4')} ${t('legend')}
        </button>`
      : nothing}
  </div>`;

  const emptyCard = (config: PotokMapConfig) => html`<div class="pm-card pm-empty">
    <span class="pm-empty-icon">${icon('map', 'size-5')}</span>
    <div>
      <p class="font-semibold">${t('empty')}</p>
      <p class="text-sm opacity-70">
        ${config.can_create_places ? t('emptyCreate') : state.guest ? t('emptyGuest') : t('emptySettings')}
      </p>
    </div>
  </div>`;

  // The places in view, or at one spot. A big map lists the places alone in
  // view and says how many more the circles hold.
  const panel = (current: Panel) => {
    const big = current.kind === 'view' && state.mode === 'view' ? viewInView() : null;
    const shown =
      current.kind === 'spot'
        ? current.ids.map((id) => byId.get(id)).filter((place): place is PotokPlace => place !== undefined)
        : current.kind === 'at'
          ? current.places
          : big
            ? big.places
            : map
              ? inView(pinned, currentBounds(), lang)
              : [];
    const atSpot = current.kind !== 'view';
    const more = current.kind === 'at' && current.hasMore;
    const gathered = big?.gathered ?? 0;

    return html`<section class="pm-panel" aria-label=${atSpot ? t('atSpot') : t('list')}>
      <header class="pm-panel-head">
        <h2 class="font-semibold">${atSpot ? t('atSpot') : t('inView')}</h2>
        <span class="pm-chip-count">${shown.length}${more ? '+' : ''}</span>
        <span class="flex-1"></span>
        ${roundButton('close', t('closeList'), () => set({ panel: null }))}
      </header>
      ${shown.length === 0 && gathered === 0
        ? html`<p class="px-4 pb-4 text-sm opacity-70">${t('noneInView')}</p>`
        : shown.length === 0
          ? nothing
          : html`<ul class="pm-panel-list">
              ${shown.map((place) => placeRow(place))}
            </ul>`}
      ${gathered > 0
        ? html`<p class="pm-panel-note" id="pm-in-clusters">${t('inClusters', { n: numbers.format(gathered) })}</p>`
        : nothing}
      ${more ? html`<p class="pm-panel-note">${t('spotMore', { n: shown.length })}</p>` : nothing}
    </section>`;
  };

  const placeRow = (place: PotokPlace) => {
    const kind = pins().kinds.find((row) => row.key === place.kind);
    // A plain group ("none") says what its pin says, as the legend names it,
    // rather than that it has no kind: every row of a dataset would say so.
    const icon = place.kind === 'none' && place.pin ? pins().icons.find((row) => row.key === place.pin) : undefined;
    const pinName = icon ? (legendOf(state.appConfig?.data)[icon.key] ?? icon.title) : undefined;
    const holder = place.areas.length > 0 ? byId.get(place.areas[0]) : undefined;
    const what =
      place.shape === 'area'
        ? t('area')
        : place.shape === 'route'
          ? `${t('route')}${place.length ? ` · ${distance(place.length, lang)}` : ''}`
          : (pinName ?? kind?.title ?? '');
    const where = holder ? t(place.shape === 'route' ? 'through' : 'inArea', { n: holder.name }) : '';

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
            ${what}${where ? ` · ${where}` : ''}${place.is_public ? '' : ` · ${t('closed')}`}
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
    // A big map reads again at most once in `VIEW_REFRESH_MS`, still at a
    // moment of its own.
    if (state.mode === 'view') {
      if (viewRefreshTimer !== undefined) return;

      const wait = Math.max(0, lastViewRefresh + VIEW_REFRESH_MS - Date.now()) + Math.random() * REFRESH_SPREAD_MS;
      viewRefreshTimer = setTimeout(() => {
        viewRefreshTimer = undefined;
        lastViewRefresh = Date.now();
        void refresh();
      }, wait);
      return;
    }

    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), Math.random() * REFRESH_SPREAD_MS);
  });

  potok.onGroupSheetClose((id) => {
    if (state.selected !== id) return;
    state = { ...state, selected: null };
    if (state.mode === 'view') markSelected();
    else drawMarkers();
    drawAreas();
    draw();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (state.adding) cancelAdding();
    else if (state.legendForm && !state.legendForm.saving) set({ legendForm: null });
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

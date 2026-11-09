import * as L from 'leaflet';
import { html, nothing, render, type TemplateResult } from 'lit-html';
import { unsafeSVG } from 'lit-html/directives/unsafe-svg.js';
import { translator, type Translate } from './i18n';
import { icon, type IconName } from './icons';
import { clusterHtml, pinSvg } from './pins';
import {
  buildIndex,
  clusterSize,
  inView,
  kindsOnMap,
  lookOf,
  ofKind,
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
// Leaflet draws the map and the pins; lit-html draws what floats over it.

type Adding =
  | { step: 'aim' }
  | { step: 'form'; lat: number; lng: number; name: string; kind: string; saving: boolean; error: string | null };

type Panel = { kind: 'view' } | { kind: 'spot'; ids: number[] };

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
};

const PLACE_ZOOM = 16;
const FIT_PADDING: [number, number] = [56, 56];
const NOTICE_MS = 4000;
// Everyone with the map open hears of a change at once: they read again at
// a moment of their own, not all in the same one.
const REFRESH_SPREAD_MS = 2000;

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
  };

  let map: L.Map | null = null;
  let index: Index | null = null;
  let draft: L.Marker | null = null;
  const markers = L.layerGroup();
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
    state = { ...state, places: reply.places, truncated: reply.truncated, selected, panel };
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
      minZoom: 3,
    });

    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.tileLayer(config.tiles.url, { maxZoom: config.tiles.max_zoom, attribution: config.tiles.attribution }).addTo(map);
    markers.addTo(map);
    map.fitBounds(bounds);

    map.on('moveend', () => {
      drawMarkers();
      if (state.panel?.kind === 'view') draw();
    });

    map.on('click', () => {
      if (state.menu) set({ menu: false });
    });
  };

  const rebuild = () => {
    byId.clear();
    state.places.forEach((place) => byId.set(place.id, place));

    const kind = state.kind !== null && state.places.some((place) => place.kind === state.kind) ? state.kind : null;
    state = { ...state, kind };

    index = buildIndex(ofKind(state.places, kind), pins(), map?.getMaxZoom() ?? 19);
    drawMarkers();
  };

  const drawMarkers = () => {
    if (!map || !index || !state.config) return;

    const bounds = map.getBounds();
    const zoom = Math.round(map.getZoom());
    const features = index.getClusters([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], zoom);

    markers.clearLayers();

    for (const feature of features) {
      const [lng, lat] = feature.geometry.coordinates;
      const props = feature.properties;

      if ('cluster' in props && props.cluster) {
        const count = props.point_count;
        const size = clusterSize(count);
        const label = `${count} ${t('places')}`;
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

        const selected = state.selected === place.id;
        const marker = L.marker([lat, lng], {
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
        markers.addLayer(marker);
      }
    }
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
      map.setView([lat, lng], expansion);
    }
  };

  const select = async (place: PotokPlace) => {
    state = { ...state, selected: place.id, menu: false, panel: state.panel?.kind === 'spot' ? null : state.panel };
    draw();
    drawMarkers();

    const reply = await potok.showGroup(place.id).catch(() => null);

    if (!reply || !reply.ok) {
      state = { ...state, selected: null };
      drawMarkers();
      notify(reply && !reply.ok && reply.error === 'unknown_method' ? t('outdated') : t('openFailed'), true);
      if (reply && !reply.ok && reply.error === 'not_found') void refresh();
    }
  };

  const goTo = (place: PotokPlace) => {
    map?.setView([place.lat, place.lng], Math.max(map.getZoom(), PLACE_ZOOM));
    void select(place);
  };

  const fitAll = () => {
    const shown = ofKind(state.places, state.kind);
    if (!map || shown.length === 0) return;

    map.fitBounds(L.latLngBounds(shown.map((place) => [place.lat, place.lng] as [number, number])), {
      padding: FIT_PADDING,
      maxZoom: PLACE_ZOOM,
    });
  };

  const currentBounds = (): Bounds => {
    const bounds = map!.getBounds();
    return [
      [bounds.getSouth(), bounds.getWest()],
      [bounds.getNorth(), bounds.getEast()],
    ];
  };

  // --- Adding a place ---

  const startAdding = () => set({ adding: { step: 'aim' }, panel: null, menu: false, selected: null });

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

    return html`
      <div class="pm-top">
        ${kinds.length > 1 ? kindChips(kinds) : nothing}
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
        ${config.can_edit_view
          ? roundButton('bookmark', t('startView'), () => set({ menu: !state.menu }), state.menu)
          : nothing}
        ${state.menu ? viewMenu() : nothing}
      </div>
      ${state.panel ? panel(state.panel) : nothing}
      ${state.adding?.step === 'aim' ? aimCard() : nothing}
      ${state.adding?.step === 'form' ? placeForm(state.adding, config) : nothing}
      ${config.can_create_places && !state.adding && !state.panel
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
          ? inView(ofKind(state.places, state.kind), currentBounds(), lang)
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
            ${kind?.title ?? ''}${place.is_public ? '' : ` · ${t('closed')}`}
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
    draw();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (state.adding) cancelAdding();
    else if (state.menu) set({ menu: false });
    else if (state.panel) set({ panel: null });
  });

  // Leaflet measures its box once; the frame can change size with the page.
  new ResizeObserver(() => map?.invalidateSize()).observe(mapEl);

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

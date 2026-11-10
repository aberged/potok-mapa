import type { Look, Pins } from './places';

// The pins and clusters as SVG and HTML strings: Leaflet takes a marker's
// look as HTML (`divIcon`). The shape and glyphs come from Potok's page
// (`getMapConfig`), the same drawing the group's settings show.

const PIN_SIZE = { width: 32, height: 40 };

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let clipCounter = 0;

/** A pin: the drop in its tone with a white glyph, or the group's picture; a lock for a closed group. */
export function pinSvg(look: Look, pins: Pins, options: { locked?: boolean; size?: number } = {}): string {
  const scale = (options.size ?? PIN_SIZE.height) / PIN_SIZE.height;
  const width = Math.round(PIN_SIZE.width * scale);
  const height = Math.round(PIN_SIZE.height * scale);
  const drop = escapeAttribute(pins.drop || 'M16 38.5C11 33 2 24 2 15a14 14 0 1 1 28 0c0 9-9 18-14 23.5Z');
  const transform = escapeAttribute(pins.glyph_transform || 'translate(7 6) scale(0.75)');

  let inner: string;

  if (look.picture) {
    const clip = `pm-clip-${++clipCounter}`;
    inner =
      `<defs><clipPath id="${clip}"><circle cx="16" cy="15" r="12"/></clipPath></defs>` +
      `<image href="${escapeAttribute(look.picture)}" x="4" y="3" width="24" height="24" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>`;
  } else {
    const paths = look.paths
      .map((path) => {
        const rule = path.evenodd ? ' fill-rule="evenodd" clip-rule="evenodd"' : '';
        return `<path d="${escapeAttribute(path.d)}"${rule}/>`;
      })
      .join('');
    inner = `<g transform="${transform}" fill="#ffffff">${paths}</g>`;
  }

  const lock = options.locked
    ? '<g><circle cx="26.5" cy="6.5" r="5.5" fill="#ffffff"/>' +
      '<rect x="23.9" y="6.3" width="5.2" height="3.9" rx="0.8" fill="#1f2937"/>' +
      '<path d="M24.9 6.4v-0.9a1.6 1.6 0 0 1 3.2 0v0.9" fill="none" stroke="#1f2937" stroke-width="1"/></g>'
    : '';

  return (
    `<svg viewBox="0 0 32 40" width="${width}" height="${height}" aria-hidden="true" focusable="false">` +
    `<path d="${drop}" fill="${escapeAttribute(look.color)}" stroke="#ffffff" stroke-width="1.75" stroke-linejoin="round"/>` +
    inner +
    lock +
    '</svg>'
  );
}

/** A cluster's count as it fits on the disc: 1.5k past a thousand, 12k past ten, as on Potok's map. */
export function clusterText(count: number): string {
  if (count >= 10_000) return `${Math.floor(count / 1000)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

/** A cluster: its count on a disc, in a ring of the tones of its places. */
export function clusterHtml(count: number, size: number, ring: string, label: string): string {
  const text = clusterText(count);

  return (
    `<div class="pm-cluster" style="--pm-size:${size}px;--pm-ring:${escapeAttribute(ring)}" role="img" aria-label="${escapeAttribute(label)}">` +
    `<span>${text}</span></div>`
  );
}

/* ============================================================================
   BLAZZER — icon set
   Hand-drawn inline SVG marks. Crystals get a faceted gemstone so the currency
   reads as BLAZZER's own asset rather than a borrowed emoji — four facets in
   graduated cyan, an internal glow and a crisp top-edge highlight. Gradient ids
   are uniquified per call so any number of icons can share one page without
   duplicate ids. Pure strings: no DOM, no dependencies.
   ========================================================================= */

let uid = 0;

/**
 * Faceted crystal shard. Scales cleanly from 14px (inline text) to 64px (hero)
 * because every facet is vector. Returns an SVG string.
 * @param {number} [size]
 */
export function crystalIcon(size = 16) {
  const id = `skc${(uid += 1)}`;
  return (
    `<svg class="crystal-icon" width="${size}" height="${size}" viewBox="0 0 32 32" ` +
    `fill="none" aria-hidden="true" focusable="false">` +
    `<defs>` +
    `<linearGradient id="${id}r" x1="29" y1="5" x2="17" y2="25" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#4ec8dc"/><stop offset="1" stop-color="#135565"/></linearGradient>` +
    `<linearGradient id="${id}l" x1="3" y1="5" x2="15" y2="25" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#8ceaf6"/><stop offset="1" stop-color="#2a9cb3"/></linearGradient>` +
    `<linearGradient id="${id}c" x1="16" y1="13" x2="16" y2="29" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#c2f6ff"/><stop offset="1" stop-color="#1a7b90"/></linearGradient>` +
    `<linearGradient id="${id}t" x1="9" y1="3" x2="23" y2="14" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#effeff"/><stop offset="1" stop-color="#8de8f5"/></linearGradient>` +
    `<radialGradient id="${id}g" cx="16" cy="11" r="16" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.8"/>` +
    `<stop offset="0.45" stop-color="#a9f2ff" stop-opacity="0.16"/>` +
    `<stop offset="1" stop-color="#5ed2e2" stop-opacity="0"/></radialGradient>` +
    `</defs>` +
    // Right half (base), left half, centre pavilion, table — four shades of depth.
    `<path d="M11.5 3.5h9L29 13.5 16 29 3 13.5z" fill="url(#${id}r)"/>` +
    `<path d="M11.5 3.5 3 13.5 16 29z" fill="url(#${id}l)"/>` +
    `<path d="M8 13.5h16L16 29z" fill="url(#${id}c)"/>` +
    `<path d="M11.5 3.5h9L24 13.5H8z" fill="url(#${id}t)"/>` +
    // Inner glow, facet seams, crisp edge and the polished top-edge highlight.
    `<path d="M11.5 3.5h9L29 13.5 16 29 3 13.5z" fill="url(#${id}g)"/>` +
    `<path d="M8 13.5h16" stroke="#082b33" stroke-opacity="0.45" stroke-width="0.7"/>` +
    `<path d="M11.5 3.5 3 13.5M20.5 3.5 29 13.5" stroke="#0a3038" stroke-opacity="0.3" stroke-width="0.6"/>` +
    `<path d="M11.5 3.5h9L29 13.5 16 29 3 13.5z" stroke="#c6f5ff" stroke-opacity="0.5" ` +
    `stroke-width="0.8" stroke-linejoin="round"/>` +
    `<path d="M11.5 3.5h9" stroke="#f6ffff" stroke-opacity="0.85" stroke-width="0.9" ` +
    `stroke-linecap="round"/>` +
    `</svg>`
  );
}

/**
 * Compact mine marker for the Mines board. Same metallic treatment as the
 * crystal so the two read as one icon family.
 * @param {number} [size]
 */
export function bombIcon(size = 20) {
  const id = `skb${(uid += 1)}`;
  return (
    `<svg class="mine-icon" width="${size}" height="${size}" viewBox="0 0 32 32" ` +
    `fill="none" aria-hidden="true" focusable="false">` +
    `<defs>` +
    `<radialGradient id="${id}b" cx="12" cy="16" r="14" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#6a717b"/><stop offset="1" stop-color="#22252b"/></radialGradient>` +
    `<linearGradient id="${id}f" x1="20" y1="11" x2="28" y2="3" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#e79a5c"/><stop offset="1" stop-color="#f6d9a8"/></linearGradient>` +
    `</defs>` +
    `<path d="M20.5 11.5c1.6-3.2 3.4-4.6 5.7-4.1" stroke="url(#${id}f)" stroke-width="1.9" ` +
    `stroke-linecap="round"/>` +
    `<circle cx="26.6" cy="6.9" r="2.4" fill="#ffd27a"/>` +
    `<circle cx="26.6" cy="6.9" r="4" fill="#ffd27a" fill-opacity="0.28"/>` +
    `<circle cx="14.5" cy="18.5" r="9" fill="url(#${id}b)" stroke="#7c838d" stroke-opacity="0.55" ` +
    `stroke-width="0.9"/>` +
    `<path d="M9 14.5a6.4 6.4 0 0 1 4.6-3.6" stroke="#c9d0d8" stroke-opacity="0.6" stroke-width="1.2" ` +
    `stroke-linecap="round"/>` +
    `</svg>`
  );
}

/**
 * Fill every static `<span data-crystal="18">` placeholder in the document with
 * the matching icon. Lets index.html stay readable while still rendering the
 * real SVG (and avoids duplicating gradient ids in the markup).
 */
export function hydrateCrystalIcons(root = document) {
  root.querySelectorAll('[data-crystal]').forEach((el) => {
    const size = Number(el.getAttribute('data-crystal')) || 16;
    el.innerHTML = crystalIcon(size);
  });
}

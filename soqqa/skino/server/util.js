/* ============================================================================
   BLAZZER — shared server helpers
   Pure, dependency-light utilities used across the live feed. Anything that
   turns untrusted input into something we render lives here so it is validated
   in exactly one place.
   ========================================================================= */

import crypto from 'node:crypto';

/* Identicon palette — drawn from the brand accents so avatars feel native. */
const PALETTE = ['#5ed2e2', '#a98cf0', '#e8c56a', '#7bd88f', '#e08a8a', '#6aa6ff'];
const IDENTICON_BG = '#15171c';

/**
 * Privacy-preserving display name: "Az***77". Handles very short names without
 * leaking them entirely.
 */
export function maskUsername(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'Anonymous';
  const n = raw.length;
  if (n <= 2) return `${raw[0] || '*'}***`;
  if (n <= 4) return `${raw.slice(0, 1)}***${raw.slice(-1)}`;
  return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
}

function hashSeed(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest();
}

/**
 * A deterministic, symmetric block avatar generated from a seed — no external
 * service, no network, no PII. Returns a data-URI SVG so clients can drop it
 * straight into an <img>.
 */
export function identicon(seed, size = 64) {
  const hash = hashSeed(seed);
  const color = PALETTE[hash[0] % PALETTE.length];
  const cells = 5;
  const cell = size / cells;
  let rects = '';
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < Math.ceil(cells / 2); x += 1) {
      const on = (hash[(y * cells + x + 1) % hash.length] & 1) === 1;
      if (!on) continue;
      const mirror = cells - 1 - x;
      rects += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`;
      if (mirror !== x) {
        rects += `<rect x="${mirror * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`;
      }
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" ` +
    `fill="${IDENTICON_BG}"/><g fill="${color}">${rects}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Strip control chars and angle brackets, collapse whitespace, clamp length. */
export function sanitizeText(value, max = 120) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Clamp to an integer within [min, max], falling back when not finite. */
export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function isSafeHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

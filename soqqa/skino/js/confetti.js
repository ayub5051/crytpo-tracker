/* ============================================================================
   BLAZZER — Win confetti
   A lightweight celebration: pieces of paper fall from the top of the viewport
   with gentle sway and rotation, then the DOM is cleaned up. Motion lives in
   style.css (keyframes) — this module only provisions pieces and removes them
   again, so nothing lingers once the effect has finished.
   ========================================================================= */

/* Cyan, white, soft gold and soft violet — tasteful, on-palette, not rainbow. */
const PALETTE = ['#5ed2e2', '#f2f3f5', '#e8c56a', '#a98cf0'];
const SHAPES = ['is-rect', 'is-circle', 'is-ribbon'];

/* Piece count caps: a full desktop burst, tightened for small screens. */
const DESKTOP_CAP = 120;
const MOBILE_CAP = 50;

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

let layer = null;
let glow = null;
let glowTimer = 0;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

/** Lazily create (once) the fixed layer the pieces draw into. */
function ensureLayer() {
  if (layer) return layer;
  layer = document.createElement('div');
  layer.className = 'confetti-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
  return layer;
}

function ensureGlow() {
  if (glow) return glow;
  glow = document.createElement('div');
  glow.className = 'win-glow';
  glow.setAttribute('aria-hidden', 'true');
  document.body.append(glow);
  return glow;
}

/** Soft pulse used instead of confetti when reduced motion is requested. */
function flashGlow() {
  const el = ensureGlow();
  el.classList.remove('is-on');
  void el.offsetWidth; // restart the pulse on back-to-back wins
  el.classList.add('is-on');
  window.clearTimeout(glowTimer);
  glowTimer = window.setTimeout(() => el.classList.remove('is-on'), 1100);
}

function makePiece() {
  const piece = document.createElement('span');
  piece.className = `confetti-piece ${SHAPES[Math.floor(Math.random() * SHAPES.length)]}`;

  // Fall time 2.5–3.5s, staggered entry 0–400ms: a natural, choreographed drop.
  const duration = rand(2.5, 3.5);

  // Every random trait is exposed as a custom property the CSS animates.
  piece.style.setProperty('--x', `${rand(-2, 102).toFixed(2)}%`);
  piece.style.setProperty('--w', `${rand(6, 11).toFixed(1)}px`);
  piece.style.setProperty('--h', `${rand(10, 18).toFixed(1)}px`);
  piece.style.setProperty('--c', PALETTE[Math.floor(Math.random() * PALETTE.length)]);
  piece.style.setProperty('--drift', `${rand(-70, 70).toFixed(0)}px`);
  piece.style.setProperty('--sway', `${rand(6, 20).toFixed(0)}px`);
  piece.style.setProperty('--spin', `${rand(-900, 900).toFixed(0)}deg`);
  piece.style.setProperty('--dur', `${duration.toFixed(2)}s`);
  piece.style.setProperty('--delay', `${rand(0, 0.4).toFixed(2)}s`);

  // Inner flap carries the sway + spin so the outer can own the fall + drift.
  const flap = document.createElement('span');
  flap.className = 'confetti-flap';
  piece.append(flap);
  return piece;
}

/**
 * Celebrate a win. Falls from the top of the viewport, then self-cleans.
 * @param {{count?: number}} [options] — override the piece count (e.g. per tier).
 */
export function launchConfetti({ count } = {}) {
  if (reducedMotion) {
    flashGlow();
    return;
  }

  const layerEl = ensureLayer();
  const mobile = window.matchMedia?.('(max-width: 720px)').matches ?? false;
  // Cap the load: ~120 desktop, ~50 mobile. A caller-supplied count (e.g. a
  // denser burst for a big prize) is scaled down on mobile too, never bypassed.
  const requested = count ?? DESKTOP_CAP;
  const total = mobile
    ? Math.min(MOBILE_CAP, Math.round(requested * 0.45))
    : Math.min(DESKTOP_CAP, requested);

  // Reuse the layer across wins; clear leftovers so rapid wins never pile up.
  layerEl.replaceChildren();

  const frag = document.createDocumentFragment();
  for (let i = 0; i < total; i += 1) frag.append(makePiece());
  layerEl.append(frag);

  // Longest fall is ~3.5s + 0.4s delay; sweep the layer clean just after.
  window.setTimeout(() => {
    if (layerEl.childElementCount) layerEl.replaceChildren();
  }, 4100);
}

/* ============================================================================
   BLAZZER — trade celebration (Stage 3.3)
   A celebration distinct from a win and from a purchase: a full-screen dark
   overlay with a cyan glow, both item sets flying in from the edges toward the
   centre, then bursting softly into a checkmark, over ~2s.

     t = 0.00s  overlay fades in, edge items begin travelling
     t = 0.70s  items meet at centre, soft burst
     t = 0.85s  checkmark pops (spring)
     t = 1.60s  copy settles ("You received N items · value")
     t = 2.05s  overlay begins its exit
     t = 2.35s  everything removed

   Transform/opacity only. Reduced motion: text + fade, no item choreography.
   ========================================================================= */

import { formatCrystals } from './crystals.js';
import { crystalIcon } from './icons.js';

const DURATION_MS = 2350;

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* ------------------------------------------------------------------ sound */

/** Sound hook — deliberately silent until an asset ships. */
export function playTradeSound() {
  if (window.BLAZZER_MUTED === true) return;
  /* Intentionally empty. */
}

/* ------------------------------------------------------------------ state */

let overlay = null;
let timers = [];

function later(ms, fn) {
  timers.push(window.setTimeout(fn, ms));
}

function clearTimers() {
  timers.forEach((id) => window.clearTimeout(id));
  timers = [];
}

/** One travelling badge: a small item chip that flies from an edge to centre. */
function flyer(entry, side, index) {
  const el = document.createElement('span');
  el.className = `trade-fly is-${side}`;
  el.style.setProperty('--i', String(index));
  el.dataset.side = side;
  el.innerHTML = crystalIcon(22);
  return el;
}

/**
 * Play the trade celebration.
 *
 * @param {{items?: object[], total?: number}} [options]
 */
export function celebrateTrade({ items = [], total = 0 } = {}) {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  clearTimers();

  const count = items.length;
  overlay = document.createElement('div');
  overlay.className = 'trade-celebration';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');

  const flyers =
    !reducedMotion && count
      ? Array.from({ length: Math.min(8, count) }, (_, i) =>
          flyer(items[i], i % 2 === 0 ? 'left' : 'right', i)
        )
          .map((el) => el.outerHTML)
          .join('')
      : '';

  overlay.innerHTML =
    '<span class="trade-celebration-glow" aria-hidden="true"></span>' +
    `<span class="trade-celebration-fly" aria-hidden="true">${flyers}</span>` +
    '<span class="trade-celebration-mark" aria-hidden="true">✓</span>' +
    '<p class="trade-celebration-title">Trade complete</p>' +
    `<p class="trade-celebration-sub">You received ${count} item${count === 1 ? '' : 's'}${
      total > 0 ? ` · ${formatCrystals(total)} ◆` : ''
    }</p>`;

  document.body.append(overlay);
  playTradeSound();

  if (reducedMotion) {
    requestAnimationFrame(() => overlay?.classList.add('is-in'));
    later(1400, () => overlay?.classList.add('is-out'));
    later(1700, teardown);
    return;
  }

  requestAnimationFrame(() => overlay?.classList.add('is-in'));
  later(700, () => overlay?.classList.add('is-burst'));
  later(850, () => overlay?.classList.add('is-mark'));
  later(DURATION_MS - 300, () => overlay?.classList.add('is-out'));
  later(DURATION_MS, teardown);
}

function teardown() {
  clearTimers();
  overlay?.remove();
  overlay = null;
}

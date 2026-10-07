/* ============================================================================
   BLAZZER — purchase celebration
   A short (~1.1s) "yes!" moment for a completed purchase. Deliberately smaller
   than the win celebration (js/celebration.js): no confetti, no win banner.

     t = 0.00s  purchase confirmed — card light sweep begins + balance ticks down
     t = 0.10s  ✓ PURCHASED badge pops in (spring)
     t = 0.15s  item clone begins flying to the Inventory tab
     t = 0.75s  clone arrives → Inventory tab pulses + glows
     t = 0.80s  badge begins its exit
     t = 1.10s  badge gone, fly layer removed, timers cleared

   Every layer is transform/opacity only, and everything is torn down on finish.
   Reduced motion honours the brief: badge + balance tick only — no sweep, no
   fly-to-inventory, no tab pulse.
   ========================================================================= */

import { crystalIcon } from './icons.js';
import { isMuted } from './celebration.js';

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* ------------------------------------------------------------------ sound */

/**
 * Sound hook — deliberately silent. Drop an <audio> or WebAudio cue in here
 * when an asset exists; the shared mute flag is already respected. No sound
 * ships with the demo.
 */
export function playPurchaseSound() {
  if (isMuted() || window.BLAZZER_MUTED === true) return;
  /* Intentionally empty. */
}

/* ------------------------------------------------------------ module state */

let badge = null;
let flyLayer = null;
let timers = [];
let settle = null; // the caller's "celebration is over" callback, if it supplied one

function later(ms, fn) {
  timers.push(window.setTimeout(fn, ms));
}

function clearTimers() {
  timers.forEach((id) => window.clearTimeout(id));
  timers = [];
  // A celebration interrupted mid-flight still has to hand control back to its
  // caller, otherwise a caller waiting to close its own panel is left hanging.
  release();
}

/** Hand control back to the caller, exactly once. */
function release() {
  const pending = settle;
  settle = null;
  if (pending) pending();
}

/* -------------------------------------------------------------------- badge */

/** Lazy badge markup: a ✓ mark in a cyan disc beside the label. */
function ensureBadge() {
  if (badge) return badge;
  badge = document.createElement('div');
  badge.className = 'purchase-badge';
  badge.setAttribute('role', 'status');
  badge.setAttribute('aria-live', 'polite');
  badge.hidden = true;
  badge.innerHTML =
    '<span class="purchase-badge-inner">' +
    '<span class="purchase-badge-mark" aria-hidden="true">✓</span>' +
    '<span class="purchase-badge-text">Purchased</span>' +
    '</span>';
  document.body.append(badge);
  return badge;
}

function showBadge() {
  const el = ensureBadge();
  el.hidden = false;
  el.classList.remove('is-in', 'is-out');
  void el.offsetWidth; // replay the spring entry on back-to-back purchases
  el.classList.add('is-in');
}

function hideBadge() {
  const el = badge;
  if (!el || el.hidden) return;
  el.classList.remove('is-in');
  el.classList.add('is-out');
}

/* -------------------------------------------------------------- light sweep */

/** A single soft highlight passes left → right across the purchased item. */
function playSweep(origin) {
  if (!origin) return;
  const sweep = document.createElement('span');
  sweep.className = 'purchase-sweep';
  sweep.setAttribute('aria-hidden', 'true');
  origin.append(sweep);
  later(520, () => sweep.remove());
}

/* ------------------------------------------------------- fly to inventory */

function ensureFlyLayer() {
  if (flyLayer) return flyLayer;
  flyLayer = document.createElement('div');
  flyLayer.className = 'purchase-fly-layer';
  flyLayer.setAttribute('aria-hidden', 'true');
  document.body.append(flyLayer);
  return flyLayer;
}

/**
 * Prefer the item's own art; fall back to the crystal mark. The catalogue modal
 * marks its artwork `.modal-img`, the market modal `.market-media-img` (and
 * hides that <img> outright when the catalogue has no picture), so both are
 * checked — otherwise a marketplace purchase would fly a generic gem instead
 * of the skin the buyer just paid for.
 */
function itemMarkup(origin) {
  const img = origin.querySelector('.modal-img, .market-media-img');
  const src = img?.getAttribute('src');
  const usable = Boolean(img && !img.hidden && src && !origin.classList.contains('is-fallback'));
  if (usable) {
    return `<img class="purchase-fly-img" src="${src}" alt="" />`;
  }
  return `<span class="purchase-fly-gem">${crystalIcon(40)}</span>`;
}

/** Clone the item and arc it into the header's Inventory tab. */
function flyToInventory(origin) {
  const target = document.querySelector('.primary-nav [data-view-target="inventory"]');
  if (!origin || !target) return;

  const from = origin.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const size = Math.max(44, Math.min(from.width, from.height) * 0.5);
  const x0 = from.left + from.width / 2 - size / 2;
  const y0 = from.top + from.height / 2 - size / 2;
  const x1 = to.left + to.width / 2 - size / 2;
  const y1 = to.top + to.height / 2 - size / 2;

  const node = document.createElement('div');
  node.className = 'purchase-fly';
  node.setAttribute('aria-hidden', 'true');
  node.style.left = `${x0}px`;
  node.style.top = `${y0}px`;
  node.style.width = `${size}px`;
  node.style.height = `${size}px`;
  node.style.setProperty('--fly-x', `${x1 - x0}px`);
  node.style.setProperty('--fly-y', `${y1 - y0}px`);

  const arc = document.createElement('div');
  arc.className = 'purchase-fly-arc';
  const inner = document.createElement('div');
  inner.className = 'purchase-fly-inner';
  inner.innerHTML = itemMarkup(origin);
  arc.append(inner);
  node.append(arc);
  ensureFlyLayer().append(node);

  void node.offsetWidth; // lock the initial frame before animating
  node.classList.add('is-flying');
  arc.classList.add('is-flying');
  inner.classList.add('is-flying');

  later(600, () => {
    node.remove();
    pulseTab(target);
  });
}

/** Soft pulse + glow on the destination tab when the item lands. */
function pulseTab(tab) {
  if (!tab) return;
  tab.classList.remove('is-purchase-pulse');
  void tab.offsetWidth;
  tab.classList.add('is-purchase-pulse');
  later(320, () => tab.classList.remove('is-purchase-pulse'));
}

/* ------------------------------------------------------------- public API */

/**
 * Remove every node the celebration created and hand control back to the
 * caller. Shared by both the full-motion and the reduced-motion timelines, so
 * neither can leave an orphan badge or fly layer behind.
 */
function teardown() {
  if (badge) {
    badge.remove();
    badge = null;
  }
  if (flyLayer) {
    flyLayer.remove();
    flyLayer = null;
  }
  release();
}

/**
 * Fire the short purchase celebration. Call at t = 0, right after a purchase
 * is committed (Crystals spent, item added).
 *
 * The sweep is painted INSIDE `origin` and the fly-clone starts from its box,
 * so the caller must keep `origin` visible for the whole ~1.1s. Pass
 * `onSettled` to be told when everything has been torn down — that is the right
 * moment to dismiss the panel the celebration played on.
 *
 * @param {{origin?: Element|null, onSettled?: (() => void)|null}} [options]
 *   origin    — the visible item element the sweep and fly-clone start from
 *               (typically the open modal's media panel).
 *   onSettled — called once, at t = 1.10s, after all nodes and timers are gone.
 *               Also called early if a newer celebration interrupts this one.
 */
export function celebratePurchase({ origin = null, onSettled = null } = {}) {
  clearTimers();
  settle = typeof onSettled === 'function' ? onSettled : null;
  playPurchaseSound();

  if (reducedMotion) {
    showBadge();
    later(800, hideBadge);
    later(1100, teardown);
    return;
  }

  playSweep(origin);
  later(100, showBadge);
  later(150, () => flyToInventory(origin));
  later(800, hideBadge);
  later(1100, teardown); // no orphan nodes, no lingering will-change
}

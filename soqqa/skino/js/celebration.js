/* ============================================================================
   BLAZZER — win celebration
   The "I actually won something" moment, staged on a fixed timeline measured
   from the instant a result lands. Six layers, each independently choreographed:

     t = 0.00s  spin stops (caller) + wheel scale pulse (js/wheel.js)
     t = 0.08s  screen-light bloom pulse #1 (strong)
     t = 0.15s  confetti begins falling
     t = 0.20s  WIN BANNER pops in (spring) + sound hook
     t = 0.25s  balance counter (js/app.js, driven by the balance change)
     t = 0.38s  bloom pulse #2 (echo)
     t = 1.40s  banner exits
     t = 1.80s  banner gone, balance settled, confetti still falling
     t = 3.50s  confetti finished, nodes cleaned up (js/confetti.js)

   Reduced motion honours the brief exactly: banner + balance counter only —
   no confetti, no bloom, no wheel pulse, no sound.
   ========================================================================= */

import { crystalIcon } from './icons.js';
import { launchConfetti } from './confetti.js';
import { formatCrystals } from './crystals.js';

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* ------------------------------------------------------------------ sound */

let muted = false;

export function setMuted(value) {
  muted = Boolean(value);
}

export function isMuted() {
  return muted;
}

/**
 * Sound hook — deliberately silent. Drop an <audio> or WebAudio cue in here
 * when an asset exists; the mute flag (and any global `window.BLAZZER_MUTED`)
 * is already respected so callers never need to check.
 */
export function playWinSound() {
  if (muted || window.BLAZZER_MUTED === true) return;
  /* Intentionally empty: no audio asset ships with the demo. */
}

/* ------------------------------------------------------------------ layers */

let banner = null;
let bloom = null;
let timers = [];

function later(ms, fn) {
  timers.push(window.setTimeout(fn, ms));
}

function clearTimers() {
  timers.forEach((id) => window.clearTimeout(id));
  timers = [];
}

/** Lazy banner markup: YOU WON + animated amount + crystal mark. */
function ensureBanner() {
  if (banner) return banner;
  banner = document.createElement('div');
  banner.className = 'win-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.hidden = true;
  banner.innerHTML =
    '<div class="win-banner-pop">' +
    '<div class="win-banner-float">' +
    '<p class="win-banner-label">You Won</p>' +
    '<p class="win-banner-amount">' +
    '<span class="win-banner-mark"></span>' +
    '<span class="win-banner-value" data-win-value>+0</span>' +
    '</p>' +
    '</div></div>';
  document.body.append(banner);
  return banner;
}

/** Lazy bloom layer: a fixed radial glow blended in screen mode. */
function ensureBloom() {
  if (bloom) return bloom;
  bloom = document.createElement('div');
  bloom.className = 'win-bloom';
  bloom.setAttribute('aria-hidden', 'true');
  document.body.append(bloom);
  return bloom;
}

function bloomPulse(kind) {
  const el = ensureBloom();
  el.classList.remove('is-pulse', 'is-echo');
  void el.offsetWidth; // restart the animation on back-to-back wins
  el.classList.add(kind === 'echo' ? 'is-echo' : 'is-pulse');
}

let hideTimer = 0;
let amountRaf = 0;

/** Tween the headline figure, 0 → `amount`, so the number itself lands. */
function animateAmount(el, amount) {
  window.cancelAnimationFrame(amountRaf);
  if (reducedMotion || !Number.isFinite(amount) || amount <= 0) {
    el.textContent = `+${formatCrystals(amount)}`;
    return;
  }
  const duration = 760;
  const t0 = performance.now();

  function frame(now) {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
    el.textContent = `+${formatCrystals(amount * eased)}`;
    if (p < 1) amountRaf = requestAnimationFrame(frame);
    else el.textContent = `+${formatCrystals(amount)}`;
  }

  el.textContent = '+0';
  amountRaf = requestAnimationFrame(frame);
}

/**
 * @param {{text?: string, amount?: number}} opts
 *   text   — headline override (e.g. a skin name). When present it is shown
 *            verbatim in the smaller non-numeric style.
 *   amount — crystal amount to count up to when no `text` override is given.
 */
function showBanner({ text = '', amount = 0 } = {}) {
  const el = ensureBanner();
  const icon = el.querySelector('.win-banner-mark');
  const value = el.querySelector('[data-win-value]');
  icon.innerHTML = crystalIcon(34);
  value.classList.toggle('is-text', Boolean(text));
  if (text) value.textContent = text;
  else animateAmount(value, amount);

  el.hidden = false;
  el.classList.remove('is-out');
  el.classList.remove('is-in');
  void el.offsetWidth; // replay the spring entry
  el.classList.add('is-in');
}

function hideBanner() {
  const el = banner;
  if (!el || el.hidden) return;
  el.classList.remove('is-in');
  el.classList.add('is-out');
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    el.hidden = true;
    el.classList.remove('is-out');
  }, 420);
}

/* ------------------------------------------------------------- public API */

/**
 * Fire the celebration. Call the moment a result lands (t = 0).
 * @param {{amount?: number, text?: string, big?: boolean}} [options]
 *   amount — crystal amount to headline
 *   text   — override the headline (e.g. a skin name for non-crystal wins)
 *   big    — denser confetti for headline prizes
 */
export function celebrateWin({ amount = 0, text = '', big = false } = {}) {
  clearTimers();

  if (reducedMotion) {
    // Banner + balance counter only: no confetti, no bloom, no sound.
    showBanner({ text, amount });
    later(1400, hideBanner);
    return;
  }

  later(80, () => bloomPulse('pulse'));
  later(150, () => launchConfetti({ count: big ? 120 : 110 }));
  later(200, () => {
    showBanner({ text, amount });
    playWinSound();
  });
  later(380, () => bloomPulse('echo'));
  later(1400, hideBanner);
}

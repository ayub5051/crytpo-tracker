/* ============================================================================
   BLAZZER — Market promo slider
   An auto-rotating advertisement banner for the Market view, built from
   data/promos.js. It replaces the shared hero there and nowhere else.

   Behaviour contract:
     - rotates every 6s; one flex track slides a single clean step (expo-out,
       600ms) so exactly one slide is on screen — no crossfade, no overlap
     - a thin progress bar (transform: scaleX) fills over the same 6s
     - pauses on hover/focus and whenever the slider is off-screen
     - one setInterval drives every countdown; a single rAF drives progress
     - touch swipe, arrow buttons (desktop) and dot navigation
     - prefers-reduced-motion: no autoplay, no slide motion — crossfade + manual
       navigation only
     - every timer, listener and observer is torn down by disposePromoSlider()

   All motion is transform/opacity only.
   ========================================================================= */

import { PROMOS } from '../data/promos.js';
import { getSkinById } from './skins.js';
import { formatCrystals } from './crystals.js';
import { crystalIcon } from './icons.js';
import { openSkinModal } from './skinModal.js';
import { showToast } from './toast.js';

const AUTOPLAY_MS = 6000;
const SLIDE_MS = 600;
const EXPIRED_ADVANCE_MS = 2000;
const SWIPE_MIN = 40;

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* ------------------------------------------------------------------- icons */

const CLOCK_ICON =
  '<svg class="promo-urgency-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.5"/>' +
  '<path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const BOX_ICON =
  '<svg class="promo-urgency-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">' +
  '<path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
  '<path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" stroke="currentColor" stroke-width="1.4"/></svg>';

const ARROW_PREV =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">' +
  '<path d="m14.5 6-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ARROW_NEXT =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">' +
  '<path d="m9.5 6 6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ------------------------------------------------------------------- state */

let els = null;
let slides = [];
let dots = [];
let index = 0;
let paused = false;
let visible = true;
let elapsed = 0;
let lastTs = 0;
let rafId = 0;
let countdownId = 0;
let disposed = false;
let io = null;
let touchX = 0;
let touchY = 0;
let touchActive = false;
let animating = false;
let settleTimer = 0;

const timeouts = [];
const expired = new Set();

function later(ms, fn) {
  const id = window.setTimeout(fn, ms);
  timeouts.push(id);
  return id;
}

function clearTimeouts() {
  timeouts.forEach((id) => window.clearTimeout(id));
  timeouts.length = 0;
}

/* ------------------------------------------------------------- formatting */

/** "12s" / "4m 12s" / "4h 23m 12s" — leading zero units are hidden. */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** The live urgency line: countdown and/or stock, or the static fallback. */
function urgencyMarkup(promo) {
  const parts = [];
  if (promo.endsAt) {
    parts.push(`${CLOCK_ICON}<span data-promo-countdown>Ends in ${formatCountdown(promo.endsAt - Date.now())}</span>`);
  }
  if (promo.stockLeft) {
    const stock = promo.endsAt ? `${promo.stockLeft} left` : promo.urgencyText || `${promo.stockLeft} left at this price`;
    parts.push(`${BOX_ICON}<span data-promo-stock>${stock}</span>`);
  }
  if (!parts.length) parts.push(`${BOX_ICON}<span>${promo.urgencyText || ''}</span>`);
  return parts.join('<span class="promo-urgency-sep" aria-hidden="true">·</span>');
}

function slideMarkup(promo) {
  const skin = getSkinById(promo.skinId);
  const image = skin?.image || '';
  const alt = `${promo.weaponName} | ${promo.skinName}`;
  const visual = image
    ? `<img class="promo-img" src="${image}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    : '<span class="promo-glyph" aria-hidden="true">' + crystalIcon(56) + '</span>';

  return (
    '<span class="promo-rarity-wash" aria-hidden="true"></span>' +
    '<div class="promo-copy">' +
      `<span class="promo-badge" data-promo-badge data-type="${promo.badgeType}">` +
        `<span class="promo-badge-text">${promo.badge}</span>` +
        '<span class="promo-badge-shine" aria-hidden="true"></span>' +
      '</span>' +
      '<h3 class="promo-name">' +
        `<span class="promo-weapon">${promo.weaponName}</span>` +
        '<span class="promo-sep" aria-hidden="true">|</span>' +
        `<span class="promo-finish">${promo.skinName}</span>` +
      '</h3>' +
      '<p class="promo-rarity">' + promo.rarity + '</p>' +
      '<div class="promo-prices">' +
        `<span class="promo-old">${formatCrystals(promo.oldPrice)} ${crystalIcon(15)}</span>` +
        '<span class="promo-price-arrow" aria-hidden="true">→</span>' +
        `<span class="promo-new">${formatCrystals(promo.newPrice)} ${crystalIcon(28)}</span>` +
        `<span class="promo-save">−${promo.discountPercent}%</span>` +
      '</div>' +
      `<p class="promo-urgency" data-promo-urgency>${urgencyMarkup(promo)}</p>` +
      `<button class="promo-cta" type="button" data-promo-cta>${promo.ctaText}</button>` +
    '</div>' +
    '<div class="promo-visual">' +
      '<span class="promo-glow" aria-hidden="true"></span>' +
      `<span class="promo-float">${visual}</span>` +
    '</div>'
  );
}

/* -------------------------------------------------------------------- build */

function build() {
  els.root.innerHTML =
    '<span class="promo-frame" aria-hidden="true"></span>' +
    '<div class="promo-track" data-promo-track></div>' +
    '<div class="promo-progress" aria-hidden="true"><span class="promo-progress-fill" data-promo-fill></span></div>' +
    `<button class="promo-arrow promo-arrow-prev" type="button" data-promo-prev aria-label="Previous deal">${ARROW_PREV}</button>` +
    `<button class="promo-arrow promo-arrow-next" type="button" data-promo-next aria-label="Next deal">${ARROW_NEXT}</button>` +
    '<div class="promo-dots" data-promo-dots role="tablist" aria-label="Choose a deal"></div>';

  els.fill = els.root.querySelector('[data-promo-fill]');
  const track = els.root.querySelector('[data-promo-track]');
  els.track = track;
  const dotWrap = els.root.querySelector('[data-promo-dots]');

  PROMOS.forEach((promo, i) => {
    const slide = document.createElement('article');
    slide.className = 'promo-slide';
    slide.dataset.promoSlide = '';
    slide.style.setProperty('--rarity', promo.rarityColor);
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${i + 1} of ${PROMOS.length}: ${promo.weaponName} | ${promo.skinName}`);
    slide.innerHTML = slideMarkup(promo);

    // Fall back to the crystal glyph if the CDN artwork does not load.
    slide.querySelector('.promo-img')?.addEventListener('error', (event) => {
      const img = event.currentTarget;
      img.closest('.promo-visual')?.classList.add('is-fallback');
      img.remove();
    });

    track.append(slide);

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'promo-dot';
    dot.dataset.promoDot = String(i);
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `Show deal ${i + 1}: ${promo.weaponName} | ${promo.skinName}`);
    dot.innerHTML = '<span class="promo-dot-mark" aria-hidden="true"></span>';
    dotWrap.append(dot);
  });

  slides = [...track.querySelectorAll('.promo-slide')];
  dots = [...dotWrap.querySelectorAll('.promo-dot')];
}

/* --------------------------------------------------------------- navigation */

function setRetint() {
  // Swap the frame colour while it is invisible, then fade the new one in —
  // an opacity animation, never a colour animation.
  els.root.style.setProperty('--promo-rarity', PROMOS[index].rarityColor);
  els.root.classList.remove('is-retint');
  void els.root.offsetWidth;
  els.root.classList.add('is-retint');
}

function commit(target) {
  slides[index]?.classList.remove('is-active');
  slides[target]?.classList.add('is-active');
  index = target;
  elapsed = 0;
  if (els.fill) els.fill.style.transform = 'scaleX(0)';
  setRetint();
  syncDots();
  handleExpired(index);
}

/** Safety net for the rare case transitionend never fires (track unrendered). */
function armSettle() {
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    animating = false;
    settleTimer = 0;
  }, SLIDE_MS + 80);
}

/** Slide exactly one step by translating the whole track. */
function moveTo(target) {
  commit(target);
  const track = els.track;
  if (!track || reducedMotion) return;
  animating = true;
  armSettle();
  track.style.transform = `translateX(-${target * 100}%)`;
}

/** Snap to a target with no animation — used for wraps and multi-step jumps. */
function jumpTo(target) {
  commit(target);
  const track = els.track;
  animating = false;
  window.clearTimeout(settleTimer);
  settleTimer = 0;
  if (!track) return;
  // Disable the transition for one frame so the jump is invisible, then hand
  // the transform back to CSS for the next real step.
  track.style.transition = 'none';
  track.style.transform = `translateX(-${target * 100}%)`;
  void track.offsetWidth;
  track.style.transition = '';
}

function go(next, opts = {}) {
  if (disposed || slides.length === 0) return;
  const count = slides.length;
  const target = ((next % count) + count) % count;
  if (target === index) return;

  // A single step slides; a wrap (last ↔ first) or a multi-step jump snaps
  // straight to the target so two slides are never mid-motion at the same time.
  if (!opts.instant && Math.abs(target - index) === 1) moveTo(target);
  else jumpTo(target);
}

function onTransitionEnd(event) {
  if (!els || event.target !== els.track || event.propertyName !== 'transform') return;
  animating = false;
  window.clearTimeout(settleTimer);
  settleTimer = 0;
}

function syncDots() {
  dots.forEach((dot, i) => {
    const active = i === index;
    dot.classList.toggle('is-active', active);
    dot.setAttribute('aria-selected', String(active));
  });
}

/* ------------------------------------------------------------- autoplay */

function loop(ts) {
  if (disposed) return;
  rafId = requestAnimationFrame(loop);
  if (!lastTs) lastTs = ts;
  // Cap the step so a background tab never fast-forwards the rotation.
  const step = Math.min(100, ts - lastTs);
  lastTs = ts;
  // Pause when reduced-motion, hovered/focused, off-screen, or tab hidden.
  if (reducedMotion || paused || !visible || document.hidden) return;

  elapsed += step;
  const progress = Math.min(1, elapsed / AUTOPLAY_MS);
  if (els.fill) els.fill.style.transform = `scaleX(${progress})`;
  if (elapsed >= AUTOPLAY_MS && !animating) go(index + 1);
}

function pause() {
  paused = true;
}

function resume() {
  paused = false;
  lastTs = 0;
}

/* -------------------------------------------------------------- countdown */

/** If the slide we just landed on has already expired, restyle it and move on. */
function handleExpired(i) {
  if (!expired.has(i)) return;
  const slide = slides[i];
  if (slide) {
    const badge = slide.querySelector('[data-promo-badge]');
    if (badge) {
      badge.dataset.type = 'expired';
      const text = badge.querySelector('.promo-badge-text');
      if (text) text.textContent = 'EXPIRED';
    }
    slide.classList.add('is-expired');
  }
  // Only advance if the user has not moved on in the meantime.
  later(EXPIRED_ADVANCE_MS, () => {
    if (index === i) go(i + 1);
  });
}

/** The single interval that keeps every countdown honest. */
function tickCountdown() {
  if (disposed) return;
  const now = Date.now();
  PROMOS.forEach((promo, i) => {
    if (!promo.endsAt) return;
    const slide = slides[i];
    if (!slide) return;
    const left = promo.endsAt - now;

    if (left <= 0) {
      if (!expired.has(i)) {
        expired.add(i);
        const badge = slide.querySelector('[data-promo-badge]');
        if (badge) {
          badge.dataset.type = 'expired';
          const text = badge.querySelector('.promo-badge-text');
          if (text) text.textContent = 'EXPIRED';
        }
        const line = slide.querySelector('[data-promo-urgency]');
        if (line) line.innerHTML = `${CLOCK_ICON}<span>This deal has ended</span>`;
        slide.classList.add('is-expired');
        if (i === index) {
          later(EXPIRED_ADVANCE_MS, () => {
            if (index === i) go(i + 1);
          });
        }
      }
      return;
    }

    const node = slide.querySelector('[data-promo-countdown]');
    if (node) node.textContent = `Ends in ${formatCountdown(left)}`;
  });
}

/* ------------------------------------------------------------------ events */

function onKeydown(event) {
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    go(index - 1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    go(index + 1);
  }
}

function onClick(event) {
  if (event.target.closest('[data-promo-prev]')) return go(index - 1);
  if (event.target.closest('[data-promo-next]')) return go(index + 1);

  const dot = event.target.closest('[data-promo-dot]');
  if (dot) return go(Number(dot.dataset.promoDot));

  const cta = event.target.closest('[data-promo-cta]');
  if (cta) {
    const slide = cta.closest('.promo-slide');
    const promo = PROMOS[slides.indexOf(slide)];
    return openDeal(promo);
  }
  return undefined;
}

function openDeal(promo) {
  if (!promo) return;
  const skin = getSkinById(promo.skinId);
  if (skin) openSkinModal(skin);
  else showToast('That deal is no longer available', 'error');
}

function onPointerEnter(event) {
  if (event.pointerType === 'touch') return;
  pause();
}

function onPointerLeave(event) {
  if (event.pointerType === 'touch') return;
  resume();
}

function onFocusIn() {
  pause();
}

function onFocusOut(event) {
  if (!els.root.contains(event.relatedTarget)) resume();
}

function onTouchStart(event) {
  const touch = event.changedTouches[0];
  touchX = touch.clientX;
  touchY = touch.clientY;
  touchActive = true;
}

function onTouchEnd(event) {
  if (!touchActive) return;
  touchActive = false;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchX;
  const dy = touch.clientY - touchY;
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy)) return;
  go(dx < 0 ? index + 1 : index - 1);
}

function onVisibility() {
  visible = !document.hidden;
  if (visible) lastTs = 0;
}

/* --------------------------------------------------------------- lifecycle */

function wire() {
  els.root.addEventListener('click', onClick);
  els.root.addEventListener('keydown', onKeydown);
  els.root.addEventListener('pointerenter', onPointerEnter);
  els.root.addEventListener('pointerleave', onPointerLeave);
  els.root.addEventListener('focusin', onFocusIn);
  els.root.addEventListener('focusout', onFocusOut);
  els.root.addEventListener('touchstart', onTouchStart, { passive: true });
  els.root.addEventListener('touchend', onTouchEnd, { passive: true });
  els.track?.addEventListener('transitionend', onTransitionEnd);
  document.addEventListener('visibilitychange', onVisibility);

  // Pause whenever the slider is not actually on screen (hidden Market view,
  // scrolled away, or a background tab).
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible) lastTs = 0;
      },
      { threshold: 0.01 }
    );
    io.observe(els.root);
  }
}

export function initPromoSlider() {
  const root = document.querySelector('[data-promo-slider]');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  els = { root, fill: null, track: null };
  disposed = false;

  build();
  wire();

  // First slide is shown without an entrance so nothing flashes on paint.
  slides[0]?.classList.add('is-active');
  els.root.style.setProperty('--promo-rarity', PROMOS[0].rarityColor);
  syncDots();
  tickCountdown();

  // Countdowns keep ticking in every mode (live text, not motion)…
  countdownId = window.setInterval(tickCountdown, 1000);
  // …but autoplay/progress only when motion is welcome.
  if (!reducedMotion) rafId = requestAnimationFrame(loop);

  window.addEventListener('pagehide', disposePromoSlider, { once: true });
}

/** Tear everything down. Idempotent. */
export function disposePromoSlider() {
  if (disposed) return;
  disposed = true;
  window.cancelAnimationFrame(rafId);
  window.clearInterval(countdownId);
  window.clearTimeout(settleTimer);
  clearTimeouts();
  rafId = 0;
  countdownId = 0;
  settleTimer = 0;
  animating = false;
  io?.disconnect();
  io = null;

  const root = els?.root;
  if (root) {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeydown);
    root.removeEventListener('pointerenter', onPointerEnter);
    root.removeEventListener('pointerleave', onPointerLeave);
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('focusout', onFocusOut);
    root.removeEventListener('touchstart', onTouchStart);
    root.removeEventListener('touchend', onTouchEnd);
  }
  els?.track?.removeEventListener('transitionend', onTransitionEnd);
  document.removeEventListener('visibilitychange', onVisibility);
}

export { PROMOS };

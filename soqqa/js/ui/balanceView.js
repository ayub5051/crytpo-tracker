/* ============================================================================
   SOQQA — demo balance display
   Owns the header balance chip: count-up animation, instant updates and a
   win/loss flash. Pure presentation — the store is the source of truth.
   ========================================================================= */

import { ANIMATION } from '../config.js';
import { formatCoins } from './format.js';

/**
 * @param {{ valueEl: HTMLElement|null, chipEl?: HTMLElement|null }} refs
 */
export function createBalanceView({ valueEl, chipEl = null } = {}) {
  let displayed = 0;
  let frame = 0;
  let flashTimer = 0;

  const reducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function paint(value) {
    displayed = value;
    if (valueEl) {
      valueEl.textContent = formatCoins(value);
      valueEl.dataset.balance = String(value);
    }
  }

  function animateTo(target) {
    if (typeof requestAnimationFrame !== 'function' || reducedMotion()) {
      paint(target);
      return;
    }

    const from = displayed;
    const delta = target - from;
    if (delta === 0) {
      paint(target);
      return;
    }

    const start = performance.now();
    const duration = ANIMATION.balanceCountUp;
    if (frame) cancelAnimationFrame(frame);

    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - (1 - progress) ** 3;
      paint(Math.round(from + delta * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      } else {
        frame = 0;
        paint(target);
      }
    };

    frame = requestAnimationFrame(step);
  }

  return {
    /** Paint without animation (initial render, route changes). */
    render(value) {
      paint(Math.round(Number(value) || 0));
    },

    /**
     * React to a store notification.
     * @param {number} value — new balance
     * @param {{ animate?: boolean }} [options]
     */
    update(value, { animate = true } = {}) {
      const target = Math.round(Number(value) || 0);
      if (animate) animateTo(target);
      else paint(target);
    },

    /** Brief green/red glow on the chip. */
    flash(kind) {
      if (!chipEl || !kind) return;
      chipEl.classList.remove('is-win', 'is-lose');
      // Force a restart so back-to-back flashes are visible.
      void chipEl.offsetWidth;
      chipEl.classList.add(kind === 'win' ? 'is-win' : 'is-lose');

      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => chipEl.classList.remove('is-win', 'is-lose'), 900);
    },

    get value() {
      return displayed;
    },
  };
}

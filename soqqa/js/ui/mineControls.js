/* ============================================================================
   SOQQA — mine-count controls
   ----------------------------------------------------------------------------
   The mines cabinet's second selector: how many of the 25 tiles are mines. It
   is the same shape of thing as the bet stepper (js/ui/betControls.js) — a −/+
   pair plus quick chips — but with none of the bet ladder's affordability
   logic, because a mine count costs nothing and is only bounded by the board.

   Kept in its own module for the same reason the bet controls are: the view
   controller should be wiring, not widget behaviour. Both selectors lock with
   one call while a round is running, which is what makes "the settings cannot
   be changed mid-round" a property of the widget rather than a rule the view
   has to remember to enforce.

   Every control is looked up by data attribute inside the view's own root, so
   the mines cabinet and the slots cabinet can each own a `[data-bet-value]`
   without ever seeing each other's.
   ========================================================================= */

import { COPY, MINES } from '../config.js';

/**
 * @param {HTMLElement|null} root — the mines view section
 * @param {{
 *   min?: number,
 *   max?: number,
 *   initial?: number,
 *   onChange?: (count: number) => void,
 * }} [options]
 */
export function createMineControls(root, { min = MINES.minCount, max = MINES.maxCount, initial = MINES.defaultCount, onChange } = {}) {
  if (!root) {
    return { getCount: () => initial, setCount: () => initial, lock: () => {}, refresh: () => {}, isLocked: () => false };
  }

  const valueEl = root.querySelector('[data-mines-count]');
  const stepButtons = Array.from(root.querySelectorAll('[data-mines-count-step]'));
  const quickButtons = Array.from(root.querySelectorAll('[data-mines-count-quick]'));

  const low = Math.max(1, Math.trunc(Number(min) || MINES.minCount));
  const high = Math.max(low, Math.trunc(Number(max) || MINES.maxCount));

  const clamp = (value) => Math.min(high, Math.max(low, Math.trunc(Number(value) || low)));

  let count = clamp(initial);
  let locked = false;

  function paint() {
    if (valueEl) {
      valueEl.textContent = String(count);
      // An `<output>` is announced through its own accessible name, so the
      // reading is spelled out rather than left as a bare digit between two
      // −/+ buttons. (`aria-valuenow` belongs to a range ROLE, which an output
      // is not, so it would be ignored at best.)
      valueEl.setAttribute('aria-label', `${COPY.minesCountLabel}: ${count}`);
    }

    stepButtons.forEach((button) => {
      const direction = Number(button.dataset.minesCountStep) >= 0 ? 1 : -1;
      const next = count + direction;
      button.disabled = locked || next < low || next > high;
    });

    quickButtons.forEach((button) => {
      const amount = clamp(button.dataset.minesCountQuick);
      button.classList.toggle('is-active', amount === count);
      button.disabled = locked;
    });
  }

  function commit(next, { notify = true } = {}) {
    const clamped = clamp(next);
    if (clamped === count) return count;
    count = clamped;
    paint();
    if (notify && typeof onChange === 'function') onChange(count);
    return count;
  }

  stepButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (locked) return;
      commit(count + (Number(button.dataset.minesCountStep) >= 0 ? 1 : -1));
    });
  });

  quickButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (locked) return;
      commit(button.dataset.minesCountQuick);
    });
  });

  paint();

  return {
    getCount: () => count,

    setCount(next, { notify = false } = {}) {
      return commit(next, { notify });
    },

    /** Enable/disable every mine-count control (used while a round runs). */
    lock(state) {
      locked = Boolean(state);
      paint();
    },

    refresh: paint,
    isLocked: () => locked,
    bounds: { min: low, max: high },
    elements: { valueEl, stepButtons, quickButtons },
  };
}

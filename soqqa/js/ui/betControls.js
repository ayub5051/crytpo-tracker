/* ============================================================================
   SOQQA — bet controls
   Drives the +/− stepper and the quick-bet chips inside one game view.
   Scoped to a root element so every game wires its own controls independently.

   Guarantees:
     • the bet is always a valid amount (multiple of MIN_BET inside the ladder)
     • the bet can never exceed the current balance
     • controls lock while a spin animation runs
   ========================================================================= */

import { BET_LADDER, DEFAULT_BET, MAX_BET, MIN_BET } from '../config.js';
import { formatCoins } from './format.js';

/**
 * @param {HTMLElement|null} root — the game view / cabinet element
 * @param {{
 *   canAfford: (bet: number) => boolean,
 *   initialBet?: number,
 *   onChange?: (bet: number) => void,
 * }} options
 */
export function createBetControls(root, { canAfford, initialBet = DEFAULT_BET, onChange } = {}) {
  if (!root) {
    return {
      getBet: () => DEFAULT_BET,
      setBet: () => DEFAULT_BET,
      lock: () => {},
      refresh: () => {},
    };
  }

  const valueEl = root.querySelector('[data-bet-value]');
  const stepButtons = Array.from(root.querySelectorAll('[data-bet-step]'));
  const quickButtons = Array.from(root.querySelectorAll('[data-bet-quick]'));
  const hintEl = root.querySelector('[data-bet-hint]');

  let bet = resolveStartBet(initialBet);
  let locked = false;

  const afford = (value) => (typeof canAfford === 'function' ? canAfford(value) : true);

  function resolveStartBet(candidate) {
    const value = Number(candidate);
    if (BET_LADDER.includes(value)) return value;
    return DEFAULT_BET;
  }

  /** Nearest affordable ladder amount (falls back to MIN_BET). */
  function affordableBet(preferred) {
    if (afford(preferred)) return preferred;
    const step = preferred > bet ? -1 : 1;
    const index = BET_LADDER.indexOf(preferred);
    if (index >= 0) {
      for (let i = index + step; i >= 0 && i < BET_LADDER.length; i += step) {
        if (afford(BET_LADDER[i])) return BET_LADDER[i];
      }
    }
    return afford(MIN_BET) ? MIN_BET : MIN_BET;
  }

  function paint() {
    if (valueEl) valueEl.textContent = formatCoins(bet);

    const index = BET_LADDER.indexOf(bet);
    stepButtons.forEach((button) => {
      const direction = Number(button.dataset.betStep) >= 0 ? 1 : -1;
      const next = BET_LADDER[index + direction];
      button.disabled = locked || next === undefined || !afford(next);
    });

    quickButtons.forEach((button) => {
      const amount = Number(button.dataset.betQuick);
      button.classList.toggle('is-active', amount === bet);
      button.disabled = locked || !afford(amount);
    });

    if (hintEl) {
      const remaining = !afford(bet);
      hintEl.hidden = !remaining;
      if (remaining) {
        hintEl.textContent = `Bu tikish uchun mablag\u2019 yetarli emas \u2014 balans: ${formatCoins(
          bet,
        )} soqqadan kam.`;
      }
    }
  }

  function commit(next, { notify = true } = {}) {
    const clamped = Math.min(MAX_BET, Math.max(MIN_BET, Math.round(next / MIN_BET) * MIN_BET));
    if (clamped === bet) return bet;
    bet = clamped;
    paint();
    if (notify && typeof onChange === 'function') onChange(bet);
    return bet;
  }

  stepButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (locked) return;
      const direction = Number(button.dataset.betStep) >= 0 ? 1 : -1;
      const index = BET_LADDER.indexOf(bet);
      const next = BET_LADDER[index + direction];
      if (next === undefined || !afford(next)) return;
      commit(next);
    });
  });

  quickButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (locked) return;
      const amount = Number(button.dataset.betQuick);
      if (!afford(amount)) return;
      commit(amount);
    });
  });

  // Start on an affordable amount (e.g. a restored lastBet above the balance).
  if (!afford(bet)) bet = affordableBet(bet);
  paint();

  return {
    getBet: () => bet,

    setBet(next, { notify = false } = {}) {
      return commit(next, { notify });
    },

    /** Enable/disable every bet control (used while spinning). */
    lock(state) {
      locked = Boolean(state);
      paint();
    },

    /** Re-evaluate affordability, e.g. after the balance changed. */
    refresh() {
      if (!afford(bet)) bet = affordableBet(bet);
      paint();
    },

    isLocked: () => locked,
    elements: { valueEl, stepButtons, quickButtons, hintEl },
  };
}

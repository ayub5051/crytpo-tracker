/* ============================================================================
   SOQQA — Omad charxi view controller
   ----------------------------------------------------------------------------
   The only place where the store, the wheel engine, the disc and the result
   modal meet. Same spine as the slots cabinet (see PLAN.md §6.4):

     1. guard: already spinning? → ignore (duplicate-spin protection)
     2. validate the bet against the balance → otherwise explain + abort
     3. deduct the bet (the balance updates immediately)
     4. ask the engine for a result — segment AND landing angle
     5. animate the disc (controls stay locked the whole time)
     6. credit the payout, record history + lifetime stats
     7. show the Uzbek result message + the win/loss overlay
     8. unlock the controls in a finally path — always, even on failure
   ========================================================================= */

import {
  COPY,
  DEFAULT_BET,
  WHEEL_BIG_WIN_MULTIPLIER,
  WHEEL_JACKPOT_MULTIPLIER,
  WHEEL_LEGEND_NOTES,
} from '../config.js';
import { createWheelEngine, wheelLegend } from '../games/wheel.js';
import { createBetControls } from '../ui/betControls.js';
import { formatCoins, formatMultiplier, formatPercent } from '../ui/format.js';
import { createWheelDisc } from '../ui/wheelDisc.js';
import { createRng } from '../utils/rng.js';

/**
 * @param {{
 *   store: object,
 *   root: HTMLElement|null,
 *   balanceView: object,
 *   toaster: object,
 *   resultModal?: object,
 *   rng?: object,
 *   spinDuration?: number,
 * }} options
 */
export function createWheelView({
  store,
  root,
  balanceView,
  toaster,
  resultModal = null,
  rng = createRng(),
  spinDuration,
} = {}) {
  if (!root || !store) {
    return { init: () => {}, refresh: () => {}, handleSpin: () => {}, isSpinning: false };
  }

  const engine = createWheelEngine({ rng });
  const discView = createWheelDisc(root, spinDuration === undefined ? {} : { durationMs: spinDuration });

  const spinner = root.querySelector('[data-wheel-spin]');
  const summaryEl = root.querySelector('[data-wheel-summary]');
  const legendList = root.querySelector('[data-wheel-legend]');

  let spinning = false;

  /* --- bet controls ------------------------------------------------------ */

  const betControls = createBetControls(root, {
    canAfford: (bet) => store.canAfford(bet),
    initialBet: store.getSettings?.().lastBet ?? DEFAULT_BET,
    onChange: (bet) => store.setLastBet(bet),
  });

  /* --- legend (rendered from config — never hand-written) ---------------- */

  function renderLegend() {
    if (!legendList) return;
    legendList.textContent = '';

    wheelLegend().forEach((row) => {
      const item = document.createElement('li');
      item.className = 'legend__item';

      const multiplier = document.createElement('span');
      multiplier.className = 'legend__mult';
      if (row.multiplier === 0) multiplier.classList.add('legend__mult--zero');
      if (row.multiplier >= WHEEL_BIG_WIN_MULTIPLIER) multiplier.classList.add('legend__mult--jackpot');
      multiplier.textContent = formatMultiplier(row.multiplier);

      const text = document.createElement('span');
      text.className = 'legend__note';
      text.textContent = WHEEL_LEGEND_NOTES[String(row.multiplier)] ?? '';

      // The wheel is weighted, so the real odds are printed next to the label.
      const odds = document.createElement('span');
      odds.className = 'legend__odds';
      odds.textContent = formatPercent(row.odds);

      item.append(multiplier, text, odds);
      legendList.append(item);
    });
  }

  /* --- feedback ---------------------------------------------------------- */

  function setMessage(text, kind = null) {
    if (!summaryEl) return;
    summaryEl.textContent = text;
    summaryEl.classList.remove('is-win', 'is-lose');
    if (kind) summaryEl.classList.add(kind);
  }

  function lock(state) {
    spinning = Boolean(state);
    betControls.lock(spinning);
    root.classList.toggle('is-locked', spinning);
    if (spinner) spinner.disabled = spinning || !store.canAfford(betControls.getBet());
  }

  function refundBet(bet, reason) {
    store.credit(bet);
    setMessage(COPY.spinFailed, 'is-lose');
    toaster.show(COPY.spinFailed, { kind: 'error' });
    if (typeof console !== 'undefined') console.error(`[SOQQA] ${reason}`);
  }

  function announceResult(result, bet) {
    if (result.outcome === 'win') {
      const isBig = result.multiplier >= WHEEL_BIG_WIN_MULTIPLIER;
      setMessage(
        isBig
          ? COPY.bigWin(result.multiplier, formatCoins(result.payout))
          : COPY.win(result.multiplier, formatCoins(result.payout)),
        'is-win',
      );
      balanceView?.flash?.('win');
    } else {
      setMessage(COPY.loss(formatCoins(bet)), 'is-lose');
      balanceView?.flash?.('lose');
    }

    if (!store.hasEnoughForMinBet()) {
      toaster.show(COPY.balanceEmpty, { kind: 'warning', duration: 6000 });
    }
  }

  /* --- the spin ---------------------------------------------------------- */

  async function handleSpin() {
    if (spinning) return; // 1. duplicate-spin protection

    const bet = betControls.getBet();

    // 2. validity + affordability
    if (!store.isValidBet(bet)) {
      toaster.show(COPY.invalidBet, { kind: 'warning' });
      setMessage(COPY.invalidBet, 'is-lose');
      return;
    }
    if (!store.canAfford(bet)) {
      const message = COPY.insufficient(formatCoins(bet), formatCoins(store.getBalance()));
      toaster.show(message, { kind: 'warning' });
      setMessage(message, 'is-lose');
      return;
    }

    // 3. deduct first — the store refuses anything that would go negative
    const placed = store.placeBet(bet);
    if (!placed.ok) {
      setMessage(COPY.insufficient(formatCoins(bet), formatCoins(store.getBalance())), 'is-lose');
      return;
    }

    lock(true);
    setMessage(COPY.wheelSpinning);

    let result = null;

    try {
      // 4. result first, animation second — the pointer always matches the payout
      result = engine.spin(bet);

      // 5. rotate the disc to the pre-decided segment
      await discView.spin(result);
      discView.highlight(result);
    } catch (error) {
      refundBet(bet, 'wheel spin failed');
      if (typeof console !== 'undefined') console.error(error);
      lock(false);
      return;
    }

    try {
      // 6. credit + persist (store methods never throw)
      if (result.payout > 0) store.credit(result.payout);
      store.recordSpin({
        game: 'wheel',
        bet,
        segmentIndex: result.segmentIndex,
        multiplier: result.multiplier,
        payout: result.payout,
      });

      // 7. inline feedback, then the overlay
      announceResult(result, bet);
      try {
        resultModal?.show?.({
          outcome: result.outcome,
          game: 'wheel',
          multiplier: result.multiplier,
          payout: result.payout,
          bet,
          balance: store.getBalance(),
          segmentIndex: result.segmentIndex,
          // Every paying stop celebrates, exactly like the slots — the burst is
          // simply scaled by the multiplier. The tier keys are passed
          // explicitly so a ×3 win cannot be promoted to a "big" one just
          // because it celebrates.
          celebrate: true,
          bigWin: result.multiplier >= WHEEL_BIG_WIN_MULTIPLIER,
          jackpot: result.multiplier >= WHEEL_JACKPOT_MULTIPLIER,
          onReplay: () => {
            handleSpin();
          },
        });
      } catch (error) {
        // A broken overlay must never break the game.
        if (typeof console !== 'undefined') console.error('[SOQQA] result modal failed', error);
      }
    } finally {
      // 8. always unlock — a broken listener must never freeze the disc
      lock(false);
      betControls.refresh();
    }
  }

  /* --- wiring ------------------------------------------------------------ */

  function syncAvailability() {
    if (spinner) spinner.disabled = spinning || !store.canAfford(betControls.getBet());
    betControls.refresh();
  }

  function init() {
    renderLegend();
    discView.render();
    setMessage(COPY.wheelIdle);

    spinner?.addEventListener('click', handleSpin);

    // Keyboard: Enter/Space spins when focus is inside the cabinet but not on a
    // button (buttons already fire a native click).
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      // Buttons fire a native click already; text fields keep their own keys.
      const tag = event.target?.tagName;
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA') return;
      event.preventDefault();
      handleSpin();
    });

    store.subscribe((state, event) => {
      syncAvailability();
      if (event?.type === 'reset') betControls.setBet(state.settings.lastBet, { notify: false });
    });

    syncAvailability();
  }

  return {
    init,
    refresh: syncAvailability,
    handleSpin,
    get isSpinning() {
      return spinning;
    },
    elements: { spinner, summaryEl, betControls, discView, legendList },
  };
}

/* ============================================================================
   SOQQA — slots view controller
   ----------------------------------------------------------------------------
   The only place where the store, the engine and the UI modules meet.

   Spin flow (see PLAN.md §6.4):
     1. guard: already spinning? → ignore (duplicate-spin protection)
     2. validate the bet against the balance → otherwise explain + abort
     3. deduct the bet (the balance updates immediately)
     4. ask the engine for a result (decided before the animation runs)
     5. animate the reels (controls stay locked the whole time)
     6. credit the payout, record history + lifetime stats
     7. show the Uzbek result message, the win overlay and the celebration
     8. unlock the controls in a finally path — always, even on failure

   A losing spin is deliberately quiet: the drums settle, the inline message
   says so and nothing else fires.
   ========================================================================= */

import { BIG_WIN_MULTIPLIER, COPY, DEFAULT_BET, JACKPOT_MULTIPLIER, SYMBOLS } from '../config.js';
import { createSlotsEngine } from '../games/slots.js';
import { paytableRows } from '../games/paytable.js';
import { createBetControls } from '../ui/betControls.js';
import { createConfetti } from '../ui/confetti.js';
import { formatCoins, formatMultiplier } from '../ui/format.js';
import { createReelView } from '../ui/reelView.js';
import { celebrationFor } from '../ui/resultModal.js';
import { symbolSvgMarkup } from '../ui/symbolArt.js';
import { createRng } from '../utils/rng.js';

/**
 * @param {{
 *   store: object,
 *   root: HTMLElement|null,
 *   balanceView: object,
 *   toaster: object,
 *   confetti?: object,
 *   resultModal?: object,
 *   rng?: object,
 * }} options
 */
export function createSlotsView({
  store,
  root,
  balanceView,
  toaster,
  confetti,
  resultModal = null,
  rng = createRng(),
} = {}) {
  if (!root) {
    return { init: () => {}, refresh: () => {}, handleSpin: () => {}, isSpinning: false };
  }

  const engine = createSlotsEngine({ rng });
  const reelView = createReelView(root, { rng });
  const confettiFx = confetti ?? createConfetti();

  const spinner = root.querySelector('[data-spin-button]');
  const summaryEl = root.querySelector('[data-reel-summary]');
  const paytableList = root.querySelector('[data-paytable-list]');

  let spinning = false;

  /* --- bet controls ------------------------------------------------------ */

  const betControls = createBetControls(root, {
    canAfford: (bet) => store.canAfford(bet),
    initialBet: store.getSettings?.().lastBet ?? DEFAULT_BET,
    onChange: (bet) => store.setLastBet(bet),
  });

  /* --- payout table (rendered from config — never hand-written) ---------- */

  function renderPaytable() {
    if (!paytableList) return;
    paytableList.textContent = '';

    paytableRows().forEach((row) => {
      const item = document.createElement('li');
      item.className = 'paytable__row';

      // The same vector art the drums use, from the sprite in index.html.
      const symbol = document.createElement('span');
      symbol.className = 'paytable__symbol';
      symbol.innerHTML = symbolSvgMarkup(row.id, 'paytable__symbol-art');

      const name = document.createElement('span');
      name.className = 'paytable__name';
      name.textContent = row.name;

      const triple = document.createElement('span');
      triple.className = 'paytable__mult';
      triple.textContent = formatMultiplier(row.triple);

      const pair = document.createElement('span');
      pair.className = 'paytable__mult paytable__mult--pair';
      pair.textContent = row.pair > 0 ? formatMultiplier(row.pair) : '—';

      item.append(symbol, name, triple, pair);
      paytableList.append(item);
    });
  }

  /* --- feedback ---------------------------------------------------------- */

  function setMessage(text, kind = null) {
    if (!summaryEl) return;
    summaryEl.textContent = text;
    summaryEl.classList.remove('is-win', 'is-lose');
    if (kind) summaryEl.classList.add(kind);
  }

  /**
   * Lock the cabinet for the whole reel sequence: bet stepper, quick-bet chips
   * and the spin button at once, plus an `aria-busy` flag so assistive tech is
   * told the cabinet is working rather than simply unresponsive.
   */
  function lock(state) {
    spinning = Boolean(state);
    betControls.lock(spinning);
    root.classList.toggle('is-locked', spinning);
    root.setAttribute('aria-busy', String(spinning));
    if (spinner) spinner.disabled = spinning || !store.canAfford(betControls.getBet());
  }

  function refundBet(bet, reason) {
    store.credit(bet);
    setMessage(COPY.spinFailed, 'is-lose');
    toaster.show(COPY.spinFailed, { kind: 'error' });
    if (typeof console !== 'undefined') console.error(`[SOQQA] ${reason}`);
  }

  /** The names of the symbols that actually landed on the payline, for the
      overlay's "Belgilar" row. */
  function lineLabel(result) {
    return result.symbols.map((id) => SYMBOLS[id]?.name ?? id).join(' · ');
  }

  /**
   * Every paying spin gets the full celebration, fired the moment the last drum
   * seats: the confetti burst, the banner overlaying the cabinet, and the
   * lighting the reel view already put on the winning cells. A losing spin fires
   * none of it.
   */
  function announceResult(result, bet) {
    if (result.outcome === 'win') {
      const isBig = result.multiplier >= BIG_WIN_MULTIPLIER;
      const tier = { multiplier: result.multiplier, big: isBig, jackpot: result.multiplier >= JACKPOT_MULTIPLIER };

      setMessage(
        isBig
          ? COPY.bigWin(result.multiplier, formatCoins(result.payout))
          : COPY.win(result.multiplier, formatCoins(result.payout)),
        'is-win',
      );
      balanceView?.flash?.('win');

      // The overlay owns the burst, so the two can never double up. A null
      // return means there is no overlay available (headless, or a broken
      // one) — then the cabinet celebrates on its own.
      let shown = null;
      try {
        shown = resultModal?.show?.({
          outcome: 'win',
          game: 'slots',
          multiplier: result.multiplier,
          payout: result.payout,
          bet,
          balance: store.getBalance(),
          celebrate: true,
          bigWin: tier.big,
          jackpot: tier.jackpot,
          factLabel: COPY.modalSymbolsLabel,
          factValue: lineLabel(result),
          onReplay: () => {
            handleSpin();
          },
        });
      } catch (error) {
        // A broken overlay must never break the game.
        if (typeof console !== 'undefined') console.error('[SOQQA] result modal failed', error);
      }

      if (!shown) confettiFx.celebrate(celebrationFor(tier));
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
    // 1. Duplicate-spin protection. `spinning` is set synchronously by lock()
    // before the first await, so a rapid double-click, an Enter keypress or a
    // click landing during the lock flash can never start a second turn.
    if (spinning) return;

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
    setMessage(COPY.spinning);

    let result = null;

    try {
      // 4. result first, animation second — visuals always match the maths
      result = engine.spin(bet);

      // 5. animate the reels
      await reelView.spin(result);
    } catch (error) {
      refundBet(bet, 'spin failed');
      if (typeof console !== 'undefined') console.error(error);
      lock(false);
      return;
    }

    try {
      // 6. credit + persist (store methods never throw)
      if (result.payout > 0) store.credit(result.payout);
      store.recordSpin({
        game: 'slots',
        bet,
        symbols: result.symbols,
        line: result.line,
        matchType: result.matchType,
        multiplier: result.multiplier,
        payout: result.payout,
      });

      // 7. feedback
      announceResult(result, bet);
    } finally {
      // 8. always unlock — a broken listener must never freeze the cabinet
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
    renderPaytable();
    // The drums build their symbol strips themselves at construction time and
    // then never change their contents — see js/ui/reelView.js.
    setMessage(COPY.idle);

    spinner?.addEventListener('click', handleSpin);

    // Keyboard: Enter/Space spins when focus is inside the cabinet but not on a
    // button (buttons already fire a native click).
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === 'BUTTON' || target.matches('input, textarea'))) {
        return;
      }
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
    elements: { spinner, summaryEl, betControls },
    /** The drum inspector — used by the cabinet's own tests. */
    reels: reelView,
  };
}

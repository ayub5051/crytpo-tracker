/* ============================================================================
   SOQQA — Mines view controller
   ----------------------------------------------------------------------------
   The only place where the store, the mines engine, the board and the shared
   result overlay meet. Unlike the slots and the wheel there is no single
   "spin": a round is a small state machine, and almost everything below exists
   to keep its edges shut.

     idle ──start──▶ active ──tile──▶ active            (a safe tile: the
        ▲              │                                round just gets richer)
        │              ├──tile──▶ settling ──▶ resolved  (a mine)
        │              └──cash out──▶ resolved          (paid exactly once)
        └──────────────── new round ─────────────────────┘

   The rules the state machine enforces, and where:

     • the bet and the mine count are frozen for as long as `busy()` — the
       selectors are locked, so a round cannot be re-priced underneath itself;
     • a tile can only be turned in `active`, so the four seconds of the
       end-of-round reveal are not four seconds of clickable board;
     • the multiplier comes from the engine every time, never from a running
       total kept here, so the HUD cannot drift away from the maths;
     • the payout is credited from the cash-out result and NOWHERE else. The
       engine has already closed the round by the time it returns, so a second
       click on the button — or a keyboard repeat, or the overlay's replay —
       gets `reason: 'over'` and no coins;
     • a mine hit records a loss against the bet that was actually taken, so
       the history and the lifetime stats stay true whatever happened to the
       settings afterwards.
   ========================================================================= */

import { COPY, DEFAULT_BET, MINES } from '../config.js';
import { createMinesEngine } from '../games/mines.js';
import { payoutFor } from '../games/paytable.js';
import { createBetControls } from '../ui/betControls.js';
import { createConfetti } from '../ui/confetti.js';
import { createMineControls } from '../ui/mineControls.js';
import { createMinesGrid } from '../ui/minesGrid.js';
import { formatCoins, formatMultiplier } from '../ui/format.js';
import { celebrationFor } from '../ui/resultModal.js';
import { createRng } from '../utils/rng.js';

/** The round states. `busy()` is the only thing most of the view asks about. */
const STATES = Object.freeze({ idle: 'idle', active: 'active', settling: 'settling', resolved: 'resolved' });

/**
 * @param {{
 *   store: object,
 *   root: HTMLElement|null,
 *   balanceView: object,
 *   toaster: object,
 *   confetti?: object,
 *   resultModal?: object,
 *   rng?: object,
 *   flipMs?: number,
 * }} options
 */
export function createMinesView({
  store,
  root,
  balanceView,
  toaster,
  confetti,
  resultModal = null,
  rng = createRng(),
  flipMs,
} = {}) {
  if (!root || !store) {
    return {
      init: () => {},
      refresh: () => {},
      start: () => {},
      handleCashOut: () => {},
      isRoundActive: false,
      state: STATES.idle,
    };
  }

  const engine = createMinesEngine({ rng });
  const grid = createMinesGrid(root, flipMs === undefined ? {} : { flipMs });
  const confettiFx = confetti ?? createConfetti();

  const startButton = root.querySelector('[data-mines-start]');
  const startLabelEl = root.querySelector('[data-mines-start-label]');
  const cashOutButton = root.querySelector('[data-mines-cashout]');
  const summaryEl = root.querySelector('[data-mines-summary]');
  const stageEl = root.querySelector('[data-mines-stage]');
  const progressEl = root.querySelector('[data-mines-progress]');
  const multiplierEl = root.querySelector('[data-mines-multiplier]');
  const nextEl = root.querySelector('[data-mines-next]');
  const potentialEl = root.querySelector('[data-mines-potential]');

  let state = STATES.idle;
  /** The stake actually taken for the live round. Never re-read mid-round. */
  let activeBet = 0;
  /** The payout the HUD last advertised, so a reveal can float the difference. */
  let shownPayout = 0;
  let starting = false;

  const busy = () => state === STATES.active || state === STATES.settling;

  const betControls = createBetControls(root, {
    canAfford: (bet) => store.canAfford(bet),
    initialBet: store.getSettings?.().lastBet ?? DEFAULT_BET,
    onChange: (bet) => {
      store.setLastBet(bet);
      paintHud();
    },
  });

  const mineControls = createMineControls(root, {
    min: MINES.minCount,
    max: MINES.maxCount,
    initial: MINES.defaultCount,
    onChange: () => paintHud(),
  });

  /* --- painting ---------------------------------------------------------- */

  const setText = (element, text) => {
    if (element && element.textContent !== text) element.textContent = text;
  };

  function setMessage(text, kind = null) {
    if (!summaryEl) return;
    summaryEl.textContent = text;
    summaryEl.classList.remove('is-win', 'is-lose');
    if (kind) summaryEl.classList.add(kind);
  }

  /** The only place the read-outs are written. Everything it needs is derived. */
  function paintHud() {
    const mineCount = mineControls.getCount();
    const revealed = engine.revealedCount;
    const available = engine.maxReveal(mineCount);
    const multiplier = engine.multiplierFor(mineCount, revealed);
    const payout = revealed > 0 ? payoutFor(activeBet || betControls.getBet(), multiplier) : 0;
    const canRaise = revealed < available;
    const next = canRaise ? engine.multiplierFor(mineCount, revealed + 1) : 0;

    setText(progressEl, COPY.minesProgress(revealed, available));
    setText(multiplierEl, multiplier > 0 ? formatMultiplier(multiplier) : '—');
    setText(nextEl, next > 0 ? formatMultiplier(next) : '—');
    setText(potentialEl, `${formatCoins(payout)} soqqa`);

    // The board's own display of "what is at stake" — a clean board reads 0.
    shownPayout = payout;

    if (multiplierEl) multiplierEl.classList.toggle('is-live', multiplier > 0);
    if (potentialEl) potentialEl.classList.toggle('is-live', payout > 0);

    // Cash out is only real once at least one tile has turned over.
    const armed = state === STATES.active && revealed > 0;
    if (cashOutButton) {
      cashOutButton.disabled = !armed;
      cashOutButton.classList.toggle('is-armed', armed);
    }

    if (startButton) {
      startButton.hidden = busy();
      startButton.disabled = state === STATES.settling || starting;
    }
    // The board is finished but still on screen, so the button offers the next
    // round rather than the same one again.
    setText(startLabelEl, state === STATES.resolved ? COPY.minesReplay : COPY.minesStart);
  }

  /** Freeze or release the round's controls. The board is armed separately. */
  function applyLock() {
    const locked = busy();
    betControls.lock(locked);
    mineControls.lock(locked);
    root.classList.toggle('is-locked', locked);
    root.setAttribute('aria-busy', String(state === STATES.settling));
    paintHud();
  }

  /**
   * @param {'is-win'|'is-lose'|null} kind
   * @param {{ big?: boolean }} [tier] — a cash out past MINES.bigWinMultiplier is
   *   promoted, which the stylesheet answers with a faster, brighter ripple.
   */
  function setStage(kind, { big = false } = {}) {
    if (!stageEl) return;
    stageEl.classList.remove('is-win', 'is-lose', 'is-big');
    if (kind) stageEl.classList.add(kind);
    if (kind && big) stageEl.classList.add('is-big');
  }

  /* --- the round --------------------------------------------------------- */

  function start() {
    // A start press while a round runs — or while the end-of-round reveal is
    // still playing — is simply not a start. The synchronous `busy()` check is
    // what makes a double-click incapable of paying two stakes.
    if (busy() || starting) return;

    const bet = betControls.getBet();

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

    const placed = store.placeBet(bet);
    if (!placed.ok) {
      setMessage(COPY.insufficient(formatCoins(bet), formatCoins(store.getBalance())), 'is-lose');
      return;
    }

    const started = engine.start({ mines: mineControls.getCount() });
    if (!started.ok) {
      // Cannot happen: the state machine above already refused a live round.
      // Refund rather than swallow the stake if it ever does.
      store.credit(bet);
      setMessage(COPY.spinFailed, 'is-lose');
      toaster.show(COPY.spinFailed, { kind: 'error' });
      return;
    }

    starting = true;
    activeBet = bet;
    state = STATES.active;
    setStage(null);
    applyLock();
    // Armed AFTER the lock: the tiles are the one control that unlocks now.
    grid.arm();
    setMessage(COPY.minesActive);
    paintHud();
    starting = false;
  }

  /** A mine ended the round: show the whole board, then record the loss. */
  async function settleLoss(round) {
    // The wave starts at the mine that ended it — `round.hitIndex` is the tile
    // the engine recorded, so the board unseals outward from the damage.
    await grid.revealRest({
      mineIndices: round.mineIndices,
      picked: round.picks,
      from: round.hitIndex,
    });

    state = STATES.resolved;
    applyLock();
    setStage('is-lose');

    if (activeBet > 0) {
      store.recordSpin({
        game: 'mines',
        bet: activeBet,
        mines: round.mineCount,
        tiles: round.revealedCount,
        multiplier: 0,
        payout: 0,
      });
    }

    setMessage(COPY.minesMine(formatCoins(activeBet)), 'is-lose');
    balanceView?.flash?.('lose');

    if (!store.hasEnoughForMinBet()) {
      toaster.show(COPY.balanceEmpty, { kind: 'warning', duration: 6000 });
    }

    try {
      resultModal?.show?.({
        outcome: 'loss',
        game: 'mines',
        multiplier: 0,
        payout: 0,
        bet: activeBet,
        balance: store.getBalance(),
        celebrate: false,
        factLabel: COPY.minesFactLabel,
        factValue: COPY.minesFactValue(round.revealedCount, round.mineCount),
        onReplay: () => {
          start();
        },
      });
    } catch (error) {
      // A broken overlay must never break the game.
      if (typeof console !== 'undefined') console.error('[SOQQA] result modal failed', error);
    }
  }

  /**
   * Turn a tile over. Everything the player can do to the board arrives here,
   * and the three guards below are what keep a fast double-click honest:
   * the state machine's, the engine's, and the board's (a revealed tile is
   * disabled, so the click never even reaches this function).
   */
  async function handleTile(index) {
    if (state !== STATES.active) return;

    const bet = activeBet;
    const before = shownPayout;
    const result = engine.reveal(index);

    // The engine refuses a tile it has already dealt with, and refuses every
    // tile once the round is over. Nothing is painted for a refused click.
    if (!result.ok) return;

    if (result.status === 'safe') {
      const payout = payoutFor(bet, result.multiplier);

      // The read-out and the message land WITH the click, not with the end of
      // the flip: the arithmetic is instant, only the tile takes a moment to
      // turn, and a multiplier that arrives 460 ms after the player earned it
      // reads as lag. The tile's own animation is the feedback for the coin;
      // these two are the feedback for the round.
      paintHud();
      setMessage(COPY.minesSafe(result.multiplier, formatCoins(payout)));

      await grid.flip(index, 'gem', {
        multiplierLabel: formatMultiplier(result.multiplier),
        valueLabel: payout > before ? `+${formatCoins(payout - before)}` : '',
      });
      return;
    }

    // --- a mine ------------------------------------------------------------
    state = STATES.settling;
    applyLock();
    setMessage(COPY.minesSettling);

    await grid.flip(index, 'mine', { hit: true });
    await settleLoss(result.round);
  }

  /** Bank the multiplier. Pays once: the engine has closed the round already. */
  function handleCashOut() {
    if (state !== STATES.active) return;

    const result = engine.cashOut(activeBet);

    if (!result.ok) {
      if (result.reason === 'empty') {
        toaster.show(COPY.minesNoGems, { kind: 'warning' });
        setMessage(COPY.minesNoGems, 'is-lose');
      }
      // `over`, `inactive` and `invalid` are silent: the button is disabled in
      // all three cases, so reaching them means a duplicate click, and a
      // duplicate click must never produce a second payment or a second banner.
      return;
    }

    // Close the round before touching the balance, so the buttons are dead by
    // the time the credit lands.
    state = STATES.resolved;
    applyLock();

    store.credit(result.payout);
    store.recordSpin({
      game: 'mines',
      bet: activeBet,
      mines: result.mineCount,
      tiles: result.revealedCount,
      multiplier: result.multiplier,
      payout: result.payout,
    });

    const isBig = result.multiplier >= MINES.bigWinMultiplier;
    setMessage(
      isBig
        ? COPY.minesBigWin(result.multiplier, formatCoins(result.payout))
        : COPY.minesCashed(result.multiplier, formatCoins(result.payout)),
      'is-win',
    );
    balanceView?.flash?.('win');
    setStage('is-win', { big: isBig });

    if (!store.hasEnoughForMinBet()) {
      toaster.show(COPY.balanceEmpty, { kind: 'warning', duration: 6000 });
    }

    // The overlay owns the burst when it is available, so the celebration can
    // never fire twice; if there is no overlay, the cabinet celebrates alone.
    let shown = null;
    try {
      shown = resultModal?.show?.({
        outcome: 'win',
        game: 'mines',
        multiplier: result.multiplier,
        payout: result.payout,
        bet: activeBet,
        balance: store.getBalance(),
        celebrate: true,
        bigWin: isBig,
        jackpot: false,
        factLabel: COPY.minesFactLabel,
        factValue: COPY.minesFactValue(result.revealedCount, result.mineCount),
        onReplay: () => {
          start();
        },
      });
    } catch (error) {
      if (typeof console !== 'undefined') console.error('[SOQQA] result modal failed', error);
    }

    if (!shown) confettiFx.celebrate(celebrationFor({ multiplier: result.multiplier, big: isBig }));
  }

  /* --- wiring ------------------------------------------------------------ */

  function syncAvailability() {
    paintHud();
  }

  function init() {
    grid.build();
    grid.setHandler((index) => {
      handleTile(index);
    });
    setStage(null);
    setMessage(COPY.minesIdle);

    startButton?.addEventListener('click', start);
    cashOutButton?.addEventListener('click', handleCashOut);

    // Keyboard: Enter/Space starts a round when focus is inside the cabinet but
    // not on a button — the tiles and the two action buttons already fire a
    // native click of their own.
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target;
      if (target && typeof target.tagName === 'string' && target.tagName === 'BUTTON') return;
      event.preventDefault();
      start();
    });

    store.subscribe((next, event) => {
      syncAvailability();
      if (event?.type === 'reset') betControls.setBet(next.settings.lastBet, { notify: false });
    });

    applyLock();
    setMessage(COPY.minesIdle);
  }

  return {
    init,
    refresh: syncAvailability,
    start,
    handleCashOut,
    /** The tile handler, exposed so a test can drive a click without a board. */
    handleTile,
    get state() {
      return state;
    },
    get isRoundActive() {
      return busy();
    },
    get bet() {
      return activeBet;
    },
    elements: {
      startButton,
      startLabelEl,
      cashOutButton,
      summaryEl,
      stageEl,
      progressEl,
      multiplierEl,
      nextEl,
      potentialEl,
      betControls,
      mineControls,
      grid,
    },
    engine,
  };
}

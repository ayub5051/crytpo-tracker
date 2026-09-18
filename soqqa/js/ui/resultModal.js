/* ============================================================================
   SOQQA — result modal (animated win/loss overlay)
   ----------------------------------------------------------------------------
   Presentation only: it never touches the store, the balance or the engines.
   The caller hands over a finished result and the modal shows it, fires the
   celebration for the win and reports back through `onReplay`.

   Both games share this one overlay: the slots cabinet opens it on any paying
   spin (a losing spin stays silent and shows only its inline message) and the
   wheel opens it on every spin. The caller chooses the tier through `bigWin` /
   `jackpot` and the second fact through `factLabel` / `factValue`.

   Markup lives in index.html (`#modal-root`), so the overlay can be styled and
   inspected without building DOM by string. Includes a keyboard trap (Tab /
   Shift+Tab cycle, Escape closes), focus restoration and a full reduced-motion
   path. A missing root degrades to a silent no-op.
   ========================================================================= */

import { COPY, WHEEL_JACKPOT_MULTIPLIER } from '../config.js';
import { formatCoins, formatMultiplier, formatSigned } from './format.js';

/**
 * The overlay's tier ladder is decided by the caller, because only the game that
 * owns the payout table knows where its thresholds sit. `bigWin` and `jackpot`
 * fall back to the wheel's historical behaviour (a celebrating win is a big one,
 * and `WHEEL_JACKPOT_MULTIPLIER` is the top tier) so a caller that passes only
 * `celebrate` still gets the right titles.
 */

/**
 * Size and shape of the confetti burst for a win.
 *
 * Exported so a caller that has no overlay available (a headless run, or a
 * broken overlay) can fire the identical celebration instead of inventing a
 * second ladder — the two can then never disagree.
 *
 * @param {{ multiplier?: number, big?: boolean, jackpot?: boolean }} [win]
 * @returns {{ intensity: number, fan: number }}
 */
export function celebrationFor({ multiplier = 0, big = false, jackpot = false } = {}) {
  if (jackpot) return { intensity: 3, fan: 3 };
  if (big) return { intensity: Math.min(2.6, 1.8 + multiplier / 30), fan: 1 };
  return { intensity: Math.min(1.8, 1.4 + multiplier / 40), fan: 1 };
}

const ICONS = Object.freeze({
  win: '🎉',
  jackpot: '🏆',
  loss: '🎡',
});

/**
 * @param {HTMLElement|null} root — the `#modal-root` overlay container
 * @param {{ confetti?: object }} [options]
 */
export function createResultModal(root = null, { confetti = null } = {}) {
  const container = root ?? (typeof document !== 'undefined' ? document.querySelector('#modal-root') : null);
  const panel = container ? container.querySelector('[data-result-modal]') : null;

  const refs = {
    icon: container ? container.querySelector('[data-modal-icon]') : null,
    title: container ? container.querySelector('[data-modal-title]') : null,
    message: container ? container.querySelector('[data-modal-message]') : null,
    amount: container ? container.querySelector('[data-modal-amount]') : null,
    bet: container ? container.querySelector('[data-modal-bet]') : null,
    multiplier: container ? container.querySelector('[data-modal-multiplier]') : null,
    factLabel: container ? container.querySelector('[data-modal-fact-label]') : null,
    fact: container ? container.querySelector('[data-modal-fact]') : null,
    balance: container ? container.querySelector('[data-modal-balance]') : null,
    replay: container ? container.querySelector('[data-modal-replay]') : null,
    close: container ? container.querySelector('[data-modal-close]') : null,
    backdrop: container ? container.querySelector('[data-modal-backdrop]') : null,
  };

  const focusables = [refs.replay, refs.close].filter(Boolean);

  let isOpen = false;
  let lastFocused = null;
  let replayHandler = null;

  const reducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const setText = (element, text) => {
    if (element) element.textContent = text;
  };

  function onKeydown(event) {
    if (!isOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== 'Tab' || focusables.length === 0) return;

    // Focus trap: keep the tab ring inside the dialog.
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const current = focusables.indexOf(active);
    const step = event.shiftKey ? -1 : 1;
    const next = (current + step + focusables.length) % focusables.length;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    focusables[next].focus?.();
  }

  function open() {
    if (!container || !panel) return;
    container.hidden = false;
    // Flush the layout so the panel animates in from its hidden state instead
    // of appearing without a transition (display:none → block needs a reflow).
    void panel.offsetWidth;
    panel.classList.toggle('is-static', reducedMotion());
    panel.classList.add('is-open');

    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', onKeydown);
    }
  }

  /**
   * Close the overlay and hand focus back to whatever was focused before.
   * @returns {boolean} whether a modal was actually open
   */
  function close() {
    if (!container || !panel) return false;
    const wasOpen = isOpen;

    isOpen = false;
    replayHandler = null;
    container.hidden = true;
    panel.classList.remove('is-open', 'is-static');

    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', onKeydown);
    }
    lastFocused?.focus?.();
    lastFocused = null;

    return wasOpen;
  }

  refs.replay?.addEventListener('click', () => {
    const handler = replayHandler;
    close();
    // Play again: re-run the spin through the view controller.
    if (typeof handler === 'function') handler();
  });

  refs.close?.addEventListener('click', () => close());
  refs.backdrop?.addEventListener('click', () => close());

  return {
    /**
     * Show a finished result.
     * @param {{
     *   outcome?: 'win'|'loss', game?: string, multiplier?: number,
     *   payout?: number, bet?: number, balance?: number, segmentIndex?: number|null,
     *   celebrate?: boolean, bigWin?: boolean, jackpot?: boolean,
     *   factLabel?: string, factValue?: string, onReplay?: (() => void)|null,
     * }} result
     */
    show(result = {}) {
      if (!container || !panel) return null;

      const multiplier = Math.max(0, Number(result.multiplier) || 0);
      const payout = Math.max(0, Math.round(Number(result.payout) || 0));
      const bet = Math.max(0, Math.round(Number(result.bet) || 0));
      const balance = Math.max(0, Math.round(Number(result.balance) || 0));
      const net = payout - bet;
      const isWin = payout > 0 || result.outcome === 'win';
      const isJackpot = isWin && Boolean(result.jackpot ?? multiplier >= WHEEL_JACKPOT_MULTIPLIER);
      const isBig = isWin && Boolean(result.bigWin ?? result.celebrate);
      /** Any win gets its burst; a loss never does. */
      const fireConfetti = isWin && (result.celebrate ?? true);

      const kind = isWin ? 'win' : 'loss';
      setText(refs.icon, isJackpot ? ICONS.jackpot : isWin ? ICONS.win : ICONS.loss);
      setText(
        refs.title,
        isWin
          ? isJackpot
            ? COPY.modalJackpotTitle
            : isBig
              ? COPY.modalBigWinTitle
              : COPY.modalCongratsTitle
          : COPY.modalLossTitle,
      );
      setText(
        refs.message,
        isWin
          ? COPY.modalWinMessage(formatMultiplier(multiplier), formatCoins(payout))
          : COPY.modalLossMessage(formatCoins(bet)),
      );

      if (refs.amount) {
        refs.amount.textContent = formatSigned(net);
        refs.amount.classList.toggle('is-win', isWin);
        refs.amount.classList.toggle('is-lose', !isWin);
      }

      setText(refs.bet, `${formatCoins(bet)} soqqa`);
      setText(refs.multiplier, formatMultiplier(multiplier));
      setText(refs.factLabel, result.factLabel ?? COPY.modalSegmentLabel);
      setText(
        refs.fact,
        result.factValue ??
          (Number.isInteger(result.segmentIndex) ? COPY.segmentLabel(result.segmentIndex) : '—'),
      );
      setText(refs.balance, COPY.modalBalance(formatCoins(balance)));

      panel.classList.toggle('is-win', isWin);
      panel.classList.toggle('is-lose', !isWin);
      panel.classList.toggle('is-jackpot', isJackpot);

      lastFocused = typeof document !== 'undefined' ? document.activeElement : null;
      replayHandler = typeof result.onReplay === 'function' ? result.onReplay : null;
      isOpen = true;

      open();
      refs.close?.focus?.();

      // Celebration is part of the overlay, so callers never double-fire it.
      // The burst scales with the win, and the top tier gets a fan of origins
      // across the viewport rather than a single pop.
      if (fireConfetti) {
        confetti?.celebrate?.(celebrationFor({ multiplier, big: isBig, jackpot: isJackpot }));
      }

      return { panel, kind, multiplier, payout, net };
    },

    close,
    get isOpen() {
      return isOpen;
    },
    elements: { container, panel, ...refs },
  };
}

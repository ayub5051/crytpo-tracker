/* ============================================================================
   SOQQA — spin history view
   Renders the persisted spin records (newest first, max HISTORY_LIMIT) plus the
   per-session summary line and the empty state. Re-rendered on every store
   notification, so the list updates in real time right after a spin.
   ========================================================================= */

import { COPY, HISTORY_LIMIT, SYMBOLS } from '../config.js';
import { formatCoins, formatMultiplier, formatSigned, formatTime } from './format.js';
import { symbolSvgMarkup } from './symbolArt.js';

/**
 * One glyph per game, for the row's leading column. Purely decorative (the
 * cell is hidden from assistive tech), which is why the games that do not
 * render their result as artwork can just be told apart by a mark.
 */
const GAME_MARKS = Object.freeze({ slots: '🎰', wheel: '🎡', mines: '💠' });

/**
 * @param {HTMLElement|null} root — the history view section
 */
export function createHistoryView(root) {
  const listEl = root ? root.querySelector('[data-history-list]') : null;
  const emptyEl = root ? root.querySelector('[data-history-empty]') : null;
  const summaryEl = root ? root.querySelector('[data-history-summary]') : null;
  const clearButton = root ? root.querySelector('[data-action="clear-history"]') : null;

  function renderRows(history) {
    if (!listEl) return;
    listEl.textContent = '';

    history.forEach((entry) => {
      const row = document.createElement('li');
      row.className = `history-row history-row--${entry.outcome}`;

      const game = document.createElement('span');
      game.className = 'history-row__game';
      game.setAttribute('aria-hidden', 'true');
      game.textContent = GAME_MARKS[entry.game] ?? GAME_MARKS.slots;

      const symbols = document.createElement('span');
      symbols.className = 'history-row__symbols';
      // Slots record symbols, the wheel the segment it landed on, and mines the
      // board it was played on — each game's row says what that game actually
      // decided, so no row is ever a row of dashes.
      if (Array.isArray(entry.symbols)) {
        symbols.innerHTML = entry.symbols
          .map((id) => symbolSvgMarkup(SYMBOLS[id] ? id : 'coin', 'history-row__symbol-art'))
          .join('');
      } else if (Number.isInteger(entry.segmentIndex)) {
        symbols.textContent = COPY.segmentLabel(entry.segmentIndex);
      } else if (Number.isInteger(entry.mines)) {
        symbols.textContent = COPY.minesCellLabel(entry.tiles ?? 0, entry.mines);
      } else {
        symbols.textContent = '—';
      }

      const bet = document.createElement('span');
      bet.className = 'history-row__bet';
      bet.textContent = `${formatCoins(entry.bet)} soqqa`;

      const outcome = document.createElement('span');
      outcome.className = `history-row__outcome history-row__outcome--${entry.outcome}`;
      outcome.textContent =
        entry.outcome === 'win'
          ? `Yutuq ${formatMultiplier(entry.multiplier)}`
          : 'Yutuq yo\u2019q';

      const payout = document.createElement('span');
      payout.className = `history-row__payout history-row__payout--${entry.outcome}`;
      // net = payout − bet, so a loss renders as a signed negative amount.
      payout.textContent = formatSigned(entry.net);

      const balance = document.createElement('span');
      balance.className = 'history-row__balance';
      balance.textContent = `Balans: ${formatCoins(entry.balanceAfter ?? 0)}`;

      const time = document.createElement('span');
      time.className = 'history-row__time';
      time.textContent = formatTime(entry.timestamp);

      row.append(game, symbols, bet, outcome, payout, balance, time);
      listEl.append(row);
    });
  }

  function renderSummary(history) {
    if (!summaryEl) return;
    const wins = history.filter((entry) => entry.outcome === 'win').length;
    const losses = history.length - wins;

    if (history.length === 0) {
      summaryEl.textContent = '';
      return;
    }

    summaryEl.textContent = `Ko\u2019rsatilgan ${history.length} ta aylanish (maksimum ${HISTORY_LIMIT}) \u00b7 Yutuq: ${wins} \u00b7 Yutuqsiz: ${losses}`;
  }

  return {
    /** @param {{ history: object[] }} state */
    render(state) {
      const history = Array.isArray(state?.history) ? state.history : [];

      renderRows(history);
      renderSummary(history);

      if (emptyEl) emptyEl.hidden = history.length > 0;
      if (clearButton) clearButton.disabled = history.length === 0;
    },

    elements: { listEl, emptyEl, summaryEl, clearButton },
  };
}

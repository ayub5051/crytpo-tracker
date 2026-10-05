/* ============================================================================
   SKINO — transaction history view
   Newest-first list of ledger entries: purchases, sales, mini-game results and
   rewards, each with its signed Crystal amount.
   ========================================================================= */

import { getLedger, clearLedger, onLedgerChange } from './ledger.js';
import { formatCrystals } from './crystals.js';

const TYPE_LABEL = {
  purchase: 'Purchase',
  sale: 'Sale',
  wheel: 'Wheel',
  math: 'Math Challenge',
  daily: 'Daily bonus',
  topup: 'Top-up',
  auction: 'Auction',
  other: 'Activity',
};

const EMPTY_MARKUP = `
  <div class="empty-state">
    <span class="empty-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
        <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="1.3"
          stroke-linecap="round" />
      </svg>
    </span>
    <p class="empty-title">No activity yet</p>
    <p class="empty-copy">Purchases, sales and game results will show up here.</p>
  </div>`;

function formatTime(ts) {
  const date = new Date(ts);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${day} · ${time}`;
}

function direction(amount) {
  if (amount > 0) return 'is-pos';
  if (amount < 0) return 'is-neg';
  return 'is-zero';
}

function createRow(entry) {
  const row = document.createElement('li');
  row.className = 'history-row';

  const dot = document.createElement('span');
  dot.className = `history-dot ${direction(entry.amount)}`;
  dot.setAttribute('aria-hidden', 'true');

  const main = document.createElement('div');
  main.className = 'history-main';

  const label = document.createElement('p');
  label.className = 'history-label';
  label.textContent = entry.label;

  const meta = document.createElement('p');
  meta.className = 'history-meta';
  meta.textContent = `${TYPE_LABEL[entry.type] ?? TYPE_LABEL.other} · ${formatTime(
    entry.time
  )}`;

  main.append(label, meta);

  const amount = document.createElement('span');
  amount.className = `history-amount ${direction(entry.amount)}`;
  amount.textContent =
    entry.amount === 0
      ? '—'
      : `${entry.amount > 0 ? '+' : '−'}${formatCrystals(Math.abs(entry.amount))} ◆`;

  row.append(dot, main, amount);
  return row;
}

export function initHistoryView() {
  const list = document.querySelector('[data-history-list]');
  const countEl = document.querySelector('[data-history-count]');
  const clearBtn = document.querySelector('[data-history-clear]');
  if (!list) return;

  function render(entries) {
    if (countEl) {
      countEl.textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;
    }
    if (clearBtn) clearBtn.disabled = entries.length === 0;

    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'history-empty';
      empty.innerHTML = EMPTY_MARKUP;
      list.replaceChildren(empty);
      return;
    }

    list.replaceChildren(...entries.map(createRow));
  }

  clearBtn?.addEventListener('click', () => clearLedger());

  render(getLedger());
  onLedgerChange(render);
}

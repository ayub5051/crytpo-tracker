/* ============================================================================
   SOQQA — application bootstrap
   ----------------------------------------------------------------------------
   Wires the persistent store to the views exactly once:
     storage → store → views (balance, stats, history, slots) → router
   No game logic and no storage access live here.
   ========================================================================= */

import { COPY, STARTING_BALANCE } from './config.js';
import { createStore } from './store/state.js';
import { createStorage } from './store/storage.js';
import { createRouter } from './router.js';
import { createBalanceView } from './ui/balanceView.js';
import { installChromeGuards } from './ui/chrome.js';
import { createConfetti } from './ui/confetti.js';
import { createHistoryView } from './ui/historyView.js';
import { createResultModal } from './ui/resultModal.js';
import { createStatsView } from './ui/statsView.js';
import { createToaster } from './ui/toast.js';
import { formatCoins } from './ui/format.js';
import { createMinesView } from './views/minesView.js';
import { createSlotsView } from './views/slotsView.js';
import { createWheelView } from './views/wheelView.js';

/** Boots the whole app. Exported so it can be exercised by tests. */
export function boot() {
  // The shell is not a document: no selection, no caret, no I-beam. The CSS
  // states it; this is what makes it hold in every engine (js/ui/chrome.js).
  installChromeGuards();

  /* --- storage + state ---------------------------------------------------- */
  const storage = createStorage();
  const store = createStore({ storage });
  const toaster = createToaster(document.querySelector('#toast-root'));

  // Tell the player when stored data had to be repaired or couldn't be saved.
  const recovery = store.getRecoveryReport();
  const repaired = recovery.repaired.filter((key) => !key.endsWith(':missing'));
  if (repaired.length > 0 || recovery.droppedRecords > 0) {
    toaster.show(COPY.storageRecovered, { kind: 'warning', duration: 6000 });
  }
  if (store.getWriteFailed()) {
    toaster.show(COPY.storageWriteFailed, { kind: 'error', duration: 7000 });
  }
  if (!storage.isPersistent) {
    toaster.show(COPY.storageWriteFailed, { kind: 'warning', duration: 7000 });
  }

  /* --- shared views ------------------------------------------------------- */
  const balanceView = createBalanceView({
    valueEl: document.querySelector('#balance-value'),
    chipEl: document.querySelector('.balance-chip'),
  });
  const statsView = createStatsView(document);
  const historyView = createHistoryView(document.querySelector('[data-view="/history"]'));
  const confetti = createConfetti(document.querySelector('#confetti-canvas'));

  /* --- shared result overlay --------------------------------------------- */
  const resultModal = createResultModal(document.querySelector('#modal-root'), { confetti });

  /* --- slots -------------------------------------------------------------- */
  const slotsView = createSlotsView({
    store,
    root: document.querySelector('[data-view="/slots"]'),
    balanceView,
    toaster,
    confetti,
    resultModal,
  });

  /* --- Omad charxi -------------------------------------------------------- */
  const wheelView = createWheelView({
    store,
    root: document.querySelector('[data-view="/wheel"]'),
    balanceView,
    toaster,
    resultModal,
  });

  /* --- Mines -------------------------------------------------------------- */
  const minesView = createMinesView({
    store,
    root: document.querySelector('[data-view="/mines"]'),
    balanceView,
    toaster,
    confetti,
    resultModal,
  });

  /* --- single source of truth → views ------------------------------------ */
  store.subscribe((state, event) => {
    // Balance animates on coin movement, otherwise it just paints.
    balanceView.update(state.balance, { animate: event?.type === 'balance' });
    statsView.render(state);
    historyView.render(state);

    if (event?.type === 'history' && event.reason === 'cleared') {
      toaster.show(COPY.historyCleared, { kind: 'success' });
    }
  });

  // Initial paint (no animation on first load).
  balanceView.render(store.getBalance());
  statsView.render(store.getState());
  historyView.render(store.getState());

  slotsView.init();
  wheelView.init();
  minesView.init();

  /* --- actions ------------------------------------------------------------ */
  const clearButton = document.querySelector('[data-action="clear-history"]');
  clearButton?.addEventListener('click', () => {
    if (window.confirm(COPY.clearConfirm)) store.clearHistory();
  });

  const resetButton = document.querySelector('[data-action="reset-balance"]');
  resetButton?.addEventListener('click', () => {
    if (!window.confirm(COPY.resetConfirm)) return;
    store.resetBalance();
    toaster.show(COPY.balanceReset(formatCoins(STARTING_BALANCE)), { kind: 'success' });
  });

  /* --- routing ------------------------------------------------------------ */
  const router = createRouter();
  router.start();

  // Handy for manual debugging in the console (no effect on gameplay).
  window.SOQQA = {
    store,
    router,
    slotsView,
    wheelView,
    minesView,
    resultModal,
    balanceView,
    historyView,
    statsView,
    confetti,
  };

  // Mark the document booted, which is what retires the "the game never
  // loaded" panel in index.html. Deliberately the LAST statement of boot():
  // if anything above throws, the flag is never set and the panel stays up,
  // which is exactly the diagnosis a half-broken boot deserves.
  //
  // Guarded like every other DOM touch here: boot() also runs against a stub
  // document with no root element, and importing this module has to stay safe
  // outside a browser.
  if (document.documentElement?.dataset) {
    document.documentElement.dataset.booted = 'true';
  }
}

// Auto-start in the browser only (importing this module in Node must be safe).
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}

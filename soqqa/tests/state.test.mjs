/* ============================================================================
   SOQQA — state manager tests
   Covers: fresh install, balance maths, bet validation, history limit,
   persistence across reloads, corrupted/blocked storage and non-negativity.
   ========================================================================= */

import {
  DEFAULT_BET,
  HISTORY_LIMIT,
  MAX_BET,
  STARTING_BALANCE,
  STORAGE_KEYS,
} from '../js/config.js';
import { createStore } from '../js/store/state.js';
import { createMemoryStorage, createStorage } from '../js/store/storage.js';
import { createBlockedStorage, createFailingStorage } from './helpers.mjs';

export function runStateTests(suite) {
  /* --- fresh install --------------------------------------------------- */
  {
    const store = createStore({
      storage: createStorage(createMemoryStorage()),
      now: () => 1_700_000_000_000,
    });

    suite.eq('fresh balance = 1 000 000', store.getBalance(), STARTING_BALANCE);
    suite.eq('fresh history is empty', store.getHistory().length, 0);
    suite.eq('fresh totalSpins = 0', store.getStats().totalSpins, 0);
    suite.eq('fresh lastBet = DEFAULT_BET', store.getSettings().lastBet, DEFAULT_BET);
  }

  /* --- betting --------------------------------------------------------- */
  {
    const store = createStore({ storage: createStorage(createMemoryStorage()) });

    const placed = store.placeBet(5_000);
    suite.ok('placeBet succeeds when affordable', placed.ok === true);
    suite.eq('balance drops by the bet', store.getBalance(), STARTING_BALANCE - 5_000);

    suite.ok('canAfford(1000) true with balance', store.canAfford(1_000) === true);
    suite.ok('canAfford(MAX_BET) true at 1 000 000', store.canAfford(MAX_BET) === true);
    suite.ok('canAfford false for an invalid amount', store.canAfford(1_500) === false);

    store.credit(12_500);
    suite.eq('credit adds the payout', store.getBalance(), STARTING_BALANCE - 5_000 + 12_500);

    const before = store.getBalance();
    suite.ok('credit ignores 0', store.credit(0) === before);
    suite.ok('credit ignores negative amounts', store.credit(-900) === before);
    suite.ok('credit ignores NaN', store.credit(Number.NaN) === before);
    suite.ok('credit ignores Infinity', store.credit(Number.POSITIVE_INFINITY) === before);
  }

  /* --- invalid bets ---------------------------------------------------- */
  {
    const store = createStore({ storage: createStorage(createMemoryStorage()) });
    const invalid = [0, -1_000, 500, 1_500, 12.5, Number.NaN, Number.POSITIVE_INFINITY, '1000', null, undefined];

    invalid.forEach((bet) => {
      const result = store.placeBet(bet);
      suite.ok(`placeBet rejects ${String(bet)}`, result.ok === false && result.reason === 'invalid');
    });

    suite.eq('balance untouched after invalid bets', store.getBalance(), STARTING_BALANCE);
  }

  /* --- insufficient balance + never negative --------------------------- */
  {
    const backend = createMemoryStorage();
    backend.setItem(STORAGE_KEYS.balance, JSON.stringify({ coins: 1_000, updatedAt: 0 }));
    const store = createStore({ storage: createStorage(backend) });

    const tooBig = store.placeBet(5_000);
    suite.ok('placeBet refuses a bet above the balance', tooBig.ok === false && tooBig.reason === 'insufficient');
    suite.eq('balance unchanged after a refused bet', store.getBalance(), 1_000);

    const exact = store.placeBet(1_000);
    suite.ok('betting the exact balance is allowed', exact.ok === true);
    suite.eq('balance hits exactly zero', store.getBalance(), 0);

    // Spam 50 bets: the balance must never go below zero.
    for (let i = 0; i < 50; i += 1) store.placeBet(1_000);
    suite.ok('balance never goes negative', store.getBalance() >= 0, `balance = ${store.getBalance()}`);
    suite.ok('canAfford false at zero balance', store.canAfford(1_000) === false);
  }

  /* --- history limit + stats ------------------------------------------- */
  {
    const store = createStore({ storage: createStorage(createMemoryStorage()) });

    for (let i = 1; i <= 60; i += 1) {
      const win = i % 4 === 0;
      store.recordSpin({
        game: 'slots',
        bet: 1_000,
        symbols: win ? ['seven', 'seven', 'seven'] : ['cherry', 'coin', 'bell'],
        line: win ? 'seven' : null,
        matchType: win ? 'three' : null,
        multiplier: win ? 60 : 0,
        payout: win ? 60_000 : 0,
      });
    }

    const history = store.getHistory();
    suite.eq(`history capped at ${HISTORY_LIMIT}`, history.length, HISTORY_LIMIT);
    suite.ok('newest record is first', history[0].timestamp >= history[history.length - 1].timestamp);

    const stats = store.getStats();
    suite.eq('lifetime totalSpins counts every spin', stats.totalSpins, 60);
    suite.eq('lifetime totalBet', stats.totalBet, 60_000);
    suite.eq('lifetime totalWon', stats.totalWon, 15 * 60_000);
    suite.eq('biggestWin', stats.biggestWin, 60_000);
    suite.eq('bestMultiplier', stats.bestMultiplier, 60);
    suite.eq('net = won − bet', stats.net, stats.totalWon - stats.totalBet);
  }

  /* --- persistence across a "reload" ----------------------------------- */
  {
    const backend = createMemoryStorage();
    const first = createStore({ storage: createStorage(backend), now: () => 1_700_000_000_000 });

    first.placeBet(25_000);
    first.credit(50_000);
    first.recordSpin({
      game: 'slots',
      bet: 25_000,
      symbols: ['diamond', 'diamond', 'diamond'],
      line: 'diamond',
      matchType: 'three',
      multiplier: 38,
      payout: 950_000,
    });
    first.setLastBet(25_000);

    // Second store over the same backend == a page reload.
    const second = createStore({ storage: createStorage(backend) });

    suite.eq('balance survives a reload', second.getBalance(), first.getBalance());
    suite.eq('history survives a reload', second.getHistory().length, 1);
    suite.eq('stats survive a reload', second.getStats().totalSpins, 1);
    suite.eq('the recorded symbols survive', second.getHistory()[0].symbols.join(','), 'diamond,diamond,diamond');
    suite.eq('lastBet survives a reload', second.getSettings().lastBet, 25_000);
    suite.eq('balanceAfter is stored on the record', second.getHistory()[0].balanceAfter, second.getBalance());
  }

  /* --- corrupted / invalid storage ------------------------------------- */
  {
    const backend = createMemoryStorage();
    backend.setItem(STORAGE_KEYS.balance, '{not json at all');
    backend.setItem(STORAGE_KEYS.history, '"a string, not an array"');
    backend.setItem(STORAGE_KEYS.stats, 'null');
    backend.setItem(STORAGE_KEYS.settings, '[]');

    const store = createStore({ storage: createStorage(backend) });
    const report = store.getRecoveryReport();

    suite.eq('corrupted balance falls back to the starting balance', store.getBalance(), STARTING_BALANCE);
    suite.eq('corrupted history falls back to []', store.getHistory().length, 0);
    suite.ok('corrupted keys are reported', report.repaired.length > 0, report.repaired.join(','));
    suite.ok('settings fall back to a valid bet', store.isValidBet(store.getSettings().lastBet));
  }

  {
    const backend = createMemoryStorage();
    backend.setItem(STORAGE_KEYS.balance, JSON.stringify({ coins: -500 }));
    backend.setItem(
      STORAGE_KEYS.history,
      JSON.stringify([
        null,
        42,
        'nope',
        { bet: 1_000, payout: 0 },
        { bet: 'lots', payout: 100 },
        { bet: 1_000, payout: -50 },
        { bet: 1_000, payout: 2_000, symbols: ['seven', 'seven', 'seven'], multiplier: 2, timestamp: 5 },
      ]),
    );
    backend.setItem(STORAGE_KEYS.stats, JSON.stringify({ totalSpins: 'many' }));

    const store = createStore({ storage: createStorage(backend) });
    const report = store.getRecoveryReport();

    // Of the 7 stored records, only { bet: 1000, payout: 0 } and the complete
    // seven-triple record are structurally valid; the rest are dropped.
    suite.eq('negative balance is rejected', store.getBalance(), STARTING_BALANCE);
    suite.eq('junk history records are dropped', store.getHistory().length, 2);
    suite.eq('dropped records are reported', report.droppedRecords, 5);
    suite.ok('stats are rebuilt when invalid', store.getStats().totalSpins === 2);
    suite.eq('rebuilt stats use the surviving records', store.getStats().totalBet, 2_000);
    suite.ok(
      'partially valid records are completed with safe defaults',
      store.getHistory().some((entry) => entry.symbols === null && typeof entry.timestamp === 'number'),
    );
  }

  /* --- blocked / failing storage --------------------------------------- */
  {
    const store = createStore({ storage: createStorage(createBlockedStorage()) });
    suite.eq('blocked storage still yields a playable balance', store.getBalance(), STARTING_BALANCE);

    const placed = store.placeBet(1_000);
    suite.ok('the game still runs without storage', placed.ok === true);
    suite.eq('the balance still moves in memory', store.getBalance(), STARTING_BALANCE - 1_000);
    suite.ok('the failed write is reported to the UI', store.getWriteFailed() === true);
    suite.ok('the game is no longer considered persistent', store.isPersistent() === false);
  }

  {
    const store = createStore({ storage: createStorage(createFailingStorage()) });
    store.placeBet(1_000);

    suite.ok('a failed write is flagged', store.getWriteFailed() === true);
    suite.ok('a failed write keeps the game playable', store.getBalance() === STARTING_BALANCE - 1_000);
    suite.ok('the underlying error is available', store.getStorageError() instanceof Error);
  }

  /* --- notifications ---------------------------------------------------- */
  {
    const store = createStore({ storage: createStorage(createMemoryStorage()) });
    const events = [];
    const unsubscribe = store.subscribe((_state, event) => events.push(event?.type));

    store.placeBet(1_000);
    store.credit(3_000);
    store.recordSpin({ game: 'slots', bet: 1_000, symbols: ['coin', 'coin', 'coin'], payout: 2_000, multiplier: 2 });
    store.setLastBet(5_000);
    store.clearHistory();
    unsubscribe();
    store.resetBalance();

    suite.eq('listeners receive every event type', events, [
      'balance',
      'balance',
      'spin',
      'bet',
      'history',
    ]);
    suite.ok('unsubscribe stops notifications', events.length === 5);
  }

  /* --- clear / reset ---------------------------------------------------- */
  {
    const store = createStore({ storage: createStorage(createMemoryStorage()) });
    store.placeBet(10_000);
    store.recordSpin({ game: 'slots', bet: 10_000, symbols: ['bell', 'bell', 'bell'], payout: 0, multiplier: 0 });
    const balanceBefore = store.getBalance();

    store.clearHistory();
    suite.eq('clearHistory empties the list', store.getHistory().length, 0);
    suite.eq('clearHistory keeps the balance', store.getBalance(), balanceBefore);

    store.resetBalance();
    suite.eq('resetBalance restores 1 000 000', store.getBalance(), STARTING_BALANCE);

    store.resetAll();
    suite.eq('resetAll clears the history', store.getHistory().length, 0);
    suite.eq('resetAll clears the stats', store.getStats().totalSpins, 0);
  }
}

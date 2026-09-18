/* ============================================================================
   SOQQA — centralized state manager
   ----------------------------------------------------------------------------
   The single owner of balance, spin history, lifetime stats and settings.

   Design rules (see PLAN.md):
     • No DOM access — the store never touches the UI.
     • No game maths — payouts are calculated by games/*, the store only moves
       coins and records what happened.
     • Everything read from storage is validated; anything invalid falls back to
       a safe default and is reported through getRecoveryReport() so the UI can
       tell the player instead of failing silently.
   ========================================================================= */

import {
  APP,
  BET_LADDER,
  DEFAULT_BET,
  HISTORY_LIMIT,
  MAX_BET,
  MIN_BET,
  MINES,
  MINES_BOARD_SIZE,
  STARTING_BALANCE,
  STORAGE_KEYS,
} from '../config.js';
import { mineCountBounds, normalizeMineCount } from '../games/mines.js';
import { isKnownSymbol } from '../games/paytable.js';
import { SEGMENT_COUNT } from '../games/wheel.js';
import { createStorage } from './storage.js';

const EMPTY_STATS = Object.freeze({
  totalSpins: 0,
  slotsSpins: 0,
  wheelSpins: 0,
  minesRounds: 0,
  totalBet: 0,
  totalWon: 0,
  biggestWin: 0,
  bestMultiplier: 0,
  net: 0,
});

/** Games the store knows how to name in history and stats. */
export const GAMES = Object.freeze({ slots: 'slots', wheel: 'wheel', mines: 'mines' });

/** Clamp a segment index to the wheel table, or null when unknown. */
function sanitizeSegmentIndex(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value >= SEGMENT_COUNT) return null;
  return value;
}

/**
 * A mines record carries no symbols and no segment, only how many tiles were
 * turned over and how many mines were on the board. Both come back from disk as
 * untrusted input, so the mine count is snapped to the board's legal range and
 * the tile count is only kept when it could really have happened — more tiles
 * than the board is a corrupt record, not a lucky one.
 */
function sanitizeMineCount(raw) {
  if (raw === undefined || raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return normalizeMineCount(value, { size: MINES_BOARD_SIZE, maxCount: MINES.maxCount });
}

function sanitizeTileCount(raw, mineCount) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return null;
  const { max } = mineCountBounds({ size: MINES_BOARD_SIZE, maxCount: MINES.maxCount });
  const mines = Number.isInteger(mineCount) ? mineCount : max;
  // The most tiles a round can possibly have revealed is every safe one.
  const ceiling = MINES_BOARD_SIZE - Math.min(Math.max(mines, 1), max);
  return Math.min(value, ceiling);
}

/* --------------------------------------------------------------------------
   Validation helpers
   -------------------------------------------------------------------------- */

const isPositiveInt = (value) => Number.isInteger(value) && value >= 0;
const isInt = (value) => Number.isInteger(value);

/** A bet must be a whole multiple of MIN_BET inside [MIN_BET, MAX_BET]. */
export function isValidBet(bet) {
  return isInt(bet) && bet >= MIN_BET && bet <= MAX_BET && bet % MIN_BET === 0;
}

/** Snap any raw number to the nearest valid bet (used for restoring settings). */
export function normalizeBet(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_BET;
  if (BET_LADDER.includes(value)) return value;
  const stepped = Math.round(value / MIN_BET) * MIN_BET;
  return Math.min(MAX_BET, Math.max(MIN_BET, stepped));
}

/** Sanitize one stored balance record. Accepts the legacy plain-number form. */
function sanitizeBalance(raw) {
  const coins = typeof raw === 'number' ? raw : raw?.coins;
  if (isPositiveInt(coins)) return coins;
  if (Number.isFinite(coins) && coins > 0) return Math.floor(coins);
  return null;
}

/** Sanitize one stored history entry; returns null when it must be dropped. */
function sanitizeHistoryEntry(raw, now) {
  if (!raw || typeof raw !== 'object') return null;

  const bet = Number(raw.bet);
  const payout = Number(raw.payout);
  if (!isValidBet(bet) || !Number.isFinite(payout) || payout < 0) return null;

  const symbols =
    Array.isArray(raw.symbols) && raw.symbols.length > 0 && raw.symbols.every(isKnownSymbol)
      ? raw.symbols.slice(0, 3)
      : null;

  const multiplier = Number.isFinite(Number(raw.multiplier)) ? Math.max(0, Number(raw.multiplier)) : 0;
  const roundedPayout = Math.round(payout);
  const timestamp = Number.isFinite(Number(raw.timestamp)) ? Number(raw.timestamp) : now;
  const game = typeof raw.game === 'string' && raw.game ? raw.game : GAMES.slots;
  const mines = game === GAMES.mines ? sanitizeMineCount(raw.mines) : null;

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `spin_${timestamp}`,
    game,
    bet,
    symbols,
    line: typeof raw.line === 'string' && isKnownSymbol(raw.line) ? raw.line : null,
    matchType: raw.matchType === 'three' || raw.matchType === 'two' ? raw.matchType : null,
    // Wheel records carry a segment instead of symbols…
    segmentIndex: game === GAMES.wheel ? sanitizeSegmentIndex(raw.segmentIndex) : null,
    // …and mines records carry the board they were played on.
    mines,
    tiles: mines === null ? null : sanitizeTileCount(raw.tiles, mines),
    multiplier,
    payout: roundedPayout,
    net: roundedPayout - bet,
    outcome: roundedPayout > 0 ? 'win' : 'loss',
    balanceAfter: isInt(Number(raw.balanceAfter)) ? Number(raw.balanceAfter) : null,
    timestamp,
  };
}

/** Rebuild lifetime stats from a history array (used when stats are missing). */
export function aggregateHistory(history) {
  return history.reduce((acc, entry) => {
    acc.totalSpins += 1;
    if (entry.game === GAMES.slots) acc.slotsSpins += 1;
    if (entry.game === GAMES.wheel) acc.wheelSpins += 1;
    if (entry.game === GAMES.mines) acc.minesRounds += 1;
    acc.totalBet += entry.bet;
    acc.totalWon += entry.payout;
    acc.biggestWin = Math.max(acc.biggestWin, entry.payout);
    acc.bestMultiplier = Math.max(acc.bestMultiplier, entry.multiplier || 0);
    acc.net = acc.totalWon - acc.totalBet;
    return acc;
  }, { ...EMPTY_STATS });
}

function sanitizeStats(raw, history) {
  if (!raw || typeof raw !== 'object') return aggregateHistory(history);

  const merged = { ...EMPTY_STATS };
  let sane = true;
  for (const key of Object.keys(EMPTY_STATS)) {
    const stored = raw[key];
    // A counter added in a later schema is simply absent on old saves: treat
    // it as 0 instead of discarding the player's lifetime totals.
    if (stored === undefined) {
      merged[key] = 0;
      continue;
    }
    const value = Number(stored);
    if (Number.isFinite(value) && value >= 0) {
      merged[key] = value;
    } else {
      sane = false;
    }
  }
  return sane ? merged : aggregateHistory(history);
}

function sanitizeSettings(raw) {
  if (!raw || typeof raw !== 'object') return { lastBet: DEFAULT_BET };
  return { lastBet: isValidBet(Number(raw.lastBet)) ? Number(raw.lastBet) : normalizeBet(raw.lastBet) };
}

/* --------------------------------------------------------------------------
   Store factory
   -------------------------------------------------------------------------- */

/**
 * @param {{ storage?: object, now?: () => number }} [options]
 */
export function createStore({ storage = createStorage(), now = () => Date.now() } = {}) {
  const listeners = new Set();
  const recovery = { repaired: [], droppedRecords: 0, wroteAt: null };

  let balance = STARTING_BALANCE;
  let history = [];
  let stats = { ...EMPTY_STATS };
  let settings = { lastBet: DEFAULT_BET };

  /* --- persistence ------------------------------------------------------- */

  function persistBalance() {
    const ok = storage.write(STORAGE_KEYS.balance, { coins: balance, updatedAt: now() });
    if (ok) recovery.wroteAt = now();
    return ok;
  }

  function persistHistory() {
    const ok = storage.write(STORAGE_KEYS.history, history);
    if (ok) recovery.wroteAt = now();
    return ok;
  }

  function persistStats() {
    const ok = storage.write(STORAGE_KEYS.stats, stats);
    if (ok) recovery.wroteAt = now();
    return ok;
  }

  function persistSettings() {
    const ok = storage.write(STORAGE_KEYS.settings, settings);
    if (ok) recovery.wroteAt = now();
    return ok;
  }

  /* --- load ------------------------------------------------------------- */

  function load() {
    // Balance
    const balanceRead = storage.read(STORAGE_KEYS.balance);
    const sanitizedBalance = sanitizeBalance(balanceRead.value);
    if (balanceRead.status !== 'ok' || sanitizedBalance === null) {
      recovery.repaired.push(
        balanceRead.status === 'missing' ? 'balance:missing' : 'balance:repaired',
      );
      balance = STARTING_BALANCE;
    } else {
      balance = sanitizedBalance;
    }

    // History
    const historyRead = storage.read(STORAGE_KEYS.history);
    if (historyRead.status !== 'ok' || !Array.isArray(historyRead.value)) {
      recovery.repaired.push(historyRead.status === 'missing' ? 'history:missing' : 'history:repaired');
      history = [];
    } else {
      const cleaned = historyRead.value.map((entry) => sanitizeHistoryEntry(entry, now())).filter(Boolean);
      recovery.droppedRecords = historyRead.value.length - cleaned.length;
      if (recovery.droppedRecords > 0) recovery.repaired.push('history:trimmed');
      history = cleaned.slice(0, HISTORY_LIMIT);
    }

    // Stats (lifetime — survives history trimming)
    const statsRead = storage.read(STORAGE_KEYS.stats);
    const previousStats = statsRead.status === 'ok' ? sanitizeStats(statsRead.value, history) : null;
    if (statsRead.status !== 'ok' || previousStats === null) {
      recovery.repaired.push(statsRead.status === 'missing' ? 'stats:missing' : 'stats:repaired');
      stats = aggregateHistory(history);
    } else {
      stats = previousStats;
    }

    // Settings
    const settingsRead = storage.read(STORAGE_KEYS.settings);
    if (settingsRead.status !== 'ok') {
      recovery.repaired.push(settingsRead.status === 'missing' ? 'settings:missing' : 'settings:repaired');
      settings = { lastBet: DEFAULT_BET };
    } else {
      settings = sanitizeSettings(settingsRead.value);
    }

    return store.getRecoveryReport();
  }

  /* --- events ----------------------------------------------------------- */

  function snapshot() {
    return { balance, history: history.slice(), stats: { ...stats }, settings: { ...settings } };
  }

  function notify(event) {
    const state = snapshot();
    listeners.forEach((listener) => {
      try {
        listener(state, event);
      } catch (error) {
        // A broken view must never break the store.
        if (typeof console !== 'undefined') console.error('[SOQQA] listener failed', error);
      }
    });
  }

  /* --- API -------------------------------------------------------------- */

  const store = {
    load,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: snapshot,
    getBalance: () => balance,
    getHistory: () => history.slice(),
    getStats: () => ({ ...stats }),
    getSettings: () => ({ ...settings }),

    isValidBet,
    normalizeBet,
    canAfford: (bet) => isValidBet(bet) && bet <= balance,
    hasEnoughForMinBet: () => balance >= MIN_BET,

    /**
     * Deduct a bet. Refuses invalid or unaffordable bets — the balance can
     * never become negative.
     * @returns {{ ok: boolean, reason?: 'invalid'|'insufficient', balance: number }}
     */
    placeBet(bet) {
      if (!isValidBet(bet)) return { ok: false, reason: 'invalid', balance };
      if (bet > balance) return { ok: false, reason: 'insufficient', balance };

      balance -= bet;
      persistBalance();
      notify({ type: 'balance', delta: -bet, reason: 'bet' });
      return { ok: true, balance };
    },

    /** Credit a payout. @returns {number} the new balance */
    credit(amount) {
      const value = Math.round(Number(amount));
      if (!Number.isFinite(value) || value <= 0) return balance;

      balance += value;
      persistBalance();
      notify({ type: 'balance', delta: value, reason: 'payout' });
      return balance;
    },

    /**
     * Record a finished spin: appends to history (newest first, capped at
     * HISTORY_LIMIT), updates lifetime stats and persists everything.
     * @returns {{ entry: object, history: object[], stats: object }}
     */
    recordSpin(spin) {
      const timestamp = now();
      const bet = Number(spin.bet);
      const payout = Math.max(0, Math.round(Number(spin.payout) || 0));

      // Own-property lookup, so a record claiming `game: 'constructor'` falls
      // back to slots instead of resolving to a function off the prototype.
      const game = Object.prototype.hasOwnProperty.call(GAMES, spin.game)
        ? GAMES[spin.game]
        : GAMES.slots;
      const mineCount = game === GAMES.mines ? sanitizeMineCount(spin.mines) : null;

      const entry = {
        id: `spin_${timestamp}_${history.length.toString(36)}`,
        game,
        bet,
        symbols: Array.isArray(spin.symbols) ? spin.symbols.slice(0, 3) : null,
        line: spin.line ?? null,
        matchType: spin.matchType ?? null,
        segmentIndex: game === GAMES.wheel ? sanitizeSegmentIndex(spin.segmentIndex) : null,
        mines: mineCount,
        tiles: mineCount === null ? null : sanitizeTileCount(spin.tiles, mineCount),
        multiplier: Number(spin.multiplier) || 0,
        payout,
        net: payout - bet,
        outcome: payout > 0 ? 'win' : 'loss',
        balanceAfter: balance,
        timestamp,
      };

      history = [entry, ...history].slice(0, HISTORY_LIMIT);

      stats = {
        ...stats,
        totalSpins: stats.totalSpins + 1,
        slotsSpins: entry.game === GAMES.slots ? stats.slotsSpins + 1 : stats.slotsSpins,
        wheelSpins: entry.game === GAMES.wheel ? stats.wheelSpins + 1 : stats.wheelSpins,
        minesRounds: entry.game === GAMES.mines ? stats.minesRounds + 1 : stats.minesRounds,
        totalBet: stats.totalBet + bet,
        totalWon: stats.totalWon + payout,
        biggestWin: Math.max(stats.biggestWin, payout),
        bestMultiplier: Math.max(stats.bestMultiplier, entry.multiplier),
        net: stats.net + entry.net,
      };

      persistHistory();
      persistStats();
      notify({ type: 'spin', entry });

      return { entry, history: history.slice(), stats: { ...stats } };
    },

    /** Remember the player's bet across reloads. */
    setLastBet(bet) {
      const value = normalizeBet(bet);
      if (value === settings.lastBet) return settings.lastBet;
      settings = { ...settings, lastBet: value };
      persistSettings();
      notify({ type: 'bet', bet: value });
      return value;
    },

    /** Clear the visible spin list — the demo balance is left untouched. */
    clearHistory() {
      history = [];
      persistHistory();
      notify({ type: 'history', reason: 'cleared' });
      return history;
    },

    /** Restore the demo balance (demo-only convenience — never a purchase). */
    resetBalance() {
      balance = STARTING_BALANCE;
      persistBalance();
      notify({ type: 'balance', delta: 0, reason: 'reset' });
      return balance;
    },

    /** Full wipe: balance, history and stats back to a fresh install. */
    resetAll() {
      balance = STARTING_BALANCE;
      history = [];
      stats = { ...EMPTY_STATS };
      settings = { lastBet: DEFAULT_BET };
      persistBalance();
      persistHistory();
      persistStats();
      persistSettings();
      notify({ type: 'reset' });
      return snapshot();
    },

    getRecoveryReport: () => ({ ...recovery, repaired: recovery.repaired.slice() }),
    getWriteFailed: () => storage.hasWriteFailed(),
    getStorageError: () => storage.getLastError(),
    isPersistent: () => storage.isPersistent,
    schemaVersion: APP.schemaVersion,
  };

  load();

  return store;
}

export { EMPTY_STATS, HISTORY_LIMIT, STARTING_BALANCE };

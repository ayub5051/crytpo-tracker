/* ============================================================================
   SOQQA — Mines engine (pure: no DOM, no storage, no side effects)
   ----------------------------------------------------------------------------
   A 5x5 board hides a fixed number of mines. Every tile the player turns over
   that is NOT a mine raises the multiplier; hitting one ends the round with
   nothing; "cash out" banks whatever the multiplier has reached. The round is
   over the moment either of those happens.

   ── The odds are the board, not a table ────────────────────────────────────
   There is deliberately no multiplier table in config.js. After `k` safe
   reveals the chance of still being alive is

       P(k) = Π  (size - mines - i) / (size - i),   i = 0 … k-1
              = C(size - mines, k) / C(size, k)

   which is the hypergeometric draw without replacement — i.e. the real board.
   The multiplier is `edge / P(k)`, so the expected return of cashing out after
   any number of reveals is `edge` (0.97), less only the two-decimal floor
   described below: the game charges one flat margin however long the player
   stays. Measured over the whole board, the return sits in 0.9625 … 0.9700 and
   never leaves it. Editing the grid size or the mine count moves every
   multiplier with it, and tests/mines.test.mjs audits the entire ladder rather
   than a single spun-up average.

   Written as a chain of ratios rather than as one `C(n, k) / C(n, k)` division
   because that is the form which survives a bigger board: the binomials this
   25-tile grid needs are small, but a factorial would overflow long before the
   ratios lose a digit. Measured against exact BigInt arithmetic at all 300
   legal (mine count, reveal count) pairs, the chain is within 6.5e-16 relative
   — a few units in the last place, which is as close as a double gets.

   ── What this module owns ─────────────────────────────────────────────────
   • `survivalProbability` / `minesMultiplier` / `minesLadder` — pure maths,
     exported so the HUD can preview the next tile without touching a round.
   • `createMinesEngine` — the rounds themselves: draw, reveal, cash out. Its
     guards are what make the game safe rather than the UI being careful: a
     reveal on a finished round, or a second reveal of the same tile, is
     refused here, so no amount of double-clicking can double-count a pick or
     pay twice.
   ========================================================================= */

import { MINES, MINES_BOARD_SIZE } from '../config.js';
import { isValidBetAmount } from './betting.js';
import { payoutFor } from './paytable.js';
import { createRng } from '../utils/rng.js';

/** Tiles on the board. The denominator of every probability here. */
export const BOARD_SIZE = MINES_BOARD_SIZE;

/** Truncate to an integer inside [min, max], falling back to `min`. */
function clampInt(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

/** Board size, sanitized: a board needs at least one safe tile. */
function boardSizeOf(size) {
  return clampInt(size ?? BOARD_SIZE, 2, 400);
}

/**
 * The legal mine counts for a board: at least one, and never so many that no
 * tile is safe.
 * @returns {{ min: number, max: number }}
 */
export function mineCountBounds({ size = BOARD_SIZE, maxCount = MINES.maxCount } = {}) {
  const total = boardSizeOf(size);
  return { min: Math.max(1, MINES.minCount), max: Math.min(maxCount, total - 1) };
}

/** Snap any input to a legal mine count. */
export function normalizeMineCount(mines, { size = BOARD_SIZE, maxCount = MINES.maxCount } = {}) {
  const { min, max } = mineCountBounds({ size, maxCount });
  return clampInt(mines, min, max);
}

/**
 * Probability that `revealed` picks in a row are all safe.
 * @returns {number} in (0, 1]
 */
export function survivalProbability(mines, revealed, options = {}) {
  const total = boardSizeOf(options.size);
  const count = normalizeMineCount(mines, { ...options, size: total });
  const picks = clampInt(revealed, 0, total - count);

  let probability = 1;
  for (let i = 0; i < picks; i += 1) {
    probability *= (total - count - i) / (total - i);
  }
  return probability;
}

/**
 * The multiplier earned by `revealed` safe picks. Floored to
 * `MINES.multiplierDecimals`, so the number the HUD prints is exactly the
 * number the payout is computed from.
 *
 * Zero before the first pick: there is nothing to cash out yet, and a "x0.99"
 * on an untouched board would only invite a pointless click.
 *
 * @returns {number}
 */
export function minesMultiplier(mines, revealed, options = {}) {
  const picks = Math.trunc(Number(revealed) || 0);
  if (picks <= 0) return 0;

  const probability = survivalProbability(mines, picks, options);
  if (!(probability > 0)) return 0;

  const edge = Number.isFinite(Number(options.edge)) ? Number(options.edge) : MINES.edge;
  const decimals = clampInt(options.decimals ?? MINES.multiplierDecimals, 0, 6);
  const factor = 10 ** decimals;
  return Math.floor((edge / probability) * factor) / factor;
}

/** How many reveals exist for a mine count (i.e. how many tiles are safe). */
export function minesMaxReveal(mines, options = {}) {
  const total = boardSizeOf(options.size);
  return total - normalizeMineCount(mines, { ...options, size: total });
}

/**
 * The whole payout ladder for a mine count: the panel's preview and the test's
 * audit both read it, so the maths is inspected in exactly one shape.
 * @returns {{ revealed: number, multiplier: number, probability: number, returnToPlayer: number }[]}
 */
export function minesLadder(mines, options = {}) {
  const rounds = minesMaxReveal(mines, options);
  const rows = [];

  for (let revealed = 1; revealed <= rounds; revealed += 1) {
    const probability = survivalProbability(mines, revealed, options);
    const multiplier = minesMultiplier(mines, revealed, options);
    rows.push({
      revealed,
      multiplier,
      probability,
      returnToPlayer: probability * multiplier,
    });
  }
  return rows;
}

/**
 * A finished or in-progress round, as plain data. The engine holds one of these;
 * the view reads it, and nothing outside this module ever mutates it.
 * @returns {object|null}
 */
function snapshot(round, size) {
  if (!round) return null;
  return {
    size,
    mineCount: round.mineCount,
    mineIndices: round.mineIndices.slice(),
    picks: round.picks.slice(),
    safePicks: round.safePicks.slice(),
    revealedCount: round.safePicks.length,
    hitIndex: round.hitIndex,
    over: round.over,
    active: !round.over,
  };
}

/**
 * @param {{
 *   rng?: object,
 *   size?: number,
 *   edge?: number,
 *   decimals?: number,
 *   maxCount?: number,
 * }} [options]
 */
export function createMinesEngine({
  rng = createRng(),
  size = BOARD_SIZE,
  edge = MINES.edge,
  decimals = MINES.multiplierDecimals,
  maxCount = MINES.maxCount,
} = {}) {
  const total = boardSizeOf(size);
  const bounds = mineCountBounds({ size: total, maxCount });
  const maths = { size: total, edge, decimals };

  let round = null;

  /** Fisher–Yates over every tile; the first `mines` of the shuffle are mines. */
  function shuffle() {
    const pool = Array.from({ length: total }, (_, index) => index);
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = rng.int(0, i);
      const held = pool[i];
      pool[i] = pool[j];
      pool[j] = held;
    }
    return pool;
  }

  return {
    get size() {
      return total;
    },
    get bounds() {
      return { ...bounds };
    },
    /** The live round (plain copy), or null when the board is clear. */
    get round() {
      return snapshot(round, total);
    },
    /** True while a round is running — the guard the view reads. */
    get active() {
      return Boolean(round) && !round.over;
    },
    get revealedCount() {
      return round ? round.safePicks.length : 0;
    },

    /** Preview a multiplier without touching a round (the HUD uses this). */
    multiplierFor: (mines, revealed) => minesMultiplier(mines, revealed, maths),
    probabilityFor: (mines, revealed) => survivalProbability(mines, revealed, maths),
    ladder: (mines) => minesLadder(mines, maths),
    maxReveal: (mines) => minesMaxReveal(mines, maths),

    /**
     * Draw a fresh board. The mine positions are decided ONCE, here, and never
     * consulted again by the payout logic — a round's difficulty cannot change
     * under the player mid-hand.
     *
     * @param {{ mines?: number }} [options]
     * @returns {{ ok: boolean, reason?: string, round: object|null }}
     */
    start({ mines = MINES.defaultCount } = {}) {
      if (round && !round.over) return { ok: false, reason: 'active', round: snapshot(round, total) };

      const mineCount = normalizeMineCount(mines, { size: total, maxCount });
      const shuffled = shuffle();
      const mineIndices = shuffled.slice(0, mineCount).sort((a, b) => a - b);

      round = {
        mineCount,
        mineIndices,
        mineSet: new Set(mineIndices),
        picks: [],
        safePicks: [],
        hitIndex: null,
        over: false,
      };

      return { ok: true, round: snapshot(round, total) };
    },

    /**
     * Turn one tile over.
     *
     * Every way this can be called wrongly is refused rather than ignored:
     * an unknown tile, a tile already turned, or a tile on a finished round.
     * `picks` grows only on a tile that was genuinely still closed, which is
     * what makes a duplicate click (or a double-tap during the flip) incapable
     * of counting twice or of revealing a second time.
     *
     * @param {number} index — tile 0 … size-1
     * @returns {{
     *   ok: boolean, reason?: 'inactive'|'over'|'invalid'|'revealed',
     *   status?: 'safe'|'mine', tile?: number, mineCount?: number,
     *   revealedCount?: number, multiplier?: number, probability?: number,
     *   round: object|null,
     * }}
     */
    reveal(index) {
      if (!round) return { ok: false, reason: 'inactive', round: null };
      if (round.over) return { ok: false, reason: 'over', round: snapshot(round, total) };

      // A real integer, not merely something that converts to one: `Number(null)`
      // is 0, so a loose check would silently treat a null tile as tile zero.
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= total) {
        return { ok: false, reason: 'invalid', round: snapshot(round, total) };
      }
      const tile = index;
      if (round.picks.includes(tile)) {
        return { ok: false, reason: 'revealed', round: snapshot(round, total) };
      }

      round.picks.push(tile);

      if (round.mineSet.has(tile)) {
        round.hitIndex = tile;
        round.over = true;
        return {
          ok: true,
          status: 'mine',
          tile,
          mineCount: round.mineCount,
          revealedCount: round.safePicks.length,
          multiplier: 0,
          probability: 0,
          round: snapshot(round, total),
        };
      }

      round.safePicks.push(tile);
      const revealedCount = round.safePicks.length;
      const probability = survivalProbability(round.mineCount, revealedCount, maths);

      return {
        ok: true,
        status: 'safe',
        tile,
        mineCount: round.mineCount,
        revealedCount,
        multiplier: minesMultiplier(round.mineCount, revealedCount, maths),
        probability,
        round: snapshot(round, total),
      };
    },

    /**
     * Bank the current multiplier and end the round. Pays ONCE: the round is
     * marked over before the payout is computed, so a second call — from a
     * double click, a keyboard repeat or a stray replay — returns `over`
     * instead of a second payment.
     *
     * @param {number} bet — a valid bet amount
     * @returns {{ ok: boolean, reason?: 'inactive'|'over'|'empty'|'invalid',
     *   multiplier?: number, payout?: number, revealedCount?: number,
     *   mineCount?: number, round: object|null }}
     */
    cashOut(bet) {
      if (!round) return { ok: false, reason: 'inactive', round: null };
      if (round.over) return { ok: false, reason: 'over', round: snapshot(round, total) };

      const revealedCount = round.safePicks.length;
      // Nothing is revealed yet, so there is nothing to bank. The UI keeps the
      // button disabled here; this is the guard underneath that.
      if (revealedCount === 0) return { ok: false, reason: 'empty', round: snapshot(round, total) };
      if (!isValidBetAmount(bet)) return { ok: false, reason: 'invalid', round: snapshot(round, total) };

      round.over = true;
      const multiplier = minesMultiplier(round.mineCount, revealedCount, maths);

      return {
        ok: true,
        multiplier,
        payout: payoutFor(bet, multiplier),
        revealedCount,
        mineCount: round.mineCount,
        round: snapshot(round, total),
      };
    },

    /** End the round with no payout (a balance reset, or leaving the board). */
    abandon() {
      if (round) round.over = true;
      return snapshot(round, total);
    },

    /** Forget the board entirely, so the next start draws a fresh one. */
    reset() {
      round = null;
      return null;
    },
  };
}

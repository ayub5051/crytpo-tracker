/* ============================================================================
   SOQQA — paytable (pure, no DOM, no storage)
   ----------------------------------------------------------------------------
   Line evaluation rules (documented so the maths stays auditable):

   1. TRIPLE — the line pays when all three reels match a symbol, where the
      wild substitutes for any other symbol. The symbol of the line is the
      first non-wild reel; three wilds pay the wild's own triple payout.
   2. PAIR — if no triple is paid, the first two reels pay the pair table when
      they match (wild completes the other reel). A pair of wilds only falls
      through to the pair table when the third reel is unpaid.
   3. Anything else is a loss (payout 0).

   Because the wild never substitutes for itself, [wild, wild, cherry] is a
   cherry triple, not a wild triple — that keeps the odds easy to reason about.
   ========================================================================= */

import { SYMBOLS, SYMBOL_ORDER, WILD_ID } from '../config.js';

/** @returns {object|null} symbol entry for an id, or null when unknown */
export function getSymbol(id) {
  return Object.prototype.hasOwnProperty.call(SYMBOLS, id) ? SYMBOLS[id] : null;
}

/** @returns {boolean} */
export function isKnownSymbol(id) {
  return getSymbol(id) !== null;
}

/**
 * @param {string[]} symbols — three symbol ids, left to right
 * @returns {{ line: string|null, matchType: 'three'|'two'|null, multiplier: number }}
 */
export function evaluateLine(symbols) {
  const line = Array.isArray(symbols) ? symbols : [];
  if (line.length === 0 || !line.every(isKnownSymbol)) {
    return { line: null, matchType: null, multiplier: 0 };
  }

  // --- 1. triple ----------------------------------------------------------
  const anchor = line.find((id) => id !== WILD_ID) ?? WILD_ID;
  const isTriple = line.every((id) => id === anchor || id === WILD_ID);
  if (isTriple) {
    const multiplier = getSymbol(anchor).triple;
    if (multiplier > 0) return { line: anchor, matchType: 'three', multiplier };
  }

  // --- 2. pair on the first two reels ------------------------------------
  const pairSymbol = matchPair(line[0], line[1]);
  if (pairSymbol) {
    const multiplier = getSymbol(pairSymbol).pair;
    if (multiplier > 0) return { line: pairSymbol, matchType: 'two', multiplier };
  }

  // --- 3. loss -----------------------------------------------------------
  return { line: null, matchType: null, multiplier: 0 };
}

/**
 * Two reels match when they are identical, or when one of them is a wild.
 * @returns {string|null} the paying symbol id, or null when they don't match
 */
function matchPair(first, second) {
  if (first === second) return first;
  if (first === WILD_ID) return second;
  if (second === WILD_ID) return first;
  return null;
}

/**
 * @param {number} bet — validated bet amount
 * @param {number} multiplier
 * @returns {number} integer payout (rounded in the player's favour)
 */
export function payoutFor(bet, multiplier) {
  const amount = Math.round(Math.abs(Number(bet) || 0) * (Number(multiplier) || 0));
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

/** Rows for the in-app payout table, driven by config (never hand-written). */
export function paytableRows() {
  return SYMBOL_ORDER.map((id) => {
    const symbol = SYMBOLS[id];
    return {
      id: symbol.id,
      emoji: symbol.emoji,
      name: symbol.name,
      triple: symbol.triple,
      pair: symbol.pair,
    };
  });
}

/* ============================================================================
   SOQQA — slots engine (pure, no DOM, no storage, no side effects)
   ----------------------------------------------------------------------------
   spin(bet) draws one symbol per reel from the weighted table in config.js,
   then evaluates the middle line with games/paytable.js.

   The engine never touches the balance, the history or the DOM: the caller
   decides when to deduct and when to credit. That keeps the maths testable and
   the payout table the single source of truth.
   ========================================================================= */

import { REEL_COUNT, SYMBOL_ORDER, SYMBOLS } from '../config.js';
import { isValidBetAmount } from './betting.js';
import { evaluateLine, payoutFor } from './paytable.js';
import { createRng } from '../utils/rng.js';

/**
 * @param {{ rng?: object, symbols?: string[] }} [options]
 *   rng     — injectable generator (use createSeededRng for reproducibility)
 *   symbols — override the draw order (handy for tests)
 */
export function createSlotsEngine({ rng = createRng(), symbols = SYMBOL_ORDER } = {}) {
  const order = Array.isArray(symbols) && symbols.length > 0 ? symbols.slice() : SYMBOL_ORDER.slice();
  const weights = order.map((id) => (Object.prototype.hasOwnProperty.call(SYMBOLS, id) ? SYMBOLS[id].weight : 0));

  /** One weighted draw for a single reel. */
  const drawSymbol = () => {
    const index = rng.weightedIndex(weights);
    return index >= 0 ? order[index] : order[order.length - 1];
  };

  return {
    /** Draw order used by this engine (left → right). */
    getSymbols: () => order.slice(),
    getWeights: () => weights.slice(),

    /**
     * Execute one spin. Deterministic for a given RNG sequence.
     * @param {number} bet — a valid bet amount (see store.isValidBet)
     * @returns {{
     *   symbols: string[],
     *   line: string|null,
     *   matchType: 'three'|'two'|null,
     *   multiplier: number,
     *   payout: number,
     *   net: number,
     *   outcome: 'win'|'loss'
     * }}
     */
    spin(bet) {
      if (!isValidBetAmount(bet)) {
        throw new RangeError(`Noto\u2019g\u2019ri tikish miqdori: ${bet}`);
      }

      const symbols3 = Array.from({ length: REEL_COUNT }, drawSymbol);
      const { line, matchType, multiplier } = evaluateLine(symbols3);
      const payout = matchType ? payoutFor(bet, multiplier) : 0;

      return {
        symbols: symbols3,
        line,
        matchType,
        multiplier: matchType ? multiplier : 0,
        payout,
        net: payout - bet,
        outcome: payout > 0 ? 'win' : 'loss',
      };
    },
  };
}

/**
 * Engine-level bet guard (shared with the wheel — see games/betting.js).
 * Re-exported so existing importers of this module keep working.
 * @returns {boolean}
 */
export { isValidBetAmount };

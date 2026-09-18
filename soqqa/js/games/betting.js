/* ============================================================================
   SOQQA — shared betting rule (pure, no DOM, no storage)
   ----------------------------------------------------------------------------
   Every game engine validates the stake with the same rule the store applies
   against the balance. Keeping it in one place means the slots cabinet and the
   wheel can never disagree about what a legal bet is.
   ========================================================================= */

import { MAX_BET, MIN_BET } from '../config.js';

/**
 * A bet is a whole number of coins, a multiple of MIN_BET, inside the ladder.
 * @returns {boolean}
 */
export function isValidBetAmount(bet) {
  return (
    Number.isInteger(bet) &&
    bet >= MIN_BET &&
    bet <= MAX_BET &&
    bet % MIN_BET === 0
  );
}

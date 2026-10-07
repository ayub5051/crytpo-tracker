/* ============================================================================
   BLAZZER — Upgrade rules
   The single definition of how an Upgrade is priced. Deliberately DOM-free and
   dependency-free so the exact same module can be imported by the browser AND
   by the server (server/upgrade/manager.js), which is what guarantees the odds
   a player is shown are the odds they are settled against — a mismatch there
   would be the worst possible bug in a provably-fair game.

   The deal:
     stake   = the summed catalogue value of the items you put in
     target  = the item you are aiming for
     chance  = stake / targetValue × HOUSE_EDGE      (the house keeps 5%)

   The stake is consumed on BOTH outcomes. That is what makes the maths work:
   a win returns an item worth `targetValue` with probability `chance`, so the
   expected return is chance × targetValue = stake × HOUSE_EDGE — a constant
   95% RTP, at every stake, for every target.
   ========================================================================= */

/** The house's cut, expressed as the fraction of fair odds a player receives. */
export const HOUSE_EDGE = 0.95;

/** Never let a play be a near-certainty, or a near-impossibility. */
export const MIN_CHANCE = 0.02;
export const MAX_CHANCE = 0.95;

/** How many items a single Upgrade may consume. */
export const MIN_INPUTS = 1;
export const MAX_INPUTS = 10;

/** Why an Upgrade attempt was refused. Surfaced verbatim in the UI. */
export const BLOCK = {
  NO_TARGET: 'no_target',
  NO_INPUTS: 'no_inputs',
  TOO_MANY_INPUTS: 'too_many_inputs',
  OVERPAY: 'overpay',
  TOO_LOW: 'too_low',
};

/** Clamp a fraction into the allowed band. */
export function clampChance(chance) {
  return Math.min(MAX_CHANCE, Math.max(MIN_CHANCE, chance));
}

/** The payout multiplier for a given chance (1 / chance). */
export function multiplierOf(chance) {
  return chance > 0 ? 1 / chance : Number.POSITIVE_INFINITY;
}

/**
 * The unclamped chance, before the band is applied.
 * Returns null when there is nothing to aim at.
 *
 * Because this is the ONLY place the ratio is computed, and both the client and
 * the server call it with the same two integers, the two sides always agree to
 * the last bit of the float.
 */
export function rawChance(inputValue, targetValue) {
  if (!(targetValue > 0)) return null;
  return (inputValue / targetValue) * HOUSE_EDGE;
}

/**
 * Assess one Upgrade attempt.
 *
 * @param {object} input
 * @param {number} input.inputValue  summed catalogue value of the stake
 * @param {number} input.targetValue catalogue value of the target item
 * @param {number} [input.inputCount] how many items are staked
 * @returns {{
 *   ok: boolean, reason: string|null, chance: number, multiplier: number,
 *   raw: number|null, rtp: number, expectedReturn: number,
 *   profitOnWin: number, inputValue: number, targetValue: number
 * }}
 */
export function assess({ inputValue, targetValue, inputCount = MIN_INPUTS }) {
  const value = Number(inputValue) || 0;
  const target = Number(targetValue) || 0;
  const count = Number(inputCount) || 0;

  const base = {
    inputValue: value,
    targetValue: target,
    rtp: HOUSE_EDGE,
  };

  if (!(target > 0)) {
    return { ...base, ok: false, reason: BLOCK.NO_TARGET, chance: MIN_CHANCE, multiplier: multiplierOf(MIN_CHANCE), raw: null, expectedReturn: 0, profitOnWin: 0 };
  }
  if (count < MIN_INPUTS) {
    return { ...base, ok: false, reason: BLOCK.NO_INPUTS, chance: MIN_CHANCE, multiplier: multiplierOf(MIN_CHANCE), raw: null, expectedReturn: 0, profitOnWin: 0 };
  }
  if (count > MAX_INPUTS) {
    return { ...base, ok: false, reason: BLOCK.TOO_MANY_INPUTS, chance: MIN_CHANCE, multiplier: multiplierOf(MIN_CHANCE), raw: null, expectedReturn: 0, profitOnWin: 0 };
  }

  const raw = rawChance(value, target);

  // raw > MAX_CHANCE is exactly equivalent to inputValue > targetValue: you are
  // asked to stake more than the thing you are aiming at is worth. Refused, so
  // a play can never be a guaranteed loss and can never be a guaranteed win.
  if (raw > MAX_CHANCE) {
    return { ...base, ok: false, reason: BLOCK.OVERPAY, chance: MAX_CHANCE, multiplier: multiplierOf(MAX_CHANCE), raw, expectedReturn: 0, profitOnWin: target - value };
  }
  if (raw < MIN_CHANCE) {
    return { ...base, ok: false, reason: BLOCK.TOO_LOW, chance: MIN_CHANCE, multiplier: multiplierOf(MIN_CHANCE), raw, expectedReturn: 0, profitOnWin: target - value };
  }

  return {
    ...base,
    ok: true,
    reason: null,
    raw,
    chance: raw,
    multiplier: multiplierOf(raw),
    expectedReturn: raw * target,
    profitOnWin: target - value,
  };
}

/** Human-readable reason for a refusal. */
export function blockMessage(reason) {
  switch (reason) {
    case BLOCK.NO_TARGET:
      return 'Pick an item to aim for first.';
    case BLOCK.NO_INPUTS:
      return 'Add at least one item from your inventory.';
    case BLOCK.TOO_MANY_INPUTS:
      return `You can stake at most ${MAX_INPUTS} items at once.`;
    case BLOCK.OVERPAY:
      return "You'd be staking more than the target is worth — pick a better target or fewer items.";
    case BLOCK.TOO_LOW:
      return `That stake is under the ${Math.round(MIN_CHANCE * 100)}% floor — add another item.`;
    default:
      return 'That combination cannot be played.';
  }
}

/** `0.4429` → `"44.29%"`. */
export function formatChance(chance) {
  return `${(chance * 100).toFixed(2)}%`;
}

/** `0.4429` → `"2.26×"`. */
export function formatMultiplier(multiplier) {
  if (!Number.isFinite(multiplier)) return '—';
  return `${multiplier.toFixed(2)}×`;
}

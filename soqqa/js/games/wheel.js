/* ============================================================================
   SOQQA — Omad charxi engine (pure, no DOM, no storage, no side effects)
   ----------------------------------------------------------------------------
   The wheel is *weighted*: the 12 painted segments are decoration, the odds
   come from `weight` in config.js. spin(bet) picks a segment, computes the
   payout from the segment multiplier and — critically — also returns the exact
   rotation the disc must end on, so the pointer always lands inside the
   segment that was paid out. The result is decided before any animation runs.

   Angle convention (matches CSS `conic-gradient` and `rotate()`):
     0° = 12 o'clock, growing clockwise. Segment i is centred on 30·i degrees.
   ========================================================================= */

import { WHEEL_SEGMENTS, WHEEL_SPIN } from '../config.js';
import { isValidBetAmount } from './betting.js';
import { payoutFor } from './paytable.js';
import { createRng } from '../utils/rng.js';

export const SEGMENT_COUNT = WHEEL_SEGMENTS.length;
export const SEGMENT_ANGLE = 360 / SEGMENT_COUNT;
export const FULL_TURN = 360;

/** Fold any angle into [0, 360). */
export function normalizeAngle(angle) {
  const value = Number(angle) || 0;
  return ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

/** Centre of a segment, clockwise from the top. */
export function segmentAngle(index) {
  const value = Number(index);
  const safe = Number.isFinite(value) ? Math.trunc(value) : 0;
  return normalizeAngle(SEGMENT_ANGLE * safe);
}

/**
 * Disc rotation (mod 360) that brings `index` under the 12 o'clock pointer.
 * The pointer sits at 0°, the segment centre at 30·i, so we rotate backwards
 * by that much.
 */
export function rotationForSegment(index) {
  return normalizeAngle(FULL_TURN - segmentAngle(index));
}

/** Total of the odds table (100 in the shipped config). */
export function wheelWeightTotal(segments = WHEEL_SEGMENTS) {
  return segments.reduce((sum, segment) => sum + Math.max(0, Number(segment.weight) || 0), 0);
}

/**
 * Legend rows: one entry per distinct multiplier with its combined odds, in
 * first-appearance order. Rendered by the legend UI — never hand-written.
 * @returns {{ multiplier: number, weight: number, odds: number }[]}
 */
export function wheelLegend(segments = WHEEL_SEGMENTS) {
  const total = wheelWeightTotal(segments) || 1;
  const grouped = new Map();

  segments.forEach((segment) => {
    const multiplier = Number(segment.multiplier) || 0;
    const entry = grouped.get(multiplier) ?? { multiplier, weight: 0 };
    entry.weight += Math.max(0, Number(segment.weight) || 0);
    grouped.set(multiplier, entry);
  });

  return [...grouped.values()].map((entry) => ({ ...entry, odds: entry.weight / total }));
}

/**
 * @param {{ rng?: object, segments?: { multiplier: number, weight: number }[] }} [options]
 *   rng      — injectable generator (createSeededRng/createStubRng for tests)
 *   segments — override the table (handy for tests)
 */
export function createWheelEngine({ rng = createRng(), segments = WHEEL_SEGMENTS } = {}) {
  const table =
    Array.isArray(segments) && segments.length > 0
      ? segments.map((segment) => ({ ...segment }))
      : WHEEL_SEGMENTS.map((segment) => ({ ...segment }));
  const weights = table.map((segment) => Math.max(0, Number(segment.weight) || 0));

  return {
    /** Table used by this engine (defensive copy). */
    getSegments: () => table.map((segment) => ({ ...segment })),
    getWeights: () => weights.slice(),

    /**
     * Execute one spin. Deterministic for a given RNG sequence: the segment is
     * drawn first, then the turn count, then the landing wobble.
     * @param {number} bet — a valid bet amount (see store.isValidBet)
     * @returns {{\n
     *   segmentIndex: number, multiplier: number, payout: number, net: number,\n
     *   outcome: 'win'|'loss', turns: number, jitter: number, stopAngle: number,\n
     * }}
     */
    spin(bet) {
      if (!isValidBetAmount(bet)) {
        throw new RangeError(`Noto\u2019g\u2019ri tikish miqdori: ${bet}`);
      }

      const drawn = rng.weightedIndex(weights);
      // Defensive: an RNG that returns nothing must not crash the cabinet.
      const segmentIndex = drawn >= 0 ? drawn : Math.max(0, weights.findIndex((weight) => weight > 0));
      const multiplier = Math.max(0, Number(table[segmentIndex]?.multiplier) || 0);
      const payout = multiplier > 0 ? payoutFor(bet, multiplier) : 0;

      const turns = rng.int(WHEEL_SPIN.minTurns, WHEEL_SPIN.maxTurns);
      const jitter = rng.int(-WHEEL_SPIN.jitterDeg, WHEEL_SPIN.jitterDeg);

      return {
        segmentIndex,
        multiplier,
        payout,
        net: payout - bet,
        outcome: payout > 0 ? 'win' : 'loss',
        turns,
        jitter,
        stopAngle: normalizeAngle(rotationForSegment(segmentIndex) + jitter),
      };
    },
  };
}

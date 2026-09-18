/* ============================================================================
   SOQQA — payout table audit
   Enumerates all 7³ = 343 reel combinations with their exact probabilities and
   checks that the configured table returns a sane player return. This test
   fails loudly if someone edits js/config.js into an unfair machine.
   ========================================================================= */

import { RTP_TARGET, SYMBOL_ORDER, SYMBOLS } from '../js/config.js';
import { evaluateLine } from '../js/games/paytable.js';

/** Exact RTP + hit frequency for the configured table. */
export function computeExactRtp() {
  const weights = SYMBOL_ORDER.map((id) => SYMBOLS[id].weight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  let rtp = 0;
  let hitRate = 0;
  let bestMultiplier = 0;
  let bestLine = null;

  for (const first of SYMBOL_ORDER) {
    for (const second of SYMBOL_ORDER) {
      for (const third of SYMBOL_ORDER) {
        const probability =
          (SYMBOLS[first].weight / total) *
          (SYMBOLS[second].weight / total) *
          (SYMBOLS[third].weight / total);

        const { matchType, multiplier } = evaluateLine([first, second, third]);
        const paid = matchType ? multiplier : 0;

        rtp += probability * paid;
        if (paid > 0) hitRate += probability;
        if (paid > bestMultiplier) {
          bestMultiplier = paid;
          bestLine = [first, second, third];
        }
      }
    }
  }

  return { rtp, hitRate, bestMultiplier, bestLine, totalWeight: total };
}

export function runRtpTests(suite) {
  const weights = SYMBOL_ORDER.map((id) => SYMBOLS[id].weight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  suite.eq('symbol weights total 100', totalWeight, 100);
  suite.ok(
    'every symbol has a positive weight',
    weights.every((weight) => Number.isFinite(weight) && weight > 0),
  );
  suite.ok(
    'every symbol has a positive triple payout',
    SYMBOL_ORDER.every((id) => SYMBOLS[id].triple > 0),
  );
  suite.ok(
    "pair payouts never exceed the symbol's triple",
    SYMBOL_ORDER.every((id) => SYMBOLS[id].pair <= SYMBOLS[id].triple),
  );

  const { rtp, hitRate, bestMultiplier, bestLine } = computeExactRtp();

  suite.note(`exact RTP ${(rtp * 100).toFixed(2)}% · hit rate ${(hitRate * 100).toFixed(2)}% · top win ×${bestMultiplier} (${bestLine.join(' + ')})`);

  suite.ok(
    `exact RTP inside the target band (${RTP_TARGET.min}–${RTP_TARGET.max})`,
    rtp >= RTP_TARGET.min && rtp <= RTP_TARGET.max,
    `rtp = ${rtp.toFixed(4)}`,
  );
  suite.ok(
    'RTP stays below 1 (the demo economy cannot inflate)',
    rtp < 1,
    `rtp = ${rtp.toFixed(4)}`,
  );
  suite.ok('hit frequency is at least 12%', hitRate >= 0.12, `hit = ${hitRate.toFixed(4)}`);

  // The paytable must be internally consistent: a triple always beats a pair.
  suite.ok(
    'triple payouts always beat pair payouts',
    SYMBOL_ORDER.every((id) => SYMBOLS[id].triple >= SYMBOLS[id].pair),
  );

  // No NaN can escape `evaluateLine` for any combination.
  const allLines = SYMBOL_ORDER.flatMap((a) => SYMBOL_ORDER.flatMap((b) => SYMBOL_ORDER.map((c) => [a, b, c])));
  suite.ok(
    'every combination evaluates to a finite multiplier',
    allLines.every((line) => Number.isFinite(evaluateLine(line).multiplier)),
  );

  // Unknown symbols must never pay.
  suite.ok('unknown symbols never pay', evaluateLine(['ghost', 'ghost', 'ghost']).multiplier === 0);
  suite.ok('empty lines never pay', evaluateLine([]).multiplier === 0);
}

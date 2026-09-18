/* ============================================================================
   SOQQA — slots engine tests
   Covers: forced outcomes, wild substitution, payout rounding, bet guards,
   seeded determinism and an empirical RTP sanity check.
   ========================================================================= */

import { MIN_BET, RTP_TARGET, SYMBOL_ORDER, SYMBOLS } from '../js/config.js';
import { createSlotsEngine } from '../js/games/slots.js';
import { createSeededRng, createStubRng } from '../js/utils/rng.js';

/** index in SYMBOL_ORDER → id, so tests read like the paytable */
const IDX = Object.fromEntries(SYMBOL_ORDER.map((id, index) => [id, index]));

/** Engine whose three draws are forced to the given symbol ids. */
function forcedEngine(a, b, c) {
  return createSlotsEngine({
    rng: createStubRng([IDX[a], IDX[b], IDX[c]]),
  });
}

export function runSlotsTests(suite) {
  /* --- shape ----------------------------------------------------------- */
  {
    const engine = createSlotsEngine({ rng: createSeededRng(7) });
    const bet = 1_000;
    const spin = engine.spin(bet);

    suite.eq('three symbols per spin', spin.symbols.length, 3);
    suite.ok(
      'only configured symbols appear',
      spin.symbols.every((id) => Object.prototype.hasOwnProperty.call(SYMBOLS, id)),
      spin.symbols.join(','),
    );
    suite.ok('payout is an integer', Number.isInteger(spin.payout));
    suite.ok('payout is never negative', spin.payout >= 0);
    suite.eq('net = payout − bet', spin.net, spin.payout - bet);
    suite.eq(
      'outcome matches the payout',
      spin.outcome,
      spin.payout > 0 ? 'win' : 'loss',
    );
    suite.eq('weights are exposed for auditing', engine.getWeights().length, SYMBOL_ORDER.length);
  }

  /* --- forced outcomes (payout table) --------------------------------- */
  {
    const bet = 1_000;
    const cases = [
      { line: ['seven', 'seven', 'seven'], mult: 60, type: 'three', why: 'seven triple' },
      { line: ['wild', 'seven', 'seven'], mult: 60, type: 'three', why: 'wild completes a seven triple' },
      { line: ['seven', 'wild', 'seven'], mult: 60, type: 'three', why: 'wild in the middle' },
      { line: ['diamond', 'diamond', 'diamond'], mult: 38, type: 'three', why: 'diamond triple' },
      { line: ['bell', 'bell', 'bell'], mult: 18, type: 'three', why: 'bell triple' },
      { line: ['clover', 'clover', 'clover'], mult: 8, type: 'three', why: 'clover triple' },
      { line: ['cherry', 'cherry', 'cherry'], mult: 4, type: 'three', why: 'cherry triple' },
      { line: ['coin', 'coin', 'coin'], mult: 2, type: 'three', why: 'coin triple' },
      { line: ['wild', 'wild', 'wild'], mult: 50, type: 'three', why: 'wild triple' },
      { line: ['bell', 'bell', 'coin'], mult: 5, type: 'two', why: 'bell pair' },
      { line: ['cherry', 'cherry', 'coin'], mult: 1.5, type: 'two', why: 'cherry pair' },
      { line: ['wild', 'diamond', 'coin'], mult: 6, type: 'two', why: 'wild completes a diamond pair' },
      { line: ['coin', 'coin', 'cherry'], mult: 0, type: null, why: 'coin has no pair payout' },
      { line: ['cherry', 'coin', 'bell'], mult: 0, type: null, why: 'no match at all' },
      { line: ['cherry', 'bell', 'cherry'], mult: 0, type: null, why: 'matching outer reels do not pay' },
    ];

    cases.forEach(({ line, mult, type, why }) => {
      const spin = forcedEngine(...line).spin(bet);
      suite.eq(`${why} → ×${mult}`, spin.multiplier, mult);
      suite.eq(`${why} → payout`, spin.payout, Math.round(bet * mult));
      suite.eq(`${why} → match type`, spin.matchType, type);
      suite.eq(`${why} → outcome`, spin.outcome, mult > 0 ? 'win' : 'loss');
    });

    // The wild never substitutes for itself: two wilds + coin is a coin triple.
    const wildWildCoin = forcedEngine('wild', 'wild', 'coin').spin(bet);
    suite.eq('wild+wild+coin pays the coin triple', wildWildCoin.multiplier, 2);
    suite.eq('wild+wild+coin is a three-match', wildWildCoin.matchType, 'three');
  }

  /* --- rounding -------------------------------------------------------- */
  {
    const spin = forcedEngine('cherry', 'cherry', 'coin').spin(25_000);
    suite.eq('25 000 × 1.5 = 37 500', spin.payout, 37_500);
    suite.ok('fractional multipliers still yield integers', Number.isInteger(spin.payout));

    const odd = forcedEngine('cherry', 'cherry', 'coin').spin(MIN_BET);
    suite.eq('1 000 × 1.5 = 1 500', odd.payout, 1_500);
  }

  /* --- bet guards ------------------------------------------------------ */
  {
    const engine = createSlotsEngine({ rng: createSeededRng(1) });
    [0, -1_000, 500, 1_500, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '1000'].forEach((bet) => {
      suite.throws(`engine rejects bet ${String(bet)}`, () => engine.spin(bet), 'RangeError');
    });
  }

  /* --- determinism ----------------------------------------------------- */
  {
    const a = createSlotsEngine({ rng: createSeededRng(2026) });
    const b = createSlotsEngine({ rng: createSeededRng(2026) });

    const first = Array.from({ length: 25 }, () => a.spin(1_000).symbols.join('-'));
    const second = Array.from({ length: 25 }, () => b.spin(1_000).symbols.join('-'));
    suite.eq('the same seed reproduces the same spins', first, second);

    const c = createSlotsEngine({ rng: createSeededRng(99) });
    const different = Array.from({ length: 25 }, () => c.spin(1_000).symbols.join('-'));
    suite.ok('a different seed produces different spins', different.join('|') !== first.join('|'));
  }

  /* --- empirical RTP --------------------------------------------------- */
  {
    const engine = createSlotsEngine({ rng: createSeededRng(4242) });
    const bet = 1_000;
    const spins = 100_000;

    let staked = 0;
    let returned = 0;
    let wins = 0;

    for (let i = 0; i < spins; i += 1) {
      const spin = engine.spin(bet);
      staked += bet;
      returned += spin.payout;
      if (spin.outcome === 'win') wins += 1;
    }

    const rtp = returned / staked;
    const hitRate = wins / spins;

    suite.note(
      `100 000 seeded spins → RTP ${(rtp * 100).toFixed(2)}%, hit rate ${(hitRate * 100).toFixed(2)}%`,
    );

    suite.ok(
      'empirical RTP stays near the configured target',
      Math.abs(rtp - RTP_TARGET.nominal) < 0.06,
      `rtp = ${rtp.toFixed(4)}`,
    );
    suite.ok('hit rate is plausible for a 3-reel slot', hitRate > 0.12 && hitRate < 0.40, `hit = ${hitRate.toFixed(4)}`);
    suite.ok('the house edge keeps the demo balance from exploding', rtp < 1);
  }
}

/* ============================================================================
   SOQQA — Omad charxi engine + persistence
   Audits the odds table (exact RTP, landing geometry), the bet guard and the
   way wheel spins are stored in history and lifetime stats.
   ========================================================================= */

import {
  DEFAULT_BET,
  HISTORY_LIMIT,
  STORAGE_KEYS,
  STARTING_BALANCE,
  WHEEL_BIG_WIN_MULTIPLIER,
  WHEEL_JACKPOT_MULTIPLIER,
  WHEEL_LEGEND_NOTES,
  WHEEL_RTP_TARGET,
  WHEEL_SEGMENTS,
  WHEEL_SPIN,
} from '../js/config.js';
import {
  SEGMENT_ANGLE,
  SEGMENT_COUNT,
  createWheelEngine,
  normalizeAngle,
  rotationForSegment,
  segmentAngle,
  wheelLegend,
  wheelWeightTotal,
} from '../js/games/wheel.js';
import { createStore } from '../js/store/state.js';
import { createMemoryStorage, createStorage } from '../js/store/storage.js';
import { createSeededRng, createStubRng } from '../js/utils/rng.js';

const ROUNDS = 60_000;

/** Shortest signed distance between two angles. */
const angularDelta = (a, b) => ((a - b + 540) % 360) - 180;

const multipliers = WHEEL_SEGMENTS.map((segment) => segment.multiplier);
const weightTotal = wheelWeightTotal();

/** Index of the first segment carrying a given multiplier. */
const indexOfMultiplier = (multiplier) => multipliers.indexOf(multiplier);

export async function runWheelTests(suite) {
  /* --- the odds table ---------------------------------------------------- */
  {
    suite.eq('the wheel has 12 segments', SEGMENT_COUNT, 12);
    suite.eq('segment angle is 30°', SEGMENT_ANGLE, 30);
    suite.ok(
      '12 segments cover the full circle',
      Math.abs(SEGMENT_ANGLE * SEGMENT_COUNT - 360) < 1e-9,
      String(SEGMENT_ANGLE * SEGMENT_COUNT),
    );
    suite.eq('the weights total 100', weightTotal, 100);
    suite.ok(
      'every segment is reachable (weight > 0)',
      WHEEL_SEGMENTS.every((segment) => segment.weight > 0),
    );
    suite.ok(
      'no negative multipliers',
      WHEEL_SEGMENTS.every((segment) => segment.multiplier >= 0),
    );
    suite.ok(
      'every multiplier has Uzbek legend copy',
      [...new Set(multipliers)].every((multiplier) => typeof WHEEL_LEGEND_NOTES[String(multiplier)] === 'string'),
      Object.keys(WHEEL_LEGEND_NOTES).join(','),
    );
    suite.ok(
      'the top segment is the jackpot constant',
      Math.max(...multipliers) === WHEEL_JACKPOT_MULTIPLIER,
      String(Math.max(...multipliers)),
    );

    // Exact expected return, enumerated from the table (no simulation).
    const expectedRtp = WHEEL_SEGMENTS.reduce((sum, s) => sum + s.multiplier * s.weight, 0) / weightTotal;
    suite.ok(
      'exact RTP matches the configured nominal value',
      Math.abs(expectedRtp - WHEEL_RTP_TARGET.nominal) < 1e-9,
      `expected ${WHEEL_RTP_TARGET.nominal}, got ${expectedRtp}`,
    );
    suite.ok(
      'exact RTP sits inside the target band',
      expectedRtp >= WHEEL_RTP_TARGET.min && expectedRtp <= WHEEL_RTP_TARGET.max,
      String(expectedRtp),
    );

    const hitRate =
      WHEEL_SEGMENTS.filter((segment) => segment.multiplier > 0).reduce((sum, s) => sum + s.weight, 0) /
      weightTotal;
    suite.ok('hit rate is a sane share of spins', hitRate > 0.2 && hitRate < 0.4, String(hitRate));

    // The jitter must never spill into the neighbouring segment.
    suite.ok(
      'landing wobble stays inside half a segment',
      WHEEL_SPIN.jitterDeg < SEGMENT_ANGLE / 2,
      `jitter ${WHEEL_SPIN.jitterDeg} vs half segment ${SEGMENT_ANGLE / 2}`,
    );
    suite.ok(
      'turn range is ordered',
      WHEEL_SPIN.minTurns > 0 && WHEEL_SPIN.maxTurns >= WHEEL_SPIN.minTurns,
    );
  }

  /* --- geometry ---------------------------------------------------------- */
  {
    suite.eq('segment 0 is centred on the pointer', segmentAngle(0), 0);
    suite.eq('segment 1 is centred on 30°', segmentAngle(1), 30);
    suite.eq('segment 11 is centred on 330°', segmentAngle(11), 330);
    suite.eq('rotation for segment 0 is 0°', rotationForSegment(0), 0);
    suite.eq('rotation for segment 1 is 330°', rotationForSegment(1), 330);
    suite.eq('rotation for segment 11 is 30°', rotationForSegment(11), 30);
    suite.eq('normalizeAngle folds negatives', normalizeAngle(-30), 330);
    suite.eq('normalizeAngle folds full turns', normalizeAngle(720), 0);
  }

  /* --- legend ------------------------------------------------------------ */
  {
    const legend = wheelLegend();
    suite.eq('legend has one row per distinct multiplier', legend.length, 8);
    suite.eq(
      'legend rows keep table order',
      legend.map((row) => row.multiplier),
      [0, 1.2, 1.5, 2, 3, 5, 10, 20],
    );
    const oddsSum = legend.reduce((sum, row) => sum + row.odds, 0);
    suite.ok('legend odds sum to 100%', Math.abs(oddsSum - 1) < 1e-9, String(oddsSum));
    suite.ok(
      'the zero segment is the most likely outcome',
      legend[0].multiplier === 0 && legend[0].odds === Math.max(...legend.map((row) => row.odds)),
    );
    suite.ok(
      'the jackpot is the rarest outcome',
      legend[legend.length - 1].multiplier === WHEEL_JACKPOT_MULTIPLIER &&
        legend[legend.length - 1].odds === Math.min(...legend.map((row) => row.odds)),
    );
  }

  /* --- the engine -------------------------------------------------------- */
  {
    const engine = createWheelEngine({ rng: createStubRng([0]) });
    suite.eq('the engine exposes 12 segments', engine.getSegments().length, SEGMENT_COUNT);
    suite.eq('the engine weights match the table', engine.getWeights(), WHEEL_SEGMENTS.map((s) => s.weight));
  }

  {
    // Every segment lands under the pointer — that is the whole promise of the
    // game: the disc must never stop on a segment the player was not paid for.
    const failures = [];
    for (let index = 0; index < SEGMENT_COUNT; index += 1) {
      const engine = createWheelEngine({ rng: createStubRng([index]) });
      const result = engine.spin(DEFAULT_BET);
      const pointerLocal = normalizeAngle(360 - result.stopAngle);
      if (result.segmentIndex !== index) failures.push(`index ${index} → ${result.segmentIndex}`);
      if (Math.abs(angularDelta(pointerLocal, segmentAngle(index))) > WHEEL_SPIN.jitterDeg) {
        failures.push(`index ${index} lands at ${pointerLocal}°`);
      }
    }
    suite.ok('the pointer lands inside the drawn segment for all 12', failures.length === 0, failures.join('; '));
  }

  {
    const engine = createWheelEngine({ rng: createSeededRng(7) });
    const failures = [];
    for (let i = 0; i < 500; i += 1) {
      const result = engine.spin(DEFAULT_BET);
      const pointerLocal = normalizeAngle(360 - result.stopAngle);
      const drift = Math.abs(angularDelta(pointerLocal, segmentAngle(result.segmentIndex)));
      if (drift > WHEEL_SPIN.jitterDeg) failures.push(`${i}: ${drift.toFixed(2)}°`);
      if (result.turns < WHEEL_SPIN.minTurns || result.turns > WHEEL_SPIN.maxTurns) {
        failures.push(`${i}: turns ${result.turns}`);
      }
      if (Math.abs(result.jitter) > WHEEL_SPIN.jitterDeg) failures.push(`${i}: jitter ${result.jitter}`);
    }
    suite.ok('500 random spins always land in-segment', failures.length === 0, failures.slice(0, 5).join('; '));
  }

  {
    const cases = [
      [0, 0, 'loss', 0],
      [1, 1.2, 'win', 1_200],
      [3, 1.5, 'win', 1_500],
      [5, 2, 'win', 2_000],
      [8, 3, 'win', 3_000],
      [9, 5, 'win', 5_000],
      [10, 10, 'win', 10_000],
      [11, 20, 'win', 20_000],
    ];

    const mismatches = [];
    cases.forEach(([index, multiplier, outcome, payout]) => {
      const engine = createWheelEngine({ rng: createStubRng([index]) });
      const result = engine.spin(1_000);
      if (result.segmentIndex !== index) mismatches.push(`#${index} segment`);
      if (result.multiplier !== multiplier) mismatches.push(`#${index} multiplier ${result.multiplier}`);
      if (result.outcome !== outcome) mismatches.push(`#${index} outcome ${result.outcome}`);
      if (result.payout !== payout) mismatches.push(`#${index} payout ${result.payout}`);
      if (result.net !== payout - 1_000) mismatches.push(`#${index} net ${result.net}`);
    });
    suite.ok('payouts follow the segment multipliers exactly', mismatches.length === 0, mismatches.join('; '));
  }

  {
    const engine = createWheelEngine({ rng: createStubRng([indexOfMultiplier(1.2)]) });
    suite.eq('a 1.2× win on 5 000 pays 6 000', engine.spin(5_000).payout, 6_000);
  }

  {
    const engine = createWheelEngine({ rng: createStubRng([11]) });
    const result = engine.spin(250_000);
    suite.eq('the jackpot pays 20× the bet', result.payout, 5_000_000);
  }

  {
    const engine = createWheelEngine({ rng: createStubRng([9]) });
    suite.ok('a ×5 win counts as significant', engine.spin(1_000).multiplier >= WHEEL_BIG_WIN_MULTIPLIER);
  }

  {
    const engine = createWheelEngine({ rng: createStubRng([0]) });
    const bet = DEFAULT_BET;
    const bad = [0, -1_000, 500, 1_500, 251_000, 1.5, NaN, '1000', null];
    const failures = [];
    bad.forEach((value) => {
      try {
        engine.spin(value);
        failures.push(`accepted ${String(value)}`);
      } catch (error) {
        if (error.name !== 'RangeError') failures.push(`${String(value)} → ${error.name}`);
      }
    });
    suite.ok('invalid bets are rejected', failures.length === 0, failures.join('; '));
    suite.ok('a valid bet is accepted', engine.spin(bet).segmentIndex === 0);
  }

  {
    const a = createWheelEngine({ rng: createSeededRng(2026) });
    const b = createWheelEngine({ rng: createSeededRng(2026) });
    const sequenceA = Array.from({ length: 20 }, () => a.spin(DEFAULT_BET));
    const sequenceB = Array.from({ length: 20 }, () => b.spin(DEFAULT_BET));
    suite.ok(
      'the same seed produces the same spins',
      JSON.stringify(sequenceA) === JSON.stringify(sequenceB),
    );
  }

  /* --- distribution + simulated RTP -------------------------------------- */
  {
    const engine = createWheelEngine({ rng: createSeededRng(99_001) });
    const counts = new Array(SEGMENT_COUNT).fill(0);
    let returned = 0;
    let staked = 0;

    for (let i = 0; i < ROUNDS; i += 1) {
      const result = engine.spin(DEFAULT_BET);
      counts[result.segmentIndex] += 1;
      staked += DEFAULT_BET;
      returned += result.payout;
    }

    const drift = counts
      .map((count, index) => ({
        index,
        observed: count / ROUNDS,
        expected: WHEEL_SEGMENTS[index].weight / weightTotal,
      }))
      .filter((row) => Math.abs(row.observed - row.expected) > 0.008);

    suite.ok(
      `${ROUNDS} spins follow the configured weights`,
      drift.length === 0,
      drift.map((row) => `#${row.index} ${row.observed.toFixed(3)} vs ${row.expected}`).join('; '),
    );
    suite.ok('every segment came up at least once', counts.every((count) => count > 0));

    const simulatedRtp = returned / staked;
    suite.ok(
      `simulated RTP ≈ ${WHEEL_RTP_TARGET.nominal}`,
      Math.abs(simulatedRtp - WHEEL_RTP_TARGET.nominal) < 0.05,
      String(simulatedRtp),
    );
    suite.note(`wheel: exact RTP 0.894 · simulated ${simulatedRtp.toFixed(4)} over ${ROUNDS} spins`);
  }

  /* --- history + stats --------------------------------------------------- */
  {
    const backend = createMemoryStorage();
    const store = createStore({ storage: createStorage(backend) });

    store.recordSpin({ game: 'wheel', bet: 1_000, segmentIndex: 8, multiplier: 3, payout: 3_000 });
    const [entry] = store.getHistory();

    suite.eq('a wheel spin is recorded as a wheel game', entry.game, 'wheel');
    suite.eq('the segment is stored', entry.segmentIndex, 8);
    suite.eq('a wheel entry has no reel symbols', entry.symbols, null);
    suite.eq('the multiplier is stored', entry.multiplier, 3);
    suite.eq('the payout is stored', entry.payout, 3_000);
    suite.eq('the net result is stored', entry.net, 2_000);
    suite.eq('the outcome is a win', entry.outcome, 'win');

    const stats = store.getStats();
    suite.eq('wheel spins are counted separately', stats.wheelSpins, 1);
    suite.eq('slot spins are untouched', stats.slotsSpins, 0);
    suite.eq('total spins count both games', stats.totalSpins, 1);

    store.recordSpin({ game: 'wheel', bet: 1_000, segmentIndex: 0, multiplier: 0, payout: 0 });
    suite.eq('a losing wheel spin is counted too', store.getStats().wheelSpins, 2);
    suite.eq('a losing turn has no payout', store.getHistory()[0].payout, 0);
    suite.eq('a losing turn is marked as such', store.getHistory()[0].outcome, 'loss');
    suite.eq('a zero segment is still stored', store.getHistory()[0].segmentIndex, 0);
  }

  {
    // Persistence across a reload (the LocalStorage requirement).
    const backend = createMemoryStorage();
    const first = createStore({ storage: createStorage(backend) });
    first.placeBet(1_000);
    first.credit(3_000);
    first.recordSpin({ game: 'wheel', bet: 1_000, segmentIndex: 11, multiplier: 20, payout: 20_000 });

    const reloaded = createStore({ storage: createStorage(backend) });
    const [entry] = reloaded.getHistory();

    suite.eq('the balance survives a reload', reloaded.getBalance(), STARTING_BALANCE + 2_000);
    suite.eq('the wheel history survives a reload', entry.segmentIndex, 11);
    suite.eq('the multiplier survives a reload', entry.multiplier, 20);
    suite.eq('the wheel counter survives a reload', reloaded.getStats().wheelSpins, 1);
    suite.ok(
      'the recovery report is clean for valid data',
      reloaded.getRecoveryReport().droppedRecords === 0,
      JSON.stringify(reloaded.getRecoveryReport()),
    );
  }

  {
    const store = createStore({ storage: createStorage(createMemoryStorage()) });
    store.recordSpin({ game: 'wheel', bet: 1_000, segmentIndex: 99, multiplier: 2, payout: 2_000 });
    suite.eq('an out-of-range segment is dropped to null', store.getHistory()[0].segmentIndex, null);
  }

  {
    const backend = createMemoryStorage();
    backend.setItem(STORAGE_KEYS.stats, JSON.stringify({ totalSpins: 7, slotsSpins: 7 }));

    const store = createStore({ storage: createStorage(backend) });
    const stats = store.getStats();
    suite.eq('lifetime total survives a schema addition', stats.totalSpins, 7);
    suite.eq('a counter missing from an older save starts at 0', stats.wheelSpins, 0);
    suite.eq('unknown stats keys fall back to 0', stats.totalWon, 0);
  }

  {
    const store = createStore({ storage: createStorage(createMemoryStorage()) });
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      store.recordSpin({ game: 'wheel', bet: 1_000, segmentIndex: i % SEGMENT_COUNT, multiplier: 1.5, payout: 1_500 });
    }
    suite.eq('history never grows past the limit', store.getHistory().length, HISTORY_LIMIT);
    suite.eq('lifetime stats keep counting past the limit', store.getStats().wheelSpins, HISTORY_LIMIT + 5);
    suite.eq('the newest spin is first', store.getHistory()[0].multiplier, 1.5);
  }
}

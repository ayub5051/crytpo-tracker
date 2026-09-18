/* ============================================================================
   SOQQA — reel physics (exact)
   ----------------------------------------------------------------------------
   js/ui/reelPhysics.js is pure, so the whole trajectory can be checked here by
   evaluating it rather than by watching frames. These are the assertions that
   would otherwise need a screenshot and a stopwatch:

     • the strip is periodic, so wrapping mid-spin cannot be seen
     • the strip is long enough for every position the aperture can reach
     • a drum can always land the engine's symbol, from any position
     • the powered travel is monotonic and hands over to the landing continuously
     • the landing overshoots, rebounds, and settles on the exact cell
     • the schedule is the 1.8 s / 2.3 s / 2.8 s anticipation curve
     • there is no motion blur anywhere in the physics
   ========================================================================= */

import { ANIMATION, REEL_COUNT, REEL_STRIP, REEL_TURN, SYMBOL_ORDER } from '../js/config.js';
import { reelTurnTotalMs } from '../js/ui/reelView.js';
import * as physics from '../js/ui/reelPhysics.js';
import {
  BAND_END,
  BAND_START,
  CYCLE_CELLS,
  buildProfile,
  buildSequence,
  cellIndexAt,
  createTurn,
  lastStopMs,
  phaseAt,
  planLanding,
  positionAt,
  turnFor,
  unfoldEnd,
  visibleWindow,
  wrap,
} from '../js/ui/reelPhysics.js';

/** Positions the painted offset can actually take, plus the landing residue. */
const REACHABLE_LOW = BAND_START - REEL_TURN.overshootCells;
const REACHABLE_HIGH = BAND_END - 1 + REEL_TURN.overshootCells;

/** Sweep the reachable positions at a resolution far finer than a pixel. */
function sweepPositions(step = 0.005, fn) {
  for (let p = REACHABLE_LOW; p <= REACHABLE_HIGH; p += step) fn(wrap(p));
  fn(BAND_START);
  fn(BAND_END - 1e-9);
}

export function runReelPhysicsTests(suite) {
  const drums = Array.from({ length: REEL_COUNT }, (_, index) => buildSequence(index));
  const CELL_FRACTION = 0.89; // cell height / pitch, at the widest symbol size

  /* ----------------------------------------------------------------------
     The strip
     ---------------------------------------------------------------------- */
  suite.eq(
    'every drum renders the configured number of cells',
    drums.map((strip) => strip.length),
    Array.from({ length: REEL_COUNT }, () => REEL_STRIP.cells),
  );

  suite.ok(
    'the strip is filled from a period-one-cycle sequence',
    drums.every((strip) => strip.every((id, index) => id === strip[index % CYCLE_CELLS])),
  );

  // A wrap translates the strip by exactly one cycle, so it is invisible only if
  // the cells the aperture shows at the bottom of the band hold the same symbols
  // as the cells one cycle above them — and if those higher cells are rendered.
  {
    const lowest = Math.ceil(BAND_START - CELL_FRACTION);
    const highest = Math.floor(BAND_START + 1 + 2 * CELL_FRACTION);
    const bottom = Array.from({ length: highest - lowest + 1 }, (_, i) => lowest + i);

    suite.ok(
      'a wrap lands on cells that are rendered and hold the same symbols',
      drums.every((strip) =>
        bottom.every(
          (cell) =>
            cell + CYCLE_CELLS < strip.length && strip[cell + CYCLE_CELLS] === strip[cell],
        ),
      ),
      bottom.map((cell) => `${cell}↔${cell + CYCLE_CELLS}`).join(' '),
    );

    // The window must reach exactly as far above the band as the wrap reaches
    // below it — otherwise a wrapped frame would show a cell nobody drew.
    const window_ = visibleWindow(CELL_FRACTION);
    suite.eq(
      'the window bottoms out exactly where the wrap mirrored it',
      [window_.first, window_.last],
      [bottom[0], bottom[bottom.length - 1] + CYCLE_CELLS],
    );
  }

  suite.ok(
    'a cycle holds every symbol exactly twice',
    drums.every((strip) => {
      const cycle = strip.slice(0, CYCLE_CELLS);
      return SYMBOL_ORDER.every((id) => cycle.filter((entry) => entry === id).length === 2);
    }),
  );

  suite.ok(
    'every window of one cycle holds every symbol exactly twice',
    drums.every((strip) =>
      Array.from({ length: strip.length - CYCLE_CELLS + 1 }, (_, start) => {
        const window_ = strip.slice(start, start + CYCLE_CELLS);
        return SYMBOL_ORDER.every((id) => window_.filter((entry) => entry === id).length === 2);
      }).every(Boolean),
    ),
  );

  suite.ok(
    'the three drums carry different layouts, so they do not look identical',
    new Set(drums.map((strip) => strip.join(','))).size === drums.length,
  );

  suite.ok(
    'each drum layout is deterministic',
    drums.every((strip, index) => strip.join(',') === buildSequence(index).join(',')),
  );

  /* ----------------------------------------------------------------------
     The strip is long enough for every reachable position
     ---------------------------------------------------------------------- */
  // Derive the window from the aperture geometry rather than trusting a comment.
  // The real CSS ratio is ~0.84–0.89 (a fixed 8px gap under a cell of at least
  // 43.5px); 1 is the pathological "no gap at all" case.
  const windowReal = visibleWindow(0.89);
  const windowWorst = visibleWindow(1);
  suite.ok(
    'the aperture window fits inside the strip at the real cell/gap ratio',
    windowReal.first >= 0 && windowReal.last <= REEL_STRIP.cells - 1,
    `indices ${windowReal.first}..${windowReal.last} vs 0..${REEL_STRIP.cells - 1}`,
  );
  suite.ok(
    'the aperture window still fits if the gap between cells vanished',
    windowWorst.first >= 0 && windowWorst.last <= REEL_STRIP.cells - 1,
    `indices ${windowWorst.first}..${windowWorst.last} vs 0..${REEL_STRIP.cells - 1}`,
  );
  suite.ok(
    'the strip is not padded well beyond what it needs',
    windowReal.last <= REEL_STRIP.cells - 1 && REEL_STRIP.cells - 1 - windowReal.last <= 1,
    `${REEL_STRIP.cells} cells, window ends at ${windowReal.last}`,
  );

  /* ----------------------------------------------------------------------
     Wrapping
     ---------------------------------------------------------------------- */
  suite.ok(
    'a wrapped position always stays inside the band',
    (() => {
      let ok = true;
      for (let p = -80; p <= 80; p += 0.25) {
        const held = wrap(p);
        if (held < BAND_START || held >= BAND_END) ok = false;
      }
      return ok;
    })(),
  );
  suite.ok(
    'wrapping is idempotent',
    [BAND_START, 3.5, 9.75, 14.5, 22.25, -3.5, -40.125].every((p) => wrap(wrap(p)) === wrap(p)),
  );
  suite.ok(
    'wrapping by exactly one cycle is the identity',
    (() => {
      let ok = true;
      for (let p = -60; p <= 60; p += 0.125) {
        if (Math.abs(wrap(p + CYCLE_CELLS) - wrap(p)) > 1e-9) ok = false;
        if (Math.abs(wrap(p - CYCLE_CELLS) - wrap(p)) > 1e-9) ok = false;
      }
      return ok;
    })(),
  );
  suite.ok(
    'the payline index always names a cell inside the strip',
    (() => {
      let ok = true;
      sweepPositions(0.002, (p) => {
        const index = cellIndexAt(p);
        if (index < 0 || index > REEL_STRIP.cells - 1) ok = false;
      });
      return ok;
    })(),
  );

  /* ----------------------------------------------------------------------
     Landing plan
     ---------------------------------------------------------------------- */
  suite.ok(
    'the travel band is wide enough to reach any congruent distance',
    REEL_TURN.travelMaxCells - REEL_TURN.travelMinCells >= CYCLE_CELLS - 1,
    `${REEL_TURN.travelMinCells}..${REEL_TURN.travelMaxCells} needs ${CYCLE_CELLS - 1} of span`,
  );
  suite.ok(
    'the landing overshoot is a fraction of a cell, not a whole one',
    REEL_TURN.overshootCells > 0 && REEL_TURN.overshootCells < 1,
    `${REEL_TURN.overshootCells}`,
  );

  {
    const problems = [];
    let plans = 0;

    /** Both candidate cells for a symbol on a strip. */
    const candidatesFor = (strip, symbol) => {
      const cells = [];
      for (let cell = BAND_START + 1; cell <= BAND_END; cell += 1) {
        if (strip[cell] === symbol) cells.push(cell);
      }
      return cells;
    };

    /** Audit one plan against every invariant it has to satisfy. */
    const audit = (plan, { strip, symbol, pStart, pick, where, exact }) => {
      plans += 1;
      if (!plan) {
        problems.push(`${where}: no plan`);
        return;
      }
      if (strip[plan.cell] !== symbol) problems.push(`${where}: cell ${plan.cell} holds ${strip[plan.cell]}`);
      if (plan.cell < BAND_START + 1 || plan.cell > BAND_END) problems.push(`${where}: cell ${plan.cell} out of band`);
      if (plan.cell > REEL_STRIP.cells - 1) problems.push(`${where}: cell ${plan.cell} is outside the strip`);
      if (plan.pEnd !== plan.cell - 1) problems.push(`${where}: pEnd ${plan.pEnd} != cell - 1`);
      if (plan.pEnd < BAND_START || plan.pEnd >= BAND_END) problems.push(`${where}: pEnd ${plan.pEnd} outside the band`);
      if (plan.travel < REEL_TURN.travelMinCells) problems.push(`${where}: travel ${plan.travel} below the minimum`);
      if (plan.travel >= REEL_TURN.travelMinCells + CYCLE_CELLS) problems.push(`${where}: travel ${plan.travel} exceeds the band span`);
      if (plan.travel > REEL_TURN.travelMaxCells) problems.push(`${where}: travel ${plan.travel} above the configured max`);

      // The powered travel has to end on the target cell, and the unfolded end
      // has to fold back onto it exactly.
      const drift = Math.abs(pStart - plan.travel - unfoldEnd(pStart, plan.travel, plan.pEnd));
      if (drift > 1e-6) problems.push(`${where}: travel ${plan.travel} does not reach the target`);
      if (wrap(unfoldEnd(pStart, plan.travel, plan.pEnd)) !== plan.pEnd) {
        problems.push(`${where}: the unfolded end does not fold back onto pEnd ${plan.pEnd}`);
      }
      if (exact) {
        // Congruent modulo one cycle, with no floating-point residue left over.
        const offset = pStart - plan.travel - plan.pEnd;
        const residue = offset - Math.round(offset / CYCLE_CELLS) * CYCLE_CELLS;
        if (Math.abs(residue) > 1e-9) {
          problems.push(`${where}: travel ${plan.travel} is not congruent to pEnd ${plan.pEnd}`);
        }
      }
      void pick;
    };

    // The real domain: a turn only starts from a seated drum, which is always an
    // integer cell, and either candidate cell can be picked. Audited with exact
    // equality rather than a tolerance.
    drums.forEach((strip, index) => {
      SYMBOL_ORDER.forEach((symbol) => {
        const candidates = candidatesFor(strip, symbol);
        for (let pStart = BAND_START; pStart < BAND_END; pStart += 1) {
          for (let pick = 0; pick < candidates.length; pick += 1) {
            audit(planLanding(strip, symbol, pStart, () => pick), {
              strip,
              symbol,
              pStart,
              pick,
              where: `drum ${index} ${symbol} p=${pStart} pick=${pick}`,
              exact: true,
            });
          }
        }
      });
    });

    // Every symbol has to be reachable from every drum: that is what "the strip
    // always already contains the drawn symbol" means.
    suite.ok(
      'every symbol can be reached from every drum position',
      drums.every((strip) =>
        SYMBOL_ORDER.every((symbol) => candidatesFor(strip, symbol).length === 2),
      ),
    );

    suite.ok(
      'a drum can always land the engine symbol, from any position and cell',
      problems.length === 0,
      `${problems.length} of ${plans} plans bad · ${problems.slice(0, 3).join('; ')}`,
    );
    suite.ok('the plan audit was not vacuous', plans >= REEL_COUNT * SYMBOL_ORDER.length * CYCLE_CELLS, `${plans} plans`);

    // And a defensive sweep of positions a turn cannot actually start from, to
    // prove the unfold survives a fractional start too. `seat()` writes the
    // integer `pEnd`, so the landing stays exact there as well.
    const drift = [];
    drums.forEach((strip, index) => {
      SYMBOL_ORDER.forEach((symbol) => {
        sweepPositions(0.25, (pStart) => {
          const plan = planLanding(strip, symbol, pStart, () => 1);
          const folded = wrap(unfoldEnd(pStart, plan.travel, plan.pEnd));
          if (folded !== plan.pEnd) {
            drift.push(`drum ${index} ${symbol} p=${pStart.toFixed(3)} → ${folded} != ${plan.pEnd}`);
          }
          plans += 1;
        });
      });
    });
    suite.ok(
      'a drum would still land correctly even from a mid-flight start',
      drift.length === 0,
      `${drift.length} bad · ${drift.slice(0, 3).join('; ')}`,
    );

    suite.note(`${plans.toLocaleString('en-GB')} landing plans audited (travel band + congruence + strip bounds + unfold)`);
  }

  /* ----------------------------------------------------------------------
     Trajectory
     ---------------------------------------------------------------------- */
  const turnByDrum = drums.map((_, index) => turnFor(index));
  const states = turnByDrum.map((turn, index) => {
    const profile = buildProfile(turn);
    const symbol = SYMBOL_ORDER[(index * 2 + 1) % SYMBOL_ORDER.length];
    const plan = planLanding(drums[index], symbol, BAND_START, () => 1);
    return { symbol, ...createTurn({ turn, profile, pStart: BAND_START, ...plan }) };
  });

  suite.eq(
    'the reels arrive on the 1.8 / 2.3 / 2.8 s anticipation curve',
    turnByDrum.map((turn) => turn.stopMs),
    [1800, 2300, 2800],
  );
  suite.eq(
    'the schedule is the config schedule',
    turnByDrum.map((turn) => turn.stopMs),
    [...REEL_TURN.stopAtMs],
  );
  suite.ok(
    'each drum stops strictly later than the one before it',
    turnByDrum.every((turn, index) => index === 0 || turn.stopMs > turnByDrum[index - 1].stopMs),
  );
  suite.ok(
    'every drum\'s phases sum to its own stop time',
    turnByDrum.every(({ rampMs, peakMs, brakeMs, landingMs, stopMs }) =>
      Math.abs(rampMs + peakMs + brakeMs + landingMs - stopMs) < 1e-9,
    ),
  );
  suite.ok(
    'the drums share one acceleration (the motor is common)',
    turnByDrum.every((turn) => turn.rampMs === REEL_TURN.phases.rampMs),
  );
  suite.ok(
    'the reference drum matches the configured phase lengths',
    (() => {
      const reference = turnByDrum[turnByDrum.length - 1];
      const { rampMs, peakMs, brakeMs, landingMs } = REEL_TURN.phases;
      return (
        Math.abs(reference.rampMs - rampMs) < 1e-9 &&
        Math.abs(reference.peakMs - peakMs) < 1e-9 &&
        Math.abs(reference.brakeMs - brakeMs) < 1e-9 &&
        Math.abs(reference.landingMs - landingMs) < 1e-9
      );
    })(),
  );

  suite.eq('a turn always starts exactly where the drum was', states.map((state) => positionAt(state, 0)), states.map((state) => state.pStart));

  suite.ok(
    'the powered travel never reverses direction',
    states.every((state) => {
      let previous = positionAt(state, 0);
      let monotonic = true;
      const poweredEnd = state.turn.stopMs - state.turn.landingMs;
      for (let t = 0.5; t <= poweredEnd; t += 0.5) {
        const p = positionAt(state, t);
        // Strictly decreasing (the drums travel "down" the strip).
        if (!(p <= previous + 1e-9)) monotonic = false;
        previous = p;
      }
      return monotonic;
    }),
  );

  suite.ok(
    'the travel starts from rest, so there is no jolt on the first frame',
    states.every((state) => {
      const first = Math.abs(positionAt(state, 16) - positionAt(state, 0));
      const peakStep = (() => {
        let best = 0;
        let previous = positionAt(state, 0);
        for (let t = 16; t <= state.turn.stopMs; t += 16) {
          const p = positionAt(state, t);
          best = Math.max(best, Math.abs(p - previous));
          previous = p;
        }
        return best;
      })();
      return peakStep > 0 && first < peakStep / 2;
    }),
  );

  suite.ok(
    'the powered phase hands over to the landing without a step',
    states.every((state) => {
      const handOff = state.turn.stopMs - state.turn.landingMs;
      const before = positionAt(state, handOff - 1e-9);
      const after = positionAt(state, handOff);
      // Both sides must sit on the same unfolded value, at the anchor.
      const expected = state.pUnwrappedEnd - REEL_TURN.overshootCells;
      return Math.abs(before - expected) < 1e-6 && Math.abs(after - expected) < 1e-9;
    }),
  );

  suite.ok(
    'the drum always lands on the cell the plan chose',
    states.every(
      (state) =>
        positionAt(state, state.turn.stopMs) === state.pUnwrappedEnd &&
        wrap(positionAt(state, state.turn.stopMs)) === state.pEnd &&
        cellIndexAt(positionAt(state, state.turn.stopMs)) === state.cell,
    ),
  );

  suite.ok(
    'the landing overshoots past the payline before settling',
    states.every((state) => {
      const handOff = state.turn.stopMs - state.turn.landingMs;
      const overshoots = [];
      for (let t = handOff; t <= state.turn.stopMs; t += 1) {
        overshoots.push(positionAt(state, t) - state.pUnwrappedEnd);
      }
      const deepest = Math.min(...overshoots);
      // Overshoot means travelling *further* down the strip, i.e. below the end.
      return deepest < -REEL_TURN.overshootCells * 0.5 && deepest >= -REEL_TURN.overshootCells - 1e-9;
    }),
  );

  suite.ok(
    'the landing is a damped swing: it rebounds and the swings decay',
    states.every((state) => {
      const handOff = state.turn.stopMs - state.turn.landingMs;
      const steps = 200;
      const samples = Array.from({ length: steps + 1 }, (_, i) =>
        positionAt(state, handOff + ((state.turn.stopMs - handOff) * i) / steps),
      );
      // Count sign changes of the velocity (rebounds) and check each swing is
      // smaller than the one before it.
      const extremes = [];
      for (let i = 1; i < samples.length - 1; i += 1) {
        const before = samples[i] - samples[i - 1];
        const after = samples[i + 1] - samples[i];
        if (before * after < 0) extremes.push(samples[i]);
      }
      if (extremes.length < 2) return false;
      const amplitudes = extremes.map((value) => Math.abs(value - state.pUnwrappedEnd));
      return amplitudes.every((amplitude, i) => i === 0 || amplitude <= amplitudes[i - 1] + 1e-9);
    }),
  );

  suite.ok(
    'the last landing frame is exactly on the line (no settle animation needed)',
    states.every((state) => {
      const final = positionAt(state, state.turn.stopMs);
      const justBefore = positionAt(state, state.turn.stopMs - 1e-9);
      return Math.abs(final - justBefore) < 2e-3 && wrap(final) === state.pEnd;
    }),
  );

  suite.ok(
    'the landing rebound never carries the drum past its cell by more than the overshoot',
    states.every((state) => {
      const handOff = state.turn.stopMs - state.turn.landingMs;
      let maxPositive = -Infinity;
      let minNegative = Infinity;
      for (let t = handOff; t <= state.turn.stopMs; t += 1) {
        const excess = positionAt(state, t) - state.pUnwrappedEnd;
        maxPositive = Math.max(maxPositive, excess);
        minNegative = Math.min(minNegative, excess);
      }
      return (
        maxPositive <= REEL_TURN.overshootCells * 0.75 &&
        minNegative >= -REEL_TURN.overshootCells - 1e-9
      );
    }),
    states
      .map((state) => {
        const handOff = state.turn.stopMs - state.turn.landingMs;
        let high = -Infinity;
        for (let t = handOff; t <= state.turn.stopMs; t += 1) {
          high = Math.max(high, positionAt(state, t) - state.pUnwrappedEnd);
        }
        return high.toFixed(4);
      })
      .join(', '),
  );

  /* ----------------------------------------------------------------------
     Phases
     ---------------------------------------------------------------------- */
  suite.ok(
    'every drum passes through ramp → peak → brake → landing in that order',
    states.every((state) => {
      const seen = [];
      for (let t = 0; t < state.turn.stopMs; t += 8) {
        const phase = phaseAt(state, t);
        if (seen[seen.length - 1] !== phase) seen.push(phase);
      }
      return seen.join('>') === ['is-spinning', 'is-peak', 'is-braking', 'is-landing'].join('>');
    }),
  );

  suite.ok(
    'the phase boundaries land inside the turn, never past its end',
    states.every((state) => {
      const { rampMs, peakMs, landingMs, stopMs } = state.turn;
      return (
        rampMs < rampMs + peakMs &&
        rampMs + peakMs < stopMs - landingMs &&
        stopMs - landingMs < stopMs
      );
    }),
  );

  /* ----------------------------------------------------------------------
     Crisp scroll — the drums are never blurred
     ---------------------------------------------------------------------- */
  suite.ok(
    'the config declares no motion-blur budget',
    !('blurMaxPx' in REEL_TURN),
    Object.keys(REEL_TURN).join(', '),
  );
  suite.ok(
    'the physics module exposes no blur helper',
    !('blurFor' in physics),
    Object.keys(physics).join(', '),
  );
  suite.ok(
    'the strip is crawling by the time it hands over to the landing',
    states.every((state) => {
      const handOff = state.turn.stopMs - state.turn.landingMs;
      const speedAtHandOff =
        Math.abs(positionAt(state, handOff) - positionAt(state, handOff - 1)) * 1000;
      // The hand-off is the strip's reversal point, so the speed there is a
      // small fraction of the peak rather than a jump back to it. With no blur
      // to hide behind, the deceleration has to be honest.
      return speedAtHandOff > 0 && speedAtHandOff < state.peakSpeed * 0.5;
    }),
  );
  suite.ok(
    'each drum has a sensible top speed to travel at',
    states.every((state) => state.peakSpeed > 5 && state.peakSpeed < 400),
    states.map((state) => state.peakSpeed.toFixed(1)).join(', '),
  );

  /* ----------------------------------------------------------------------
     Schedule totals & reduced motion
     ---------------------------------------------------------------------- */
  suite.eq('the last drum to be seated is the third', lastStopMs(), 2800);
  suite.eq('the spin resolves one settle beat after the last drum', reelTurnTotalMs(), 2800 + ANIMATION.settleDelay);
  suite.ok(
    'the safety net outlasts the scheduled spin',
    ANIMATION.maxSpinDuration >= lastStopMs(),
    `${ANIMATION.maxSpinDuration} vs ${lastStopMs()}`,
  );

  {
    const reduced = drums.map((_, index) => turnFor(index, true));
    suite.ok(
      'reduced motion still seats every drum, just at once',
      reduced.every((turn) => turn.landingMs === turn.stopMs && turn.rampMs === 0),
    );
    suite.ok(
      'reduced motion still stops left to right',
      reduced.every((turn, index) => index === 0 || turn.stopMs > reduced[index - 1].stopMs),
    );
    suite.ok(
      'reduced motion lands on the engine symbol exactly',
      drums.every((strip, index) => {
        const symbol = SYMBOL_ORDER[(index + 2) % SYMBOL_ORDER.length];
        const turn = turnFor(index, true);
        const plan = planLanding(strip, symbol, BAND_START, () => 0);
        const state = createTurn({ turn, profile: buildProfile(turn), pStart: BAND_START, ...plan, reduced: true });
        return (
          strip[plan.cell] === symbol &&
          // The turn must still be resting where it started, and it must still
          // arrive on the planned cell when the moment comes.
          state.seated === false &&
          state.p === BAND_START &&
          wrap(positionAt(state, turn.stopMs)) === plan.pEnd &&
          Math.abs(positionAt(state, turn.stopMs) - state.pUnwrappedEnd) < 1e-9
        );
      }),
    );
  }

  suite.note(
    `spin ${turnByDrum.map((turn) => turn.stopMs).join(' / ')} ms · overshoot ${(REEL_TURN.overshootCells * 100).toFixed(0)} % of a cell · travel ${REEL_TURN.travelMinCells}–${REEL_TURN.travelMinCells + CYCLE_CELLS - 1} cells`,
  );
}

/* ============================================================================
   SOQQA — reel physics (pure)
   ----------------------------------------------------------------------------
   All of the drum maths, with no DOM, no timers and no storage. js/ui/reelView.js
   owns the elements and the frame loop and calls in here for every number; that
   split is what lets tests/reel-physics.test.mjs verify the trajectory exactly —
   the overshoot, the rebound, the exact landing and the visible window — instead
   of sampling frames and hoping.

   The drums are real scrolling strips, never swapped symbols. Each drum renders
   one long column of vector art once, then a single number — its position, in
   cells — is the whole of its state. `paint` turns that number into a transform.

   How the landing is guaranteed
     • A strip repeats a `cycleCells`-cell cycle (every symbol twice, half a cycle
       apart), so it is *periodic*: translating it by exactly one cycle is
       pixel-identical. That is what makes mid-spin wrapping invisible.
     • The painted position is folded into one cycle-wide band, so both ends of a
       turn live in it and the cell that must land is always one of
       `cycleCells` consecutive cells — which, by construction, hold every symbol
       twice. The engine's symbol is therefore always already in the strip, and a
       turn simply chooses how far to scroll to bring it home.
     • `travelMinCells`…`travelMinCells + cycleCells - 1` is the distance band, so
       a congruent solution always exists and is never clamped.

   A turn only ever begins from a seated drum, so `pStart` is an integer cell in
   the band; the arithmetic below is still written to stay exact if it ever were
   not (see `unfoldEnd`).
   ========================================================================= */

import { REEL_STRIP, REEL_TURN, SYMBOL_ORDER } from '../config.js';

/** Cells in one cycle. */
export const CYCLE_CELLS = REEL_STRIP.cycleCells;

/**
 * The band the painted position is kept in: exactly one cycle wide, one cell
 * down from the top of the strip.
 *
 * The offset buys full coverage. The aperture is a pitch taller than one cell,
 * so at position `p` it shows cells from `ceil(p - cell/pitch)` to
 * `floor(p + 1 + 2·cell/pitch)` — under one cell above `p` and under three
 * below it. Starting the band at 0 would let the top of that window fall one
 * index below the strip; starting at 1 removes the case for every cell/gap
 * ratio, and the bottom then reaches at most index 17 with an 18-cell strip.
 */
export const BAND_START = 1;
export const BAND_END = BAND_START + CYCLE_CELLS;

/**
 * Compact, motion-free timings for players who asked for reduced motion. The
 * drums still land on the engine's symbols — they just get there at once.
 */
export const REDUCED_TURN = Object.freeze({
  stopAtMs: Object.freeze([140, 200, 260]),
});

/**
 * How many half-waves the landing residue makes before it settles.
 *
 * The residue is `-overshoot · (1 - τ)² · cos(π·waves·τ)`. The squared envelope
 * takes both the displacement and the velocity to exactly zero at τ = 1, so the
 * drum ends up sitting on the cell rather than drifting into it; the cosine
 * gives it the swings. At 3.5 the drum overshoots once by a full `overshootCells`,
 * rebounds to about 53 % of that, swings back to 20 %, and micro-settles — a
 * heavy mechanical stop, not a UI transition.
 */
const LANDING_WAVES = 3.5;

/* --- geometry ------------------------------------------------------------- */

/**
 * Fold a raw position back into the band the strip is guaranteed to cover.
 *
 * Closed-form rather than a `while` loop: a drum travels several cycles, and the
 * loop's repeated additions drift on doubles. The pictures are identical either
 * way — `wrap` only ever feeds a transform and a `Math.round` — but the
 * closed-form version keeps the number stable enough to assert on directly.
 */
export function wrap(p) {
  const span = BAND_END - BAND_START;
  const offset = p - BAND_START;
  return BAND_START + offset - Math.floor(offset / span) * span;
}

/**
 * The strip index sitting on a drum's payline (the middle of the three rows) at
 * position `p`. With the aperture exactly `3·cell + 2·gap` tall, the middle row
 * begins a full pitch below the top, i.e. on the cell after the position.
 * @returns {number}
 */
export function cellIndexAt(p) {
  return Math.round(wrap(p)) + 1;
}

/**
 * The widest strip window the aperture can ever cover, as a half-open range of
 * indices. Derived rather than measured, so a strip that is too short to cover
 * every reachable position fails a test instead of showing a gap in a browser.
 *
 * @param {number} [cellFraction] — cell height as a fraction of the pitch. The
 *   real value is under 0.89 (the CSS keeps an 8px gap); 1 is the worst case.
 * @returns {{ first: number, last: number }}
 */
export function visibleWindow(cellFraction = 1) {
  const lowest = BAND_START - REEL_TURN.overshootCells;
  const highest = BAND_END - 1 + REEL_TURN.overshootCells;

  let first = Infinity;
  let last = -Infinity;

  for (let p = lowest; p <= highest; p += 0.001) {
    const held = wrap(p);
    first = Math.min(first, Math.ceil(held - cellFraction));
    last = Math.max(last, Math.floor(held + 1 + 2 * cellFraction));
  }

  return { first, last };
}

/* --- strip construction --------------------------------------------------- */

/**
 * A deterministic shuffle. The strip layout is a fixed asset, so it must not
 * consume the injected game RNG — that would desynchronise the engine's draws.
 * @param {string[]} order
 * @param {number} seed
 */
function permute(order, seed) {
  const out = order.slice();
  let state = ((seed + 1) * 2654435761) >>> 0;

  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The symbol sequence of one drum: a shuffled cycle of every symbol, laid down
 * twice, then repeated to fill the strip. Every symbol therefore appears exactly
 * twice per cycle, exactly half a cycle apart — which is what makes any window
 * of `cycleCells` consecutive cells contain every symbol twice.
 *
 * @param {number} index — drum index
 * @returns {string[]}
 */
export function buildSequence(index) {
  const cycle = permute(SYMBOL_ORDER, index);
  const doubled = cycle.concat(cycle);
  return Array.from({ length: REEL_STRIP.cells }, (_, i) => doubled[i % doubled.length]);
}

/* --- motion profile ------------------------------------------------------- */

/**
 * Build the distance curve for one drum's turn.
 *
 * `v(s)` is the normalised speed at turn-fraction `s`: a smooth ramp up to full
 * speed, a hold, then a decay of `(1 - u) ** brakeExponent`. It is integrated
 * once into a small table and normalised, so `distanceAt(s3)` is exactly 1 and
 * the travel is never off by an integration residue. Because the curve is
 * normalised rather than a fixed easing, changing any phase length rescales the
 * ramp and the brake but still ends precisely on the payline.
 */
export function buildProfile(turn) {
  const { stopMs, rampMs, peakMs, brakeMs } = turn;
  const s1 = rampMs / stopMs;
  const s2 = (rampMs + peakMs) / stopMs;
  const s3 = (rampMs + peakMs + brakeMs) / stopMs;

  const speedAt = (s) => {
    if (s <= s1) {
      const u = s1 === 0 ? 1 : s / s1;
      return u * u * (3 - 2 * u); // smoothstep: no jolt on the first frame
    }
    if (s <= s2) return 1;
    const span = Math.max(1e-6, s3 - s2);
    const u = Math.max(0, Math.min(1, (s - s2) / span));
    return (1 - u) ** REEL_TURN.brakeExponent;
  };

  const steps = 128;
  const table = new Array(steps + 1);
  let total = 0;
  let fastest = 0;
  table[0] = 0;

  for (let i = 1; i <= steps; i += 1) {
    const step = s3 / steps;
    const prev = (i - 1) * step;
    const at = i * step;
    total += ((speedAt(prev) + speedAt(at)) / 2) * step;
    table[i] = total;
    fastest = Math.max(fastest, (total - table[i - 1]) / step);
  }

  // Normalise so the integral over the powered part of the turn is exactly 1.
  const span = total > 0 ? total : 1;
  for (let i = 0; i <= steps; i += 1) table[i] /= span;

  return {
    s3,
    steps,
    table,
    /** Fraction of the powered travel completed at turn-fraction `s`. */
    distanceAt(s) {
      if (s <= 0) return 0;
      if (s >= s3) return 1;
      const exact = (s / s3) * steps;
      const i = Math.min(steps - 1, Math.floor(exact));
      const t = exact - i;
      return table[i] + (table[i + 1] - table[i]) * t;
    },
    /** Peak normalised speed — the drum's top rate, in cycles per turn. */
    peakRate: total > 0 ? fastest / span : 0,
  };
}

/**
 * Scale the reference phase lengths onto one drum's own stop time.
 *
 * The drums share a motor, so they accelerate together; the rest of the turn is
 * the reference split, compressed proportionally. A drum that stops earlier
 * therefore brakes over a shorter time but with the same shape.
 */
export function turnFor(index, reduced = false) {
  if (reduced) {
    const last = REDUCED_TURN.stopAtMs.length - 1;
    const stopMs = REDUCED_TURN.stopAtMs[index] ?? REDUCED_TURN.stopAtMs[last];
    return { stopMs, rampMs: 0, peakMs: 0, brakeMs: 0, landingMs: stopMs };
  }

  const stops = REEL_TURN.stopAtMs;
  const stopMs = stops[index] ?? stops[stops.length - 1];
  const { rampMs, peakMs, brakeMs, landingMs } = REEL_TURN.phases;

  const ramp = Math.min(rampMs, stopMs);
  const tail = Math.max(1, stopMs - ramp);
  const referenceTail = Math.max(1, peakMs + brakeMs + landingMs);

  return {
    stopMs,
    rampMs: ramp,
    peakMs: (peakMs / referenceTail) * tail,
    brakeMs: (brakeMs / referenceTail) * tail,
    landingMs: (landingMs / referenceTail) * tail,
  };
}

/* --- landing plan --------------------------------------------------------- */

/**
 * Choose where a drum stops: which cell carries the engine's symbol, and how far
 * the drum has to travel to bring it home.
 *
 * @param {string[]} symbols — the drum's immutable strip
 * @param {string} symbol — the symbol the engine drew
 * @param {number} pStart — the drum's position when the turn begins
 * @param {(count: number) => number} [pickIndex] — picks among the candidate cells
 * @returns {{ pEnd: number, travel: number, cell: number }|null}
 */
export function planLanding(symbols, symbol, pStart, pickIndex) {
  // Every cell in the band that already carries the drawn symbol. There are
  // always exactly two, because the band is exactly one cycle wide.
  const candidates = [];
  for (let cell = BAND_START + 1; cell <= BAND_END; cell += 1) {
    if (symbols[cell] === symbol) candidates.push(cell);
  }
  if (candidates.length === 0) return null;

  const pick = typeof pickIndex === 'function' ? pickIndex(candidates.length) : 0;
  const cell = candidates[Math.max(0, Math.min(candidates.length - 1, pick))];
  const pEnd = cell - 1;

  // The travel has to land the position on exactly `pEnd`: congruent with
  // `pStart - pEnd` modulo one cycle, and inside the configured distance band.
  // `travelMaxCells - travelMinCells` is at least `cycleCells - 1` (a config
  // invariant the tests enforce), so the solution always exists — it lands in
  // [min, min + cycle - 1] and is never clamped away. Clamping here would break
  // the congruence and seat the drum on the wrong cell.
  const remainder = (((pStart - pEnd) % CYCLE_CELLS) + CYCLE_CELLS) % CYCLE_CELLS;
  const travel =
    REEL_TURN.travelMinCells +
    ((((remainder - REEL_TURN.travelMinCells) % CYCLE_CELLS) + CYCLE_CELLS) % CYCLE_CELLS);

  return { pEnd, travel, cell };
}

/* --- one turn ------------------------------------------------------------- */

/**
 * Unfold the target cell back to where the powered travel actually ends.
 *
 * A turn covers several cycles, so `pEnd` (which lives in the band) is several
 * cycles away from the position the drum really reaches. The number of cycles is
 * recovered here and re-applied as an *integer* multiple: the result is therefore
 * congruent to `pEnd` exactly, with no floating-point residue to round the wrong
 * way at the band edge. Deriving it as `pStart - travel` instead leaves the
 * unfold a few ulps off, and a `wrap()` that then floors to the neighbouring
 * cycle would paint the wrong cell until the drum seats.
 *
 * @param {number} pStart
 * @param {number} travel — cells travelled
 * @param {number} pEnd — band target position
 */
export function unfoldEnd(pStart, travel, pEnd) {
  const cycles = Math.round((pStart - travel - pEnd) / CYCLE_CELLS);
  return pEnd + cycles * CYCLE_CELLS;
}

/**
 * Assemble the state of a single drum's turn.
 *
 * @param {object} options
 * @param {object} options.turn — from turnFor()
 * @param {object} options.profile — from buildProfile(turn)
 * @param {number} options.pStart — position when the turn began
 * @param {number} options.pEnd — band target position (from planLanding)
 * @param {number} options.travel — cells travelled (from planLanding)
 * @param {number|null} [options.cell] — strip cell that lands (from planLanding)
 * @param {number} [options.startedAt]
 * @param {boolean} [options.reduced]
 */
export function createTurn({
  turn,
  profile,
  pStart,
  pEnd,
  travel,
  cell = null,
  startedAt = 0,
  reduced = false,
}) {
  const poweredCells = travel + REEL_TURN.overshootCells;

  return {
    turn,
    profile,
    pStart,
    pEnd,
    travel,
    cell,
    /**
     * `pEnd` unfolded into this turn's travel. The landing beats are measured
     * from here rather than from the band value of `pEnd`: a turn covers several
     * cycles, so the powered position and the band value differ by a whole
     * multiple of the cycle. Handing the band value over would step the number
     * by that multiple in one frame — invisible on screen (the strip is
     * periodic) but a real discontinuity in the position the loop reports.
     */
    pUnwrappedEnd: unfoldEnd(pStart, travel, pEnd),
    poweredCells,
    /**
     * Speed through the powered part of the turn, in cells per second. Exposed
     * because it is what the eye reads as "weight": the drums are never blurred,
     * so how fast a strip is moving is the whole of the sensation.
     */
    peakSpeed: (poweredCells * profile.peakRate * 1000) / turn.stopMs,
    startedAt,
    p: pStart,
    /**
     * Never pre-seated. Even under reduced motion the drum is seated through
     * `seat()`, so the painted offset and the payline cell both end up on the
     * engine's symbol — pre-seating would silently skip both.
     */
    seated: false,
    reduced,
    phase: null,
  };
}

/**
 * Where a drum is at `elapsed` ms into its turn.
 *
 * Powered travel runs to the landing anchor (a touch past the payline), then the
 * damped residue carries the drum through a slight overshoot, a rebound and a
 * micro-settle onto the exact cell (see LANDING_WAVES). The residue's first
 * frame is exactly `-overshootCells` — continuous with the powered travel — and
 * its last is exactly zero, so the seated position is precise rather than
 * approximate:
 *
 *   powered(landingStart) === pUnwrappedEnd - overshootCells === landing(0)
 *   landing(landingMs)     === pUnwrappedEnd                  ≡ pEnd
 *
 * @returns {number} an *unfolded* position in cells — `wrap()` it to paint it.
 */
export function positionAt(state, elapsed) {
  const { turn, pStart, pUnwrappedEnd, poweredCells } = state;
  const { stopMs, landingMs } = turn;
  const landingStartMs = stopMs - landingMs;

  if (elapsed >= stopMs) return pUnwrappedEnd;
  if (elapsed <= landingStartMs) {
    return pStart - poweredCells * state.profile.distanceAt(elapsed / stopMs);
  }

  const tau = (elapsed - landingStartMs) / Math.max(1, landingMs);
  const residue =
    -REEL_TURN.overshootCells * (1 - tau) * (1 - tau) * Math.cos(Math.PI * LANDING_WAVES * tau);
  return pUnwrappedEnd + residue;
}

/** Which of the four beats a drum is in at `elapsed` ms into its turn. */
export function phaseAt(state, elapsed) {
  const { rampMs, peakMs, landingMs, stopMs } = state.turn;
  if (elapsed <= rampMs) return 'is-spinning';
  if (elapsed <= rampMs + peakMs) return 'is-peak';
  if (elapsed <= stopMs - landingMs) return 'is-braking';
  return 'is-landing';
}

/** Total ms from the spin call to the last drum being seated. */
export function lastStopMs() {
  return REEL_TURN.stopAtMs.reduce((latest, stop) => Math.max(latest, stop), 0);
}

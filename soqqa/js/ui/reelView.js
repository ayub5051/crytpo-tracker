/* ============================================================================
   SOQQA — reel view  (continuous strip DOM)
   ----------------------------------------------------------------------------
   Owns the cabinet's elements and its frame loop. Every number — where a drum
   is, which beat it is in, where it has to stop — comes from
   js/ui/reelPhysics.js, which is pure and therefore exactly testable.

   The drums are real. Each one is a long, fixed column of vector symbols that
   slides behind a three-row aperture, positioned by a single numeric offset and
   moved with `transform`. Nothing about a strip's contents ever changes: no
   symbol is swapped, re-drawn, injected or patched — not during the spin, and
   not when it stops. The engine's symbol is carried onto the payline by the
   motion itself, so the landing is literally the maths.

   The strips are never blurred, filtered or faded: a drum is a crisp column of
   artwork moving on its own composited layer, so every symbol stays legible at
   every frame of the turn.

   Timings live in REEL_TURN / REEL_STRIP (js/config.js), the trajectory in
   js/ui/reelPhysics.js, and the visual shell in style.css section 12.
   ========================================================================= */

import { ANIMATION, BIG_WIN_MULTIPLIER, JACKPOT_MULTIPLIER, REEL_TURN } from '../config.js';
import {
  BAND_START,
  buildProfile,
  buildSequence,
  cellIndexAt,
  createTurn,
  lastStopMs,
  phaseAt,
  planLanding,
  positionAt,
  turnFor,
  wrap,
} from './reelPhysics.js';
import { createSymbolCell } from './symbolArt.js';

/** Phase classes a drum carries through a turn, in the order it picks them up. */
const PHASES = ['is-spinning', 'is-peak', 'is-braking', 'is-landing'];

/**
 * Cabinet celebration classes, cleared at the start of every turn.
 * `is-paying` is set from the result before the first frame — the engine decides
 * the outcome up front — and is what lets the stylesheet put the gold lock glint
 * on a paying turn only: a losing turn's drums snap into place dark and silent.
 */
const CELEBRATION = ['is-win', 'is-big-win', 'is-jackpot', 'is-paying'];

export function createReelView(root, { rng } = {}) {
  const reels = root ? Array.from(root.querySelectorAll('[data-reel]')) : [];
  const window_ = root ? root.querySelector('.reel-window') : null;

  /**
   * One record per drum. `p` is the current position in cells and is the only
   * thing a spin ever changes.
   */
  const drums = reels.map((reel, index) => {
    const strip = reel.querySelector('.reel-strip');
    const symbols = buildSequence(index);
    if (strip) symbols.forEach((id) => strip.append(createSymbolCell(document, id)));

    return {
      index,
      reel,
      strip,
      symbols,
      cells: strip ? Array.from(strip.querySelectorAll('.reel-symbol')) : [],
      p: BAND_START,
      phase: null,
    };
  });

  // Show the strips where they start, so the cabinet is correct before the first
  // spin — and so what the code calls "the payline cell" is really the painted one.
  drums.forEach((drum) => paint(drum, drum.p));

  let spinning = false;
  let currentSpin = null;
  let frame = null;
  let states = [];
  let highlighted = [];
  const timers = [];

  const reducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const raf = (callback) =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(callback)
      : setTimeout(() => callback(Date.now()), 16);

  const cancelRaf = (handle) => {
    if (handle === null) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
    else clearTimeout(handle);
  };

  /* --- painting ------------------------------------------------------------ */

  /** Point a drum's strip at a position, in cells. The only write a spin makes. */
  function paint(drum, p) {
    if (!drum.strip) return;
    drum.strip.style.setProperty('--reel-offset', String(-wrap(p)));
  }

  function setPhase(drum, phase) {
    if (drum.phase === phase) return;
    drum.reel.classList.remove(...PHASES);
    if (phase) drum.reel.classList.add(phase);
    drum.phase = phase;
  }

  /* --- the frame loop ------------------------------------------------------ */

  function frameStep() {
    frame = null;
    if (!spinning) return;

    const now = Date.now();
    let pending = 0;

    states.forEach((state) => {
      if (state.seated) return;

      const elapsed = now - state.startedAt;
      if (elapsed >= state.turn.stopMs) {
        // Seat on the exact cell the plan chose — the alignment is quantised by
        // the layout, never by where the last frame happened to land.
        seat(state);
        return;
      }
      pending += 1;
      advance(state, elapsed);
    });

    // Every drum is down: stop the loop. The reveal is on its own timer, so the
    // result always appears exactly `settleDelay` after the last drum seated.
    if (pending > 0) frame = raf(frameStep);
  }

  function advance(state, elapsed) {
    const drum = state.drum;
    const p = positionAt(state, elapsed);
    state.p = p;
    drum.p = p;

    paint(drum, p);
    setPhase(drum, phaseAt(state, elapsed));
  }

  /** Put a drum down on its planned cell and drop every animation cue. */
  function seat(state) {
    if (state.seated) return;
    state.seated = true;
    state.p = state.pEnd;
    state.drum.p = state.pEnd;

    paint(state.drum, state.pEnd);
    setPhase(state.drum, null);
    // Drop the compositing promotion as soon as this drum stops — an early drum
    // must not keep a layer alive while the drums to its right are still turning.
    state.drum.reel.classList.remove('is-locking', 'is-turning');
  }

  /* --- cabinet lighting ---------------------------------------------------- */

  function clearHighlights() {
    if (window_) window_.classList.remove(...CELEBRATION);
    highlighted.forEach((cell) => cell.classList.remove('is-win'));
    highlighted = [];
  }

  /**
   * Light the cabinet for a win. A losing spin lights nothing: the drums simply
   * settle, so a miss stays as dark as the cabinet was before the turn.
   */
  function highlight(result) {
    if (!result || !result.matchType) return;

    const winning = result.matchType === 'three' ? [0, 1, 2] : [0, 1];
    winning.forEach((index) => {
      const cell = paylineCell(index);
      if (!cell) return;
      cell.classList.add('is-win');
      highlighted.push(cell);
    });

    if (!window_) return;
    window_.classList.add('is-win');
    if (result.multiplier >= BIG_WIN_MULTIPLIER) window_.classList.add('is-big-win');
    if (result.multiplier >= JACKPOT_MULTIPLIER) window_.classList.add('is-jackpot');
  }

  /* --- one spin ------------------------------------------------------------ */

  /**
   * Animate one spin.
   * @param {{ symbols: string[], matchType: 'three'|'two'|null, multiplier: number }} result
   * @returns {Promise<void>} resolves once every drum is seated and settled
   */
  function spin(result) {
    if (reels.length === 0) return Promise.resolve();
    // Re-entrancy guard: a second spin joins the one already running instead of
    // starting a parallel set of drums.
    if (currentSpin) return currentSpin;

    const reduced = reducedMotion();
    spinning = true;
    clearHighlights();
    window_?.classList.add('is-spinning');
    if (result.matchType) window_?.classList.add('is-paying');

    const now = Date.now();

    states = drums.map((drum) => {
      const turn = turnFor(drum.index, reduced);
      const plan = planLanding(
        drum.symbols,
        result.symbols[drum.index],
        drum.p,
        rng && typeof rng.pickIndex === 'function' ? (count) => rng.pickIndex(count) : undefined,
      );
      // planLanding can only fail if the strip were built wrong; fall back to
      // keeping the drum where it is rather than leaving the cabinet locked.
      const pEnd = plan ? plan.pEnd : drum.p;
      const travel = plan ? plan.travel : 0;

      const state = createTurn({
        turn,
        profile: buildProfile(turn),
        pStart: drum.p,
        pEnd,
        travel,
        cell: plan ? plan.cell : null,
        startedAt: now,
        reduced,
      });
      state.drum = drum;

      drum.reel.classList.add('is-turning');
      // Enter the first beat straight away rather than waiting for the first
      // frame, so the housing light is already up on the take-off.
      if (!reduced) {
        drum.reel.classList.add('is-spinning');
        drum.phase = 'is-spinning';
      }
      // The housing nudge and the lock glint run on each drum's own landing
      // beat, not the reference one — shorter drums have a shorter beat.
      drum.reel.style.setProperty('--reel-lock-ms', `${Math.round(turn.landingMs)}ms`);

      return state;
    });

    // Captured per run, so a late timer from this turn can never reach into the
    // state of the next one.
    const run = states;
    const schedule = lastStopMs();

    currentSpin = new Promise((resolve) => {
      let settled = false;

      const clearTimers = () => {
        timers.splice(0).forEach(clearTimeout);
      };

      const unlock = () => {
        cancelRaf(frame);
        frame = null;
      };

      const settleAndFinish = () => {
        run.forEach((state) => seat(state));
        highlight(result);
        finish();
      };

      function finish() {
        if (settled) return;
        settled = true;
        clearTimers();
        unlock();
        spinning = false;
        currentSpin = null;
        states = [];
        drums.forEach((drum) => {
          drum.reel.classList.remove('is-turning', 'is-locking', ...PHASES);
          drum.phase = null;
        });
        window_?.classList.remove('is-spinning');
        resolve();
      }

      /* Safety net: a lost frame or a backgrounded tab must never leave the
       * cabinet locked. */
      timers.push(
        setTimeout(settleAndFinish, Math.max(ANIMATION.maxSpinDuration, schedule + 400)),
      );

      if (reduced) {
        // No motion at all: every drum is seated on the right cell, at once.
        run.forEach((state) => seat(state));
        timers.push(setTimeout(() => settleAndFinish(), ANIMATION.settleDelay));
        return;
      }

      // Nudge the housing the moment each drum starts its landing beat.
      run.forEach((state) => {
        timers.push(
          setTimeout(() => {
            if (spinning && !state.seated) state.drum.reel.classList.add('is-locking');
          }, state.turn.stopMs - state.turn.landingMs),
        );
      });

      // Reveal only once the last drum has settled.
      timers.push(setTimeout(settleAndFinish, schedule + ANIMATION.settleDelay));

      frame = raf(frameStep);
    });

    return currentSpin;
  }

  /* --- inspection --------------------------------------------------------- */

  /** @returns {number} the strip cell currently on a drum's payline */
  function paylineIndex(index) {
    const drum = drums[index];
    if (!drum) return -1;
    return cellIndexAt(drum.p);
  }

  /** @returns {HTMLElement|null} the cell currently on a drum's payline */
  function paylineCell(index) {
    const drum = drums[index];
    if (!drum) return null;
    return drum.cells[paylineIndex(index)] ?? null;
  }

  return {
    spin,
    clearHighlights,
    isSpinning: () => spinning,
    /** Cell index currently on a drum's payline (in strip coordinates). */
    paylineIndex,
    /** Element currently on a drum's payline. */
    paylineCell,
    /** Symbol id currently on a drum's payline. */
    paylineSymbol: (index) => drums[index]?.symbols[paylineIndex(index)] ?? null,
    /**
     * The drum's position, in cells. Only a spin ever changes it. Mid-turn this
     * is the *unfolded* value (it leaves the band as the drum travels several
     * cycles); the painted offset is always `wrap(position)`.
     */
    position: (index) => drums[index]?.p ?? 0,
    /** The immutable symbol sequence of a drum's strip. */
    stripSymbols: (index) => (drums[index] ? drums[index].symbols.slice() : []),
    /** The strip's cells, in order. */
    stripCells: (index) => (drums[index] ? drums[index].cells.slice() : []),
  };
}

/**
 * Total ms from the spin call to the settled result: the last drum to be seated,
 * plus the settle beat. Used by the tests and as the lower bound for the safety
 * net above.
 */
export function reelTurnTotalMs() {
  return lastStopMs() + ANIMATION.settleDelay;
}

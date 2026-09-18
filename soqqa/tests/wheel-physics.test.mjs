/* ============================================================================
   SOQQA — Omad charxi physics (exact)
   ----------------------------------------------------------------------------
   The wheel's movement is a closed-form curve in js/ui/wheelPhysics.js, so the
   whole trajectory can be asserted here instead of watched in a browser.

   The four properties that decide whether the wheel feels like a real machine —
   and whether it cheats the player — are:

     • it lands EXACTLY on the angle the engine drew, jitter included
     • the tick past the pin never carries the pointer over the segment edge
     • the travel beat never rewinds, and hands over to the landing without a
       step, so the disc cannot jump
     • the spin is 3–4 s long, and it genuinely decelerates: the wheel is
       crawling when the pin catches it, not still at speed
   ========================================================================= */

import { WHEEL_SEGMENTS, WHEEL_SPIN } from '../js/config.js';
import { SEGMENT_ANGLE, normalizeAngle, rotationForSegment } from '../js/games/wheel.js';
import {
  overshootPeak,
  pinFlickAt,
  pinSeatClickAt,
  planWheelSpin,
  profileVelocity,
  rotationAt,
  velocityAt,
} from '../js/ui/wheelPhysics.js';

const TOL = 1e-9;
/** A 60Hz frame, the grid a real browser would sample this curve on. */
const FRAME_MS = 1000 / 60;

/**
 * Signed shortest difference between two angles, in (−180, 180]. Folding a
 * difference into [0, 360) would turn a 13° wobble backwards into a 347° drift,
 * so every angular comparison has to run through here.
 */
const angularDelta = (a, b) => (((a - b) % 360) + 540) % 360 - 180;

export function runWheelPhysicsTests(suite) {
  const { durationMs, minTurns, maxTurns, jitterDeg, brakeLinearShare } = WHEEL_SPIN;

  /* ----------------------------------------------------------------------
     The spin budget
     ---------------------------------------------------------------------- */
  suite.ok(
    'the spin lasts 3–4 s of suspense, as the cabinet is tuned for',
    durationMs >= 3000 && durationMs <= 4000,
    `${durationMs} ms`,
  );
  suite.ok(
    'the travel beat and the landing beat add up to the whole spin',
    Math.round(durationMs * WHEEL_SPIN.brakeShare) + (durationMs - Math.round(durationMs * WHEEL_SPIN.brakeShare)) ===
      durationMs,
    `${durationMs} ms`,
  );
  suite.ok(
    'the landing gets a real share of the spin, so the rebound can be seen',
    WHEEL_SPIN.brakeShare > 0.5 && WHEEL_SPIN.brakeShare < 0.95,
    String(WHEEL_SPIN.brakeShare),
  );
  suite.ok(
    'the travel ramps up before it holds its top speed',
    WHEEL_SPIN.accelShare > 0 && WHEEL_SPIN.accelShare < WHEEL_SPIN.peakShare && WHEEL_SPIN.peakShare < 0.5,
    `accel ${WHEEL_SPIN.accelShare} · peak ${WHEEL_SPIN.peakShare}`,
  );
  suite.ok(
    'the ramp is a KICK, not a wind-up: most of the speed arrives immediately',
    WHEEL_SPIN.rampExponent > 0 && WHEEL_SPIN.rampExponent < 1,
    String(WHEEL_SPIN.rampExponent),
  );

  /* --- the kick, measured ---------------------------------------------- */
  {
    const shape = {
      accel: WHEEL_SPIN.accelShare,
      peak: WHEEL_SPIN.peakShare,
      exponent: WHEEL_SPIN.brakeExponent,
      floor: WHEEL_SPIN.brakeFloor,
      ramp: WHEEL_SPIN.rampExponent,
    };
    const half = profileVelocity(WHEEL_SPIN.accelShare / 2, shape);
    const quarter = profileVelocity(WHEEL_SPIN.accelShare / 4, shape);

    suite.ok(
      'half way up the ramp the wheel is already most of the way to speed',
      half > 0.55 && half < 1,
      `${(half * 100).toFixed(0)} %`,  // ~65 %
    );
    suite.ok(
      'a quarter of the way up it is still climbing — the kick has a shape',
      quarter > 0.15 && quarter < half,
      `${(quarter * 100).toFixed(0)} %`,
    );
    suite.ok(
      'the ramp ends exactly on the plateau, so there is no step in speed',
      Math.abs(profileVelocity(WHEEL_SPIN.accelShare, shape) - 1) < 1e-12,
    );
    suite.ok(
      'the kick is short: under a quarter of a second of the spin',
      WHEEL_SPIN.durationMs * WHEEL_SPIN.brakeShare * WHEEL_SPIN.accelShare <= 250,
      `${Math.round(WHEEL_SPIN.durationMs * WHEEL_SPIN.brakeShare * WHEEL_SPIN.accelShare)} ms`,
    );
  }
  suite.ok(
    'the brake decays onto a floor, so the wheel is still moving when the pin catches it',
    WHEEL_SPIN.brakeFloor > 0 && WHEEL_SPIN.brakeFloor < 0.3,
    String(WHEEL_SPIN.brakeFloor),
  );
  suite.ok(
    'the landing wobble stays inside half a segment, as the engine requires',
    jitterDeg < SEGMENT_ANGLE / 2,
    `jitter ${jitterDeg}° vs half segment ${SEGMENT_ANGLE / 2}°`,
  );
  suite.ok(
    'the reduced-motion hop is a fraction of the real spin',
    WHEEL_SPIN.reducedMotionDurationMs > 0 &&
      WHEEL_SPIN.reducedMotionDurationMs < durationMs / 10,
    String(WHEEL_SPIN.reducedMotionDurationMs),
  );

  /* ----------------------------------------------------------------------
     The landing angle is the engine's, not the animation's
     ---------------------------------------------------------------------- */
  {
    const failures = [];
    let plans = 0;

    for (let index = 0; index < WHEEL_SEGMENTS.length; index += 1) {
      for (let jitter = -jitterDeg; jitter <= jitterDeg; jitter += jitterDeg) {
        const stopAngle = normalizeAngle(rotationForSegment(index) + jitter);
        const plan = planWheelSpin({ fromRotation: 0, stopAngle, turns: minTurns, jitter, durationMs });

        plans += 1;
        const landed = normalizeAngle(rotationAt(plan, plan.durationMs));
        if (Math.abs(landed - stopAngle) > TOL) {
          failures.push(`segment ${index} jitter ${jitter}: ${landed} vs ${stopAngle}`);
        }
        // And it is still the same segment the engine paid out on.
        if (Math.abs(angularDelta(landed, rotationForSegment(index))) > jitterDeg + 0.01) {
          failures.push(`segment ${index} jitter ${jitter}: drifted past the wobble`);
        }
      }
    }

    suite.ok(
      'the disc lands exactly on the angle the engine decided, wobble included',
      failures.length === 0,
      failures.join('; ') || `${plans} plans`,
    );
    suite.ok('every segment and wobble was audited', plans === WHEEL_SEGMENTS.length * 3, String(plans));
  }

  /* ----------------------------------------------------------------------
     The tick past the pin can never leave the winning wedge
     ---------------------------------------------------------------------- */
  {
    const failures = [];
    let samples = 0;
    let deepest = 0;

    for (let index = 0; index < WHEEL_SEGMENTS.length; index += 1) {
      for (let jitter = -jitterDeg; jitter <= jitterDeg; jitter += jitterDeg) {
        const stopAngle = normalizeAngle(rotationForSegment(index) + jitter);
        const plan = planWheelSpin({ fromRotation: 0, stopAngle, turns: maxTurns, jitter, durationMs });

        // The furthest the disc ever gets past the target, over real frames.
        for (let t = 0; t <= plan.durationMs; t += FRAME_MS) {
          samples += 1;
          const past = rotationAt(plan, t) - plan.to;
          deepest = Math.max(deepest, past);
          if (past > SEGMENT_ANGLE / 2 + TOL) {
            failures.push(`segment ${index} jitter ${jitter} at ${Math.round(t)}ms: ${past.toFixed(3)}° past`);
          }
        }
      }
    }

    suite.ok(
      'the tick past the pin never spills into the next segment',
      failures.length === 0,
      failures.slice(0, 3).join('; '),
    );
    suite.ok(
      'the overshoot is a real tick, not a whole segment',
      deepest > 0.5 && deepest < SEGMENT_ANGLE / 2,
      `${deepest.toFixed(2)}° of a ${SEGMENT_ANGLE}° wedge`,
    );
    suite.ok('the tick was audited on the frame grid', samples > 5_000, `${samples} frames`);
  }

  /* ----------------------------------------------------------------------
     The travel beat: forward, smooth, and slowing into the hand-off
     ---------------------------------------------------------------------- */
  {
    const plan = planWheelSpin({ fromRotation: 0, stopAngle: rotationForSegment(4), turns: maxTurns, durationMs });
    const brakeMs = plan.phases.brakeMs;

    suite.eq('the travel ends where the landing starts', plan.phases.brakeMs + plan.phases.landingMs, durationMs);
    suite.ok(
      'the drum only ever goes forwards, and never fewer turns than the engine drew',
      plan.to - plan.from >= minTurns * 360 && plan.to > plan.from,
      `${plan.to - plan.from}°`,
    );
    suite.ok(
      'the travel beat is a full turn count plus the shortest path to the landing',
      Math.abs(plan.travel - (plan.to + plan.overshoot - plan.from)) < TOL,
    );

    const positions = [];
    const speeds = [];
    for (let t = 0; t < brakeMs; t += FRAME_MS) {
      positions.push(rotationAt(plan, t));
      speeds.push(velocityAt(plan, t));
    }

    const rewinds = positions.filter((value, i) => i > 0 && value < positions[i - 1] - TOL);
    suite.ok('the travel beat never rewinds', rewinds.length === 0, `${rewinds.length} backward frames`);

    const peak = Math.max(...speeds);
    const handoff = velocityAt(plan, brakeMs - 0.001);
    suite.ok(
      'the wheel decelerates: it hands over at a crawl, not at speed',
      handoff < peak * 0.2 && handoff > 0,
      `hand-off ${handoff.toFixed(4)}°/ms vs peak ${peak.toFixed(4)}°/ms`,
    );
    suite.ok(
      'the peak speed is reached during the hold, not at the end',
      Math.abs(velocityAt(plan, brakeMs * (WHEEL_SPIN.accelShare + WHEEL_SPIN.peakShare) / 2) - peak) < 1e-6,
    );
    suite.ok(
      'the reported peak is the real instantaneous peak, not the average',
      Math.abs(plan.peakVelocity - peak) < 1e-9 && plan.peakVelocity > plan.meanVelocity * 1.5,
      `peak ${plan.peakVelocity.toFixed(3)} vs mean ${plan.meanVelocity.toFixed(3)} deg/ms`,
    );
    suite.ok(
      'the wheel is fast enough at its peak to blur the wedges between frames',
      plan.peakVelocity * FRAME_MS > SEGMENT_ANGLE / 2,
      `${(plan.peakVelocity * FRAME_MS).toFixed(1)}\u00b0 per frame`,
    );
    suite.ok(
      'the peak is fast enough to flick the pin to full deflection',
      plan.peakVelocity > WHEEL_SPIN.pinFullFlickSpeed,
      `${plan.peakVelocity.toFixed(2)} vs ${WHEEL_SPIN.pinFullFlickSpeed}`,
    );
    suite.ok(
      'the travel beat covers the whole tick past the pin',
      Math.abs(rotationAt(plan, brakeMs) - plan.reach) < TOL,
      `${rotationAt(plan, brakeMs)} vs ${plan.reach}`,
    );
    suite.ok(
      'the landing beat is long enough to see the rebound',
      plan.phases.landingMs >= 300,
      `${plan.phases.landingMs} ms`,
    );
  }

  /* ----------------------------------------------------------------------
     The landing beat: tick past, swing back, settle dead on the target
     ---------------------------------------------------------------------- */
  {
    const plan = planWheelSpin({ fromRotation: 0, stopAngle: rotationForSegment(7), turns: maxTurns, durationMs });
    const { brakeMs, landingMs } = plan.phases;
    const past = [];
    for (let t = brakeMs; t <= durationMs; t += FRAME_MS) past.push(rotationAt(plan, t) - plan.to);

    suite.ok('the landing starts exactly where the travel left it', Math.abs(past[0] - plan.overshoot) < 1e-6);
    suite.ok('the landing ticks past the pin', past[0] > 0, `${past[0].toFixed(3)}°`);
    suite.ok(
      'the disc then swings back the other side of the target before settling',
      Math.min(...past) < -plan.overshoot * 0.05,
      `${Math.min(...past).toFixed(3)}°`,
    );
    suite.ok(
      'the deepest point of the tick is the planned one',
      Math.abs(Math.max(...past) - plan.overshoot) < 1e-6,
      `${Math.max(...past).toFixed(3)}° vs ${plan.overshoot}`,
    );
    suite.eq('the last frame is the target, exactly', rotationAt(plan, durationMs), plan.to);
    suite.eq('there is nothing to snap: the disc stops with zero velocity', velocityAt(plan, durationMs), 0);
    suite.ok(
      'the wobble is continuous through the hand-off, so the disc cannot jump',
      Math.abs(rotationAt(plan, brakeMs) - rotationAt(plan, brakeMs - FRAME_MS)) < plan.travel / 40,
    );
    suite.ok('the landing beat has no gaps', landingMs > 0 && past.length > 10, `${past.length} frames`);
  }

  /* ----------------------------------------------------------------------
     The STOP: the drum has to ARRIVE, not have to be stopped
     ----------------------------------------------------------------------
     This is the block whose absence let a coast-then-slam ship. Every other
     property of the landing was asserted — the exact target, the tick past the
     pin, the damped rebound, the zero-velocity finish — while the one the
     player actually notices was not: that the drum SLOWS all the way in.

     The brake used to be a pure power decay, `(1 - u) ** exponent`, and its
     slope is zero as it arrives. It therefore flattened onto `brakeFloor` and
     the drum coasted onto the pin at HALF A REVOLUTION PER SECOND. Measured on
     the old settings the bite fell to 1/23rd of its opening value over the last
     22 % of the travel, and the hand-off had to absorb 0.235 deg/ms — 3.92° of
     travel lost in a single frame — which is exactly the "it just stops" the
     whole landing was supposed to avoid.
     ---------------------------------------------------------------------- */
  {
    // Every spin the engine can actually produce, not one convenient one.
    const spins = [];
    for (let turns = minTurns; turns <= maxTurns; turns += 1) {
      for (const jitter of [-jitterDeg, -jitterDeg / 2, 0, jitterDeg / 2, jitterDeg]) {
        spins.push(
          planWheelSpin({ stopAngle: rotationForSegment(1) + jitter, turns, jitter, durationMs }),
        );
      }
    }

    /* --- 0. the blend means what its knob says ---------------------------- */
    suite.ok(
      'the brake blend means what it says: w = 1 is a straight line, w = 0 is a power decay',
      // A blend whose two terms are transposed is exactly how a knob ends up
      // meaning the OPPOSITE of its own documentation — which is the state this
      // fix was briefly in. Evaluated at the midpoint of the brake, on a shape
      // stripped to nothing but the blend: a straight line in d gives 0.5 there
      // and a cubic gives 0.125, so the two readings cannot be confused.
      (() => {
        const bare = { accel: 0, peak: 0, exponent: 3, floor: 0, ramp: 0.62 };
        return (
          Math.abs(profileVelocity(0.5, { ...bare, linear: 1 }) - 0.5) < 1e-9 &&
          Math.abs(profileVelocity(0.5, { ...bare, linear: 0 }) - 0.125) < 1e-9
        );
      })(),
      `w=1 → ${profileVelocity(0.5, { accel: 0, peak: 0, exponent: 3, floor: 0, ramp: 0.62, linear: 1 })}, w=0 → ${profileVelocity(0.5, { accel: 0, peak: 0, exponent: 3, floor: 0, ramp: 0.62, linear: 0 })}`,
    );
    suite.ok(
      'and the shipped setting is neither extreme: some straight line, some decay',
      // Pure linear brakes on rails and loses the wheel's weight; pure power is
      // the coast-then-slam. Neither belongs in the cabinet.
      brakeLinearShare > 0.25 && brakeLinearShare < 0.85,
      String(brakeLinearShare),
    );

    /* --- 1. the drum is genuinely crawling when the pin takes it ---------- */
    const slowest = Math.max(...spins.map((plan) => plan.catchVelocity / plan.peakVelocity));
    suite.ok(
      'the drum is a creep when the pin takes it, not still spinning',
      // A spring-loaded flapper can only stop a wheel that is nearly stopped. A
      // floor high enough to leave it visibly turning makes the catch a
      // collision rather than a catch, which is what the listener hears as a
      // sudden stop.
      slowest < 0.08,
      `worst ${((slowest * 100).toFixed(1))}% of peak (${((spins[0].catchVelocity * 1000) / 360).toFixed(3)} rev/s on the reference spin)`,
    );

    /* --- 2. the brake is still braking on the very last frame ------------- */
    const decelAt = (plan, u) => {
      const dt = plan.phases.brakeMs / 2000;
      return (
        (velocityAt(plan, u * plan.phases.brakeMs - dt) -
          velocityAt(plan, u * plan.phases.brakeMs + dt)) /
        (2 * dt)
      );
    };
    const ratio = spins.map((plan) => decelAt(plan, 0.995) / decelAt(plan, 0.2));
    suite.ok(
      'the brake never gives up: it is still decelerating on the last frame',
      spins.every((plan) => decelAt(plan, 0.995) > 0),
      `${decelAt(spins[0], 0.995).toExponential(2)} deg/ms^2 closing`,
    );
    suite.ok(
      'and its bite has not faded away by then',
      // The failure this guards: a decay whose slope vanishes flattens onto its
      // floor, so the closing deceleration collapses and the drum coasts. On the
      // old curve this ratio was 0.043 — 96 % of the bite gone.
      Math.min(...ratio) > 0.15,
      `worst closing deceleration is ${(Math.min(...ratio) * 100).toFixed(0)}% of the opening one`,
    );

    /* --- 3. no coasting plateau ------------------------------------------- */
    const coast = spins.map((plan) => {
      const limit = plan.catchVelocity * 1.25;
      let ms = 0;
      for (let t = 0; t <= plan.phases.brakeMs; t += 1) {
        if (velocityAt(plan, t) <= limit) ms += 1;
      }
      return ms / plan.phases.brakeMs;
    });
    suite.ok(
      'the drum never coasts at a constant speed — the tail of the spin is spent slowing',
      Math.max(...coast) < 0.08,
      `worst ${(Math.max(...coast) * 100).toFixed(1)}% of the travel within 1.25× the catch speed`,
    );

    /* --- 3b. and the LAST 1.5 s decelerates at a predictable rate ---------
       The other half of "it just stops" is the player's ability to read the
       approach: over the stretch they are actually watching, the wheel has to
       shed speed at a rate that holds steady as the pegs come up, not one that
       keeps changing its mind. Measured on the shipped blend the deceleration
       varies by 1.33x across the last 1.5 s; at a blend of 0.55 — the setting
       this replaced — it varied by 1.94x. The threshold sits between the two,
       so it fails the old curve and passes the new one with ~36 % headroom.
       -------------------------------------------------------------------- */
    const SMOOTH_TAIL_LIMIT = 1.8;
    const tails = spins.map((plan) => {
      const dt = 2;
      const values = [];
      // Stop short of the hand-off: one step past it is the REBOUND's first
      // instant, whose velocity points the other way and would masquerade as an
      // enormous closing deceleration.
      for (let t = plan.phases.brakeMs - 1500; t <= plan.phases.brakeMs - dt - 1; t += dt) {
        values.push(((velocityAt(plan, t - dt) - velocityAt(plan, t + dt)) / (2 * dt)) * 1000);
      }
      return Math.max(...values) / Math.min(...values);
    });
    suite.ok(
      'the last 1.5 s decelerates at a near-constant rate, so the approach is predictable',
      Math.max(...tails) < SMOOTH_TAIL_LIMIT,
      `worst tail varies by ${Math.max(...tails).toFixed(2)}x (a blend of 0.55 varied by 1.94x)`,
    );

    /* --- 4. the hand-off cannot read as a wall ---------------------------- */
    const jumps = spins.map((plan) => {
      const planBefore = velocityAt(plan, plan.phases.brakeMs - 1e-6);
      const planAfter = velocityAt(plan, plan.phases.brakeMs + 1e-6);
      return { share: Math.abs(planBefore - planAfter) / plan.peakVelocity, deg: Math.abs(planBefore - planAfter) * FRAME_MS };
    });
    suite.ok(
      'the speed the drum arrives at is close to the speed the rebound starts at',
      // The two beats are deliberately not velocity-continuous — a pin catch IS
      // an inelastic collision — so what matters is the SIZE of the step. It has
      // to stay small enough to read as a mechanism catching, not as a wall.
      Math.max(...jumps.map((j) => j.share)) < 0.065,
      `worst step is ${(Math.max(...jumps.map((j) => j.share)) * 100).toFixed(1)}% of the peak speed`,
    );
    suite.ok(
      'so no single frame of the stop throws the wheel backwards',
      Math.max(...jumps.map((j) => j.deg)) < 2,
      `worst ${Math.max(...jumps.map((j) => j.deg)).toFixed(2)}° lost in one 60 Hz frame (the old curve lost 3.92°)`,
    );

    /* --- 5. and the tick past the pin is the size the config asks for ----- */
    const reference = planWheelSpin({
      stopAngle: rotationForSegment(1),
      turns: maxTurns,
      jitter: 0,
      durationMs,
    });
    suite.ok(
      'the wheel ticks a few degrees past the target, as the cabinet is tuned for',
      reference.overshoot >= 3 && reference.overshoot <= 7,
      `${reference.overshoot}° past the target`,
    );
  }

  /* ----------------------------------------------------------------------
     The overshoot is capped against the room the wobble left
     ---------------------------------------------------------------------- */
  {
    const wide = planWheelSpin({ stopAngle: 0, jitter: 0, turns: maxTurns, durationMs, overshootDeg: 999 });
    const tight = planWheelSpin({
      stopAngle: 0,
      jitter: jitterDeg,
      turns: maxTurns,
      durationMs,
      overshootDeg: 999,
    });

    suite.ok(
      'a greedy overshoot is capped against the segment, never let through',
      wide.overshoot <= SEGMENT_ANGLE / 2 * 0.62 + TOL,
      `${wide.overshoot}°`,
    );
    suite.ok(
      'the wobble eats into the tick budget, so the edge stays safe',
      tight.overshoot < wide.overshoot,
      `${tight.overshoot} vs ${wide.overshoot}`,
    );
    suite.eq('the peak of the tick is the plan\u2019s overshoot', overshootPeak(wide), wide.overshoot);
    suite.eq('a plan with no overshoot reports none', overshootPeak(null), 0);
  }

  /* ----------------------------------------------------------------------
     The pin flick
     ---------------------------------------------------------------------- */
  {
    const seam = SEGMENT_ANGLE / 2; // a peg passes the pointer every half segment
    const fullSpeed = WHEEL_SPIN.pinFullFlickSpeed;

    suite.eq('a peg at full speed deflects the pin fully', pinFlickAt(seam, fullSpeed), 1);
    suite.eq('seams repeat every segment', pinFlickAt(seam + SEGMENT_ANGLE * 3, fullSpeed), 1);
    suite.eq('a stopped wheel flicks nothing at all', pinFlickAt(seam, 0), 0);

    // The gate. A LINEAR one is wrong at exactly the moment the stop has to sell
    // itself: it fades the arm out as the wheel crawls, so the last few pegs —
    // the ones the player is waiting for — tick against a pin that has gone
    // limp. A flapper is a spring loaded arm each peg has to lift, so at a crawl
    // it flips the whole way, deliberately, right down to the stop.
    suite.ok(
      'a peg still lifts the arm at a crawl, so the final ticks are as definite as the fast ones',
      pinFlickAt(seam, fullSpeed * 0.15) > 0.3 && pinFlickAt(seam, fullSpeed * 0.15) < 1,
      `${pinFlickAt(seam, fullSpeed * 0.15).toFixed(3)} at 15% of speed`,
    );
    suite.ok(
      'and the gate still rises with speed, without ever passing full deflection',
      pinFlickAt(seam, fullSpeed * 0.15) < pinFlickAt(seam, fullSpeed) &&
        pinFlickAt(seam, fullSpeed * 8) === 1,
      `${pinFlickAt(seam, fullSpeed * 0.15).toFixed(3)} → ${pinFlickAt(seam, fullSpeed * 8)}`,
    );

    let over = 0;
    let under = 0;
    const floor = -WHEEL_SPIN.pinBackswing - TOL;
    for (let angle = -720; angle <= 720; angle += 0.25) {
      for (const speed of [0, fullSpeed / 3, fullSpeed, fullSpeed * 4]) {
        const flick = pinFlickAt(angle, speed);
        if (flick > 1 + TOL) over += 1;
        if (flick < floor) under += 1;
      }
    }
    suite.ok(
      'the flick never passes full deflection, nor the travel the spring-back is allowed',
      over === 0 && under === 0,
      `over ${over} · past the backswing ${under} (floor ${floor.toFixed(3)})`,
    );

    // The spring. The arm does not merely return to rest — it swings PAST it,
    // the other way, before coming back. That overshoot is the whole reason a
    // tick reads as a hinge rather than as a number fading out.
    const swing = [];
    for (let deg = 0; deg < SEGMENT_ANGLE; deg += 0.05) swing.push(pinFlickAt(seam + deg, fullSpeed));
    const deepest = Math.min(...swing);
    suite.ok(
      'the arm springs back past its rest position once the peg has let go',
      deepest < -WHEEL_SPIN.pinBackswing * 0.55,
      `${deepest.toFixed(3)} of a −${WHEEL_SPIN.pinBackswing} budget`,
    );
    suite.ok(
      // Measured just short of the next seam, because AT the seam the following
      // peg is already pushing the arm again — the ticks are meant to run back
      // to back there.
      'and it is back at rest before the next peg, so the ticks read as separate',
      swing[0] === 1 && Math.abs(pinFlickAt(seam + SEGMENT_ANGLE - 0.05, fullSpeed)) < 0.05,
      `${swing[0]} \u2192 ${pinFlickAt(seam + SEGMENT_ANGLE - 0.05, fullSpeed).toFixed(4)}`,
    );

    // The deflection is at its strongest the moment a peg passes under the pin.
    const atSeam = pinFlickAt(seam, fullSpeed);
    const justAfter = pinFlickAt(seam + 1.5, fullSpeed);
    const midWedge = pinFlickAt(seam + SEGMENT_ANGLE / 2, fullSpeed);
    suite.ok(
      'the pin is flicked hardest at the seam and springs back across the wedge',
      atSeam > justAfter && justAfter > midWedge,
      `${atSeam.toFixed(2)} > ${justAfter.toFixed(2)} > ${midWedge.toFixed(2)}`,
    );
    suite.ok(
      'the pin is back to rest before the next peg, so the ticks read as separate',
      midWedge < 0.2,
      String(midWedge.toFixed(3)),
    );

    // And it is parked when the wheel has finished.
    const plan = planWheelSpin({ stopAngle: rotationForSegment(2), turns: minTurns, durationMs });
    const finalAngle = rotationAt(plan, durationMs);
    suite.eq(
      'the pin is at rest once the drum has stopped',
      pinFlickAt(finalAngle, velocityAt(plan, durationMs)),
      0,
    );
  }

  /* ----------------------------------------------------------------------
     The last click
     ---------------------------------------------------------------------- */
  {
    const plan = planWheelSpin({ stopAngle: rotationForSegment(4), turns: minTurns, durationMs });
    const lead = WHEEL_SPIN.pinSeatClickMs;
    const edge = plan.durationMs - lead;

    suite.ok(
      'the arm takes one definite click as the wheel seats, inside the last lead-in',
      pinSeatClickAt(plan, plan.durationMs - lead / 2) > WHEEL_SPIN.pinSeatClickDepth * 0.9,
      String(pinSeatClickAt(plan, plan.durationMs - lead / 2)),
    );
    suite.eq(
      'and it is over by the time the spin is, so nothing is left hanging',
      pinSeatClickAt(plan, plan.durationMs),
      0,
    );
    suite.eq('nothing is clicked before the window opens', pinSeatClickAt(plan, edge), 0);
    suite.ok(
      'it joins the peg flicks continuously at the near edge',
      pinSeatClickAt(plan, edge - 1) === 0 &&
        pinSeatClickAt(plan, edge + 1) < WHEEL_SPIN.pinSeatClickDepth * 0.1,
      `${pinSeatClickAt(plan, edge + 1)} on the first frame`,
    );
    suite.eq('a plan with no seat click still lands', pinSeatClickAt(null, 100), 0);

    // The reason it has to be its own term. Across the landing the disc is
    // inside a few degrees at a fraction of a degree per ms, so the pegs alone
    // would leave the arm dead still at the one moment a machine has to look
    // like it has caught hold of the wheel.
    suite.ok(
      'and it is needed, because the wheel\u2019s own wobble cannot produce a tick',
      Math.abs(velocityAt(plan, plan.durationMs - lead / 2)) < WHEEL_SPIN.pinFullFlickSpeed * 0.1,
      `${velocityAt(plan, plan.durationMs - lead / 2).toFixed(4)} °/ms at the click`,
    );
  }

  /* ----------------------------------------------------------------------
     Degenerate inputs must not freeze the cabinet
     ---------------------------------------------------------------------- */
  {
    const zero = planWheelSpin({ stopAngle: rotationForSegment(3), turns: 2, durationMs: 0 });
    suite.eq('a zero-length spin is already at the landing angle', rotationAt(zero, 0), zero.to);
    suite.eq('a zero-length spin has no motion', velocityAt(zero, 0), 0);

    const noResult = planWheelSpin({});
    suite.ok(
      'a plan with no result still spins at least the minimum turns',
      noResult.to - noResult.from >= minTurns * 360,
      String(noResult.to - noResult.from),
    );
    suite.eq('rotationAt tolerates a missing plan', rotationAt(null, 100), 0);
    suite.eq('velocityAt tolerates a missing plan', velocityAt(null, 100), 0);
  }

  suite.note(
    `${durationMs} ms · travel ${Math.round(durationMs * WHEEL_SPIN.brakeShare)} ms → landing ${durationMs - Math.round(durationMs * WHEEL_SPIN.brakeShare)} ms · tick ≤ ${(SEGMENT_ANGLE / 2 * 0.62).toFixed(1)}° of a ${SEGMENT_ANGLE}° wedge`,
  );
}

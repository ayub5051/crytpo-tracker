/* ============================================================================
   SOQQA — Omad charxi physics (pure)
   ----------------------------------------------------------------------------
   The wheel's motion as a closed-form curve, so the landing can be asserted
   exactly instead of watched. A spin is two beats:

     travel   t ∈ [0, brakeMs]        KICK off the line, hold a peak, then brake
                                      down to a crawl and arrive `overshoot`
                                      degrees PAST the target
     landing  t ∈ [brakeMs, end]      the pin catches: an almost inelastic stop
                                      followed by a damped rebound that snaps
                                      back through the target, bounces once the
                                      other way, and settles exactly onto it

   Travel is specified as a velocity profile — a sub-linear kick, a flat peak, a
decaying brake onto a small floor — and integrated in closed form, so the
velocity and the distance travelled are exact and the wheel never has to be
nudged onto the target at the end. Everything is in degrees and milliseconds;
nothing here touches the DOM, so the whole trajectory is testable.

   The two beats are deliberately not velocity-continuous. A real pin catch is
   an inelastic collision: the wheel arrives at the crawl it was braked down to
   and is stopped dead, and only then does the tyre-against-pin rebound begin.
   The position is continuous across the hand-off — that is what would show —
   while the velocity drops off a cliff at exactly the instant the pin is hit.

   The two properties the tests pin down are the ones a player would notice:
   the wheel must land EXACTLY on the drawn segment (including the ±13° jitter
   the engine adds), and the tick past the pin must never carry it over the
   segment edge — the bounce is capped against the room the jitter leaves.
   ========================================================================= */

import { WHEEL_FRAME, WHEEL_SPIN } from '../config.js';
import { FULL_TURN, SEGMENT_ANGLE, normalizeAngle } from '../games/wheel.js';

/**
 * The peak of the flapper's spring lobe, `x ** 1.2 * (1 - x) ** 1.6` — solved
 * analytically (the maximum sits at `1.2 / (1.2 + 1.6)`), so `pinBackswing` can
 * be read as a plain share of the full deflection instead of an arbitrary knob.
 */
const SPRING_PEAK = (1.2 / 2.8) ** 1.2 * (1 - 1.2 / 2.8) ** 1.6;

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const landingOmega = () => 2 * Math.PI * (Number(WHEEL_SPIN.landingSwings) || 1);

/**
 * The travel's velocity profile, normalised to a peak of 1: a kick off the
 * line, a flat peak, then a brake that blends a constant deceleration with a
 * power decay, onto `floor`.
 *
 * The ramp is `(u / accel) ** rampExponent`. With the shipped exponent below 1
 * it is not a wind-up but a kick: the drum is most of the way to speed almost
 * immediately, which is what a heavy wheel driven by a motor actually does.
 *
 * The brake's shape is the thing that decides whether the stop reads as a stop
 * or as a wall, and the blend is why (see `brakeLinearShare` in config.js): a
 * pure `(1 - u) ** exponent` decay has a slope of ZERO as it arrives, so the
 * drum flattens onto `floor` and coasts — at half a revolution per second, on
 * the previous numbers — until the catch stops it in one frame.
 *
 *   v = floor + (1 - floor) · d · (w + (1 - w) · d ** (exponent - 1))
 *   where d = (1 - u) / (1 - peakShare)  and  w = brakeLinearShare
 *
 * `w` is the share of the brake that is a bare straight line in velocity, and it
 * is the load-bearing half. At `w = 1` the slope at the catch is `1 - floor`,
 * the largest it can be; at `w = 0` the curve is a pure power decay whose slope
 * VANISHES as it arrives — the coast-then-slam. A test injects `w = 0` and fails
 * if the closing deceleration is allowed to collapse, and another injects the
 * two halves swapped, because a blend whose terms are transposed is exactly how
 * a knob ends up meaning the opposite of its own documentation.
 */
export function profileVelocity(u, shape) {
  const { accel, peak, exponent, floor, ramp, linear } = shape;
  if (u <= accel) return accel > 0 ? (u / accel) ** ramp : 1;
  if (u <= peak) return 1;
  const decay = clamp01((1 - u) / (1 - peak));
  return floor + (1 - floor) * decay * (linear + (1 - linear) * decay ** (exponent - 1));
}

/** ∫₀ᵘ of the velocity profile. */
function profileIntegral(u, shape) {
  const { accel, peak, exponent, floor, ramp, linear } = shape;
  if (u <= accel) return accel > 0 ? (accel * (u / accel) ** (ramp + 1)) / (ramp + 1) : u;
  const kick = accel > 0 ? accel / (ramp + 1) : 0;
  if (u <= peak) return kick + (u - accel);
  const decay = clamp01((1 - u) / (1 - peak));
  return (
    kick +
    (peak - accel) +
    (1 - peak) *
      (floor * (1 - decay) +
        ((1 - floor) * linear * (1 - decay ** 2)) / 2 +
        ((1 - floor) * (1 - linear) * (1 - decay ** (exponent + 1))) / (exponent + 1))
  );
}

/**
 * ∫₀¹, which is what normalises the profile so the distance travelled is 1.
 *
 * Read straight off `profileIntegral` rather than written out a second time: a
 * separate closed form is one more place for the shape and its own integral to
 * quietly disagree, and the whole landing depends on them agreeing.
 */
function shapeTotal(shape) {
  return profileIntegral(1, shape);
}

/**
 * Plan one spin.
 *
 * @param {{
 *   fromRotation?: number, stopAngle?: number, turns?: number, jitter?: number,
 *   durationMs?: number, overshootDeg?: number,
 * }} [options]
 * @returns {object} the plan consumed by `rotationAt` / `velocityAt`
 */
export function planWheelSpin({
  fromRotation = 0,
  stopAngle = 0,
  turns = WHEEL_SPIN.minTurns,
  jitter = 0,
  durationMs = WHEEL_SPIN.durationMs,
  overshootDeg = WHEEL_SPIN.overshootDeg,
} = {}) {
  const from = Number(fromRotation) || 0;
  const duration = Math.max(0, Number(durationMs) || 0);

  // Always continue forwards: whole turns onto the shortest path to the landing
  // angle, so the disc never rewinds and the pointer still ends on the segment.
  const spins = Math.max(1, Math.round(Number(turns) || WHEEL_SPIN.minTurns));
  const forward = normalizeAngle((Number(stopAngle) || 0) - normalizeAngle(from));
  const to = from + spins * FULL_TURN + forward;

  // The tick past the pin has to stay inside the winning wedge. The jitter the
  // engine already applied eats into the room the segment has left, so the
  // overshoot is derived from what remains rather than being a flat constant.
  const room = Math.max(0, SEGMENT_ANGLE / 2 - Math.abs(Number(jitter) || 0));
  const overshoot = Math.max(0, Math.min(Number(overshootDeg) || 0, room * 0.62));

  const brakeMs = Math.round(duration * WHEEL_SPIN.brakeShare);
  const landingMs = Math.max(0, duration - brakeMs);

  const shape = Object.freeze({
    accel: WHEEL_SPIN.accelShare,
    peak: WHEEL_SPIN.peakShare,
    exponent: WHEEL_SPIN.brakeExponent,
    floor: WHEEL_SPIN.brakeFloor,
    ramp: WHEEL_SPIN.rampExponent,
    linear: WHEEL_SPIN.brakeLinearShare,
  });

  // The travel beat covers the whole spin PLUS the tick past the pin; the
  // landing beat is what walks that tick back onto the target.
  const travel = to + overshoot - from;

  return Object.freeze({
    from,
    to,
    /** Where the travel beat arrives: past the target, never past the wedge. */
    reach: to + overshoot,
    travel,
    overshoot,
    durationMs: duration,
    phases: Object.freeze({
      accelMs: Math.round(brakeMs * shape.accel),
      peakMs: Math.round(brakeMs * shape.peak),
      brakeMs,
      landingMs,
    }),
    shape,
    total: shapeTotal(shape),
    /** Mean degrees per ms across the travel beat. */
    meanVelocity: brakeMs > 0 ? travel / brakeMs : 0,
    /**
     * Degrees per ms at the flat peak, in *real* units — the number that says
     * how fast the wheel actually looks, and the one the pin flick is gated
     * against (WHEEL_SPIN.pinFullFlickSpeed).
     */
    peakVelocity: brakeMs > 0 ? travel / brakeMs / shapeTotal(shape) : 0,
    /**
     * Degrees per ms the drum is still doing when the pin catches it — the
     * crawl the brake left it at, and the speed the pin has to stop.
     *
     * Read off the TRAVEL beat deliberately. `velocityAt` at exactly
     * `brakeMs` is landing-side (the boundary belongs to the rebound, so the
     * position stays continuous), which means it reports the first instant of
     * the counter-swing — a negative number. That is the wrong quantity for
     * anything that has to keep going forward when the wheel is caught, such as
     * the rim lights' flywheel (see `bandStateAt`), so the crawl is published
     * here in its own right instead of being re-derived at the seam.
     */
    catchVelocity: brakeMs > 0 ? (travel / brakeMs / shapeTotal(shape)) * shape.floor : 0,
  });
}

/**
 * Rotation to apply `ms` into the spin.
 * @param {object} plan
 * @param {number} ms
 * @returns {number} absolute degrees
 */
export function rotationAt(plan, ms) {
  if (!plan) return 0;
  if (plan.durationMs === 0) return plan.to;

  const t = Math.max(0, Math.min(Number(ms) || 0, plan.durationMs));
  const { brakeMs, landingMs } = plan.phases;

  if (t < brakeMs && brakeMs > 0) {
    const u = t / brakeMs;
    return plan.from + plan.travel * (profileIntegral(u, plan.shape) / plan.total);
  }

  if (landingMs <= 0 || plan.overshoot === 0) return plan.to;

  // The pin's rebound: a damped cosine about the target, windowed by (1 - s)²
  // so it is exactly 0 at both ends — the wheel both arrives where the travel
  // left it and finishes dead on the target, with nothing to snap at the end.
  const s = clamp01((t - brakeMs) / landingMs);
  const damping = Math.max(0, Number(WHEEL_SPIN.landingDamping) || 0);
  const swing =
    (1 - s) ** 2 * Math.exp(-damping * s) * Math.cos(landingOmega() * s);
  return plan.to + plan.overshoot * swing;
}

/**
 * Angular velocity at `ms`, in degrees per millisecond (signed).
 * @param {object} plan
 * @param {number} ms
 */
export function velocityAt(plan, ms) {
  if (!plan || plan.durationMs === 0) return 0;

  const t = Math.max(0, Math.min(Number(ms) || 0, plan.durationMs));
  const { brakeMs, landingMs } = plan.phases;

  if (t < brakeMs && brakeMs > 0) {
    return (plan.travel / brakeMs / plan.total) * profileVelocity(t / brakeMs, plan.shape);
  }
  if (landingMs <= 0) return 0;

  const s = clamp01((t - brakeMs) / landingMs);
  const damping = Math.max(0, Number(WHEEL_SPIN.landingDamping) || 0);
  const omega = landingOmega();
  const decay = Math.exp(-damping * s);
  const cos = Math.cos(omega * s);
  const sin = Math.sin(omega * s);
  const slope = decay * ((-2 * (1 - s) - damping * (1 - s) ** 2) * cos - omega * (1 - s) ** 2 * sin);
  return (plan.overshoot * slope) / landingMs;
}

/**
 * How hard a spoke flicks the pin, `-pinBackswing` … 1.
 *
 * A spoke hits the pin as its seam passes underneath, so the deflection is a
 * spike at the seam that falls away across the wedge. Two things make it read as
 * a hinged arm rather than as a number fading out:
 *
 *   • THE SPRING. Once the peg has let go, the arm does not merely return to
 *     rest — it swings PAST it, the other way, before coming back. That
 *     overshoot is the whole reason a tick looks mechanical, and it is why this
 *     may return a negative deflection (`-pinBackswing` at its deepest).
 *   • THE GATE. The arm is a spring each peg has to lift, so the deflection is
 *     scaled by speed — but not linearly. A linear gate goes limp exactly when
 *     the stop needs it most, as the wheel crawls. Below 1 (pinFlickGamma) the
 *     gate reaches full deflection early and HOLDS it, so the last few pegs tick
 *     as hard as the fast ones did.
 *
 * The seam sits half a segment off zero, which is the same offset the wedges are
 * painted with.
 *
 * @param {number} rotation — absolute disc rotation, degrees
 * @param {number} speed — angular velocity, degrees per ms
 * @returns {number} 0 (pin at rest) … 1 (fully deflected), dipping negative on
 *   the spring back
 */
export function pinFlickAt(rotation, speed) {
  const phase =
    ((((Number(rotation) || 0) - SEGMENT_ANGLE / 2) % SEGMENT_ANGLE) + SEGMENT_ANGLE) % SEGMENT_ANGLE;
  const x = phase / SEGMENT_ANGLE;
  const push = (1 - x) ** 3;

  // The spring's response, over the back of the wedge. Normalised so its peak is
  // exactly 1, which is what lets `pinBackswing` be read as a plain share of the
  // full deflection. Zero at both seams, so the ticks never run into each other.
  const lobe = (x ** 1.2 * (1 - x) ** 1.6) / SPRING_PEAK;
  const backswing = Math.max(0, Number(WHEEL_SPIN.pinBackswing) || 0);

  const gate = clamp01(Math.abs(Number(speed) || 0) / WHEEL_SPIN.pinFullFlickSpeed) **
    Math.max(0, Number(WHEEL_SPIN.pinFlickGamma) || 0);

  return (push - backswing * lobe) * gate;
}

/**
 * The final click, as the drum's rebound dies and the last peg seats.
 *
 * The wheel's own wobble across the landing is only a few degrees — far too
 * little to move the arm's angle enough to generate a tick — so a machine that
 * relies on it alone simply stops, with no last click to tell you it has. This
 * is that click, delivered as its own pulse over the final `pinSeatClickMs` of
 * the spin: nothing at either end, so it joins the flick curve continuously.
 *
 * @param {object} plan — from `planWheelSpin`
 * @param {number} ms
 * @returns {number} 0 … `pinSeatClickDepth`, in the same units as `pinFlickAt`
 */
export function pinSeatClickAt(plan, ms) {
  if (!plan) return 0;
  const depth = Math.max(0, Number(WHEEL_SPIN.pinSeatClickDepth) || 0);
  const span = Math.min(Math.max(0, Number(WHEEL_SPIN.pinSeatClickMs) || 0), plan.durationMs);
  if (depth === 0 || span === 0) return 0;

  const start = plan.durationMs - span;
  const t = Math.max(0, Math.min(Number(ms) || 0, plan.durationMs));
  if (t <= start || t >= plan.durationMs) return 0;

  // `sin ** 0.7` rather than `sin`: a peg seats sharply, so the pulse has to
  // rise fast and fall slowly, not swell like a breath.
  return depth * Math.sin((Math.PI * (t - start)) / span) ** 0.7;
}

/** The widest angle the wheel ever reaches past its target, in degrees. */
export function overshootPeak(plan) {
  if (!plan || !plan.overshoot) return 0;
  return plan.overshoot;
}

/* ============================================================================
   The rim lights
   ----------------------------------------------------------------------------
   A row of bulbs around a wheel is not a blinking decoration: each lamp is a
   physical light source, and there are two things moving through the ring.

     • The TRAVELLING HEAD — one pass of light with a long tail, whose angle is
       geared off the drum's own angular velocity. It is only a bias in the
       bulb's final brightness, but it is the part that makes the ring legible
       as a WHEEL turning rather than as a ring blinking.
     • The SVETOMUZIKA — the odd half of the ring flashing against the even
       half. This is the effect a player actually recognises, and its cadence
       comes off the SAME integrated band angle, so it speeds up and slows down
       with the wheel instead of running on a clock of its own.

   Everything here is in closed form and without any DOM, so the ring can be
   asserted on its own:

     • the band travels at the drum's surface speed (scaled and clamped), so
       neither effect can run at a cadence the wheel is not actually turning at;
     • the two halves of the flash read one wave 180° apart, so the split cannot
       drift; a bulb's head term depends only on how far the head has passed it,
       so it turns on and off exactly once per pass;
     • the settle is one decaying factor shared by the band's rate and its
       brightness, which is what makes the ring wind down with the wheel rather
       than stop dead.
   ========================================================================= */

/** The fastest the band may travel, in degrees per millisecond. */
export function bandMaxRate(maxRevPerSec = WHEEL_FRAME.chaseMaxRevPerSec) {
  return (Math.max(0, Number(maxRevPerSec) || 0) * FULL_TURN) / 1000;
}

/**
 * The band's angular rate, in degrees per millisecond, at a given drum speed.
 *
 * Signed like the drum, so the light always chases the way the wheel turns,
 * and clamped in magnitude — an unclamped gain on 4.8 rev/s would sweep the
 * whole ring between two frames and read as a flicker rather than a chase.
 *
 * @param {number} speed — drum angular velocity, degrees per ms
 * @param {{ gain?: number, maxRevPerSec?: number }} [options]
 */
export function bandRate(
  speed,
  { gain = WHEEL_FRAME.chaseGain, maxRevPerSec = WHEEL_FRAME.chaseMaxRevPerSec } = {},
) {
  const max = bandMaxRate(maxRevPerSec);
  const raw = (Number(speed) || 0) * (Number(gain) || 0);
  return raw > max ? max : raw < -max ? -max : raw;
}

/**
 * How brightly the lamp at `lampAngle` burns while the band's head is at
 * `bandAngle`, 0…1.
 *
 * The head is the brightest point and the tail stretches `arcDeg` behind it,
 * so `1` sits right under the head and the lamp is dark again once the tail has
 * swept clear — one on/off per pass, never a lamp that blinks twice.
 *
 * @param {number} lampAngle
 * @param {number} bandAngle
 * @param {{ arcDeg?: number, tailExponent?: number }} [options]
 */
export function lampIntensity(
  lampAngle,
  bandAngle,
  { arcDeg = WHEEL_FRAME.sweepArcDeg, tailExponent = WHEEL_FRAME.tailExponent } = {},
) {
  const arc = Math.max(0, Number(arcDeg) || 0);
  if (arc === 0) return 0;

  // How far the head has travelled PAST this lamp: 0 under the head, growing
  // towards `arc` as the tail clears it, and wrapping back to 0 on the next pass.
  const passed = (((Number(bandAngle) - Number(lampAngle)) % FULL_TURN) + FULL_TURN) % FULL_TURN;
  if (passed >= arc) return 0;
  return (1 - passed / arc) ** Math.max(0, Number(tailExponent) || 0);
}

/**
 * Whether bulb `index` is on its bright or its dim half of the marquee, 0…1.
 *
 * This is the "svetomuzika" — the odd half of the ring flashing against the
 * even half. It is NOT a timer: one full flash happens per `flashStepDeg` of
 * BAND travel, and the band's rate is geared off the drum and clamped (see
 * `bandRate`), so the ring flashes faster as the wheel winds up, slows as it
 * slows, and dies away with it. There is no separate clock that could drift out
 * of step with the wheel it is supposed to be lit by, and because the cadence
 * is capped by the same clamp, the flash can never alias into a blur.
 *
 * The wave is a raised cosine rather than a square: a bulb on a dimmer ramps, so
 * the two halves CROSS instead of snapping, and that crossing is what gives the
 * ring its warm gold/amber pulse.
 *
 * Both halves read the same wave, exactly 180° apart, which is what keeps the
 * split honest: when the odd bulbs are at their brightest the even ones are at
 * their dimmest, by construction rather than by two clocks agreeing.
 *
 * @param {number} index — the lamp's place on the ring
 * @param {number} bandAngle — the integrated band angle, in degrees
 * @param {{ stepDeg?: number }} [options]
 * @returns {number} 0 (as dim as the marquee goes) … 1 (as bright as it goes)
 */
export function alternationAt(index, bandAngle, { stepDeg = WHEEL_FRAME.flashStepDeg } = {}) {
  const step = Math.max(1e-6, Number(stepDeg) || 1);
  const i = Math.max(0, Math.trunc(Number(index) || 0));
  const wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * (Number(bandAngle) || 0)) / step);
  return i % 2 === 0 ? wave : 1 - wave;
}

/**
 * Snap a lamp's brightness to the nearest of `levels` steps.
 *
 * Bulbs are on a physical ring, not an analogue dimmer: stepping is what makes
 * a row of them read as a marquee, and it is also what keeps the per-frame cost
 * down to the lamps that actually crossed a step.
 */
export function quantizeIntensity(value, levels = WHEEL_FRAME.litLevels) {
  const steps = Math.max(1, Math.round(Number(levels) || 1));
  const v = clamp01(Number(value) || 0);
  return Math.round(v * steps) / steps;
}

/**
 * How much of the flywheel is left `elapsedMs` after the pin caught it, 1 → 0.
 * @param {number} elapsedMs — since the catch (NOT since the spin began)
 * @param {number} [settleMs]
 * @param {number} [decay]
 */
export function settleFactor(elapsedMs, settleMs = WHEEL_FRAME.settleMs, decay = WHEEL_FRAME.settleRateDecay) {
  const span = Math.max(0, Number(settleMs) || 0);
  const elapsed = Number(elapsedMs) || 0;
  if (elapsed <= 0) return 1;
  if (span === 0 || elapsed >= span) return 0;
  return (1 - elapsed / span) ** Math.max(0, Number(decay) || 0);
}

/**
 * The clamping surge the whole ring gives the instant the pin stops the wheel.
 *
 * Added to every lamp at once — this is not a chase, it is the machine landing:
 * a warm pulse that decays over `settleFlickMs` in `settleFlickCount` flashes. It
 * starts at its full depth on the catch and is exactly zero at the end of its
 * window, so it leaves no residual brightness behind and never fights the ring's
 * resting level.
 *
 * @param {number} elapsedMs — since the catch
 * @returns {number} 0 … `settleFlickDepth`
 */
export function settleFlickAt(elapsedMs) {
  const depth = Math.max(0, Number(WHEEL_FRAME.settleFlickDepth) || 0);
  const span = Math.max(0, Number(WHEEL_FRAME.settleFlickMs) || 0);
  const elapsed = Number(elapsedMs) || 0;
  if (depth === 0 || span === 0) return 0;
  if (elapsed <= 0) return depth;
  if (elapsed >= span) return 0;

  const s = elapsed / span;
  const flashes = Math.max(1, Math.round(Number(WHEEL_FRAME.settleFlickCount) || 1));
  // `cos` peaks at the catch and again at every whole flash: the ring is at its
  // brightest the instant the pin bites, dips, then surges smaller each time.
  const pulse = 0.5 + 0.5 * Math.cos(2 * Math.PI * flashes * s);
  return depth * (1 - s) ** 1.2 * pulse;
}

/**
 * A lamp's resting brightness, 0…1 — what it shows with the wheel at a standstill.
 *
 * A marquee bulb is never dark: between spins the ring holds a warm, even glow,
 * and the chase is something it does on top of that. Real bulbs are also never
 * identical, so no two neighbours sit at quite the same brightness. The
 * variation runs on a fixed per-index pattern rather than a random one, because
 * the same ring has to come back to the same glow after every spin, and the
 * result is snapped to the same `litLevels` grid the chase uses — so a bulb does
 * not change step size when the wheel starts turning.
 *
 * @param {number} index — the lamp's place on the ring
 * @param {{ lit?: number, variation?: number }} [options]
 * @returns {number} a value on the `litLevels` grid
 */
export function restingLevel(
  index,
  { lit = WHEEL_FRAME.idleLit, variation = WHEEL_FRAME.idleVariation } = {},
) {
  const i = Math.max(0, Math.trunc(Number(index) || 0));
  const base = Number(lit) || 0;
  const spread = Math.max(0, Number(variation) || 0);
  // A three-step pattern — dim · nominal · bright — walked with a stride of two,
  // which visits all three in a cycle of three and so never lines two identical
  // steps up on neighbouring bulbs.
  const step = ((i * 2) % 3) - 1;
  return quantizeIntensity(base + step * spread);
}

/**
 * The band's angular rate `ms` into a spin, how brightly the head burns, and the
 * surge the ring gives the instant the pin stops the wheel.
 *
 * While the drum is being driven, both come straight off its own speed — the
 * chase is the rotation. From the instant the pin catches it, the ring is no
 * longer driven by anything: the last of the flywheel bleeds off over
 * `WHEEL_FRAME.settleMs`, and because the rate and the head's excess brightness
 * decay from the SAME instant, the ring has already sat down by the time the drum
 * has finished its rebound. That is what "the lights sit down with the wheel"
 * means, and it is deliberately measured from the catch rather than from the end
 * of the rotation, so the settle costs the spin no extra time at all.
 *
 * The brightness handed back is how far the head stands ABOVE the ring's resting
 * glow, never how bright the ring is — a bulb is a light source that is always
 * on, so the chase dissolves back into the resting ring instead of fading to
 * black. The view composes a lamp's actual level from this and `restingLevel`.
 *
 * @param {object} plan — from `planWheelSpin`
 * @param {number} ms
 * @returns {{ rate: number, amplitude: number, flick: number }}
 */
export function bandStateAt(plan, ms) {
  if (!plan) return { rate: 0, amplitude: 0, flick: 0 };

  const t = Math.max(0, Math.min(Number(ms) || 0, plan.durationMs));
  const { brakeMs } = plan.phases;

  if (t < brakeMs) {
    // The head builds in with the drum's own ramp rather than snapping on with
    // the first frame. The bulbs are already lit, so this is a chase starting
    // up, not a switch being thrown — and by the time the drum is at speed the
    // head is at full strength, where it then stays for the whole plateau.
    const accelMs = Math.max(1, plan.phases.accelMs);
    return {
      rate: bandRate(velocityAt(plan, t)),
      amplitude: Math.min(1, t / accelMs),
      flick: 0,
    };
  }

  // From the catch onwards the ring is no longer driven by anything: freeze the
  // rate the TRAVEL beat handed over (never the rebound's first frame, which is
  // back-to-front) and let the flywheel bleed it off.
  const caught = bandRate(plan.catchVelocity);
  const elapsed = t - brakeMs;
  return {
    rate: caught * settleFactor(elapsed, WHEEL_FRAME.settleMs, WHEEL_FRAME.settleRateDecay),
    amplitude: settleFactor(elapsed, WHEEL_FRAME.settleMs, WHEEL_FRAME.settleFadeDecay),
    flick: settleFlickAt(elapsed),
  };
}

/**
 * The angle the band sweeps between two instants of a spin, in degrees.
 *
 * The view integrates frame by frame — there is no closed form for a rate that
 * is part of a curve and part of a clamped decay — so this samples the same
 * rate on a fixed grid instead. That makes the ring's total travel a measurable
 * property of the plan rather than of the frame rate, which is what the tests
 * need to assert that the chase really does follow the wheel.
 *
 * @param {object} plan
 * @param {number} fromMs
 * @param {number} toMs
 * @param {number} [steps] — grid resolution; 240 is ~2 ms per step on a 3.6 s spin
 */
export function bandSpan(plan, fromMs = 0, toMs = plan?.durationMs ?? 0, steps = 240) {
  if (!plan) return 0;
  const from = Math.max(0, Number(fromMs) || 0);
  const to = Math.min(Math.max(0, Number(toMs) || 0), plan.durationMs);
  if (to <= from) return 0;

  const count = Math.max(1, Math.round(Number(steps) || 1));
  const dt = (to - from) / count;
  let total = 0;
  for (let i = 0; i < count; i += 1) total += bandStateAt(plan, from + (i + 0.5) * dt).rate * dt;
  return total;
}

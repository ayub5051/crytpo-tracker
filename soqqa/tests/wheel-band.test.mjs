/* ============================================================================
   SOQQA — Omad charxi rim band (exact)
   ----------------------------------------------------------------------------
   The marquee around the wheel is not a keyframe loop. It is a head of light
   whose angle is integrated from the drum's OWN angular velocity, frame by
   frame, so the chase follows the rotation: it travels the way the drum turns,
   it slows as the drum slows, and it sits down with it. Everything about that
   lives in the pure half of js/ui/wheelPhysics.js, so this suite can measure it
   without a DOM.

   What it holds:
     • the band is driven by the drum, in the drum's direction, at its speed —
       scaled by the configured gain and clamped so a fast drum cannot turn the
       ring into a blur;
     • the ring decelerates with the wheel and is still and dark by the instant
       the drum has finished, so the lights add no time to the spin;
     • each lamp turns on and off exactly ONCE per pass — a bulb that blinks
       twice, or one that skips a beat, is the failure mode this whole design
       exists to avoid;
     • a pass lights several lamps at different strengths, snapped to steps, so
       the ring reads as a comet and not as a row of dots switching on.
   ========================================================================= */

import { FULL_TURN } from '../js/games/wheel.js';
import { WHEEL_FRAME, WHEEL_SPIN } from '../js/config.js';
import {
  bandMaxRate,
  bandRate,
  bandSpan,
  bandStateAt,
  lampIntensity,
  planWheelSpin,
  quantizeIntensity,
  restingLevel,
  rotationAt,
  settleFactor,
  velocityAt,
} from '../js/ui/wheelPhysics.js';

/** The lamp angles the view actually builds, from the same ring geometry. */
const LAMP_ANGLES = Array.from(
  { length: WHEEL_FRAME.bulbCount },
  (_, index) => (360 / WHEEL_FRAME.bulbCount) * index + 360 / (WHEEL_FRAME.bulbCount * 2),
);

/** The brightest lamp's angle at a band angle — where the head is. */
function headAngle(bandAngle) {
  let best = { angle: LAMP_ANGLES[0], value: -1 };
  LAMP_ANGLES.forEach((angle) => {
    const value = lampIntensity(angle, bandAngle);
    if (value > best.value) best = { angle, value };
  });
  return best.angle;
}

/** How many lamps are lit at all, at a band angle and amplitude. */
function litCount(bandAngle, amplitude = 1) {
  return LAMP_ANGLES.filter(
    (angle) => quantizeIntensity(lampIntensity(angle, bandAngle) * amplitude) > 0,
  ).length;
}

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

export function runWheelBandTests(suite) {
  const plan = planWheelSpin({ fromRotation: 0, stopAngle: 0, turns: 5, jitter: 0 });
  const { brakeMs } = plan.phases;

  /* ----------------------------------------------------------------------
     Driven by the drum, not by a clock
     ---------------------------------------------------------------------- */

  // Both speeds are under the clamp, so this measures the gain and nothing else.
  suite.ok(
    'the band has no cadence of its own: twice the speed is twice the rate',
    near(bandRate(0.2) / bandRate(0.1), 2, 1e-9),
    `${bandRate(0.1)} → ${bandRate(0.2)}`,
  );
  suite.ok(
    'the drum is still crawling when the pin catches it, and that crawl is published',
    plan.catchVelocity > 0 && plan.catchVelocity < plan.peakVelocity,
    `${plan.catchVelocity.toFixed(4)} vs peak ${plan.peakVelocity.toFixed(4)} °/ms`,
  );
  suite.ok(
    'the band travels the way the drum turns, so the lights never run backwards',
    bandRate(0.4) > 0 && bandRate(-0.4) < 0 && near(Math.abs(bandRate(-0.4)), bandRate(0.4), 1e-9),
  );
  suite.ok('a drum at rest leaves the ring still', bandRate(0) === 0);
  suite.ok(
    'the band is scaled by the configured gain',
    near(bandRate(0.2), 0.2 * WHEEL_FRAME.chaseGain, 1e-9),
    `${bandRate(0.2)} vs ${0.2 * WHEEL_FRAME.chaseGain}`,
  );

  const max = bandMaxRate(WHEEL_FRAME.chaseMaxRevPerSec);
  suite.ok(
    'and clamped, so a fast drum cannot turn the ring into a blur',
    near(max, (WHEEL_FRAME.chaseMaxRevPerSec * FULL_TURN) / 1000, 1e-9) &&
      bandRate(50) === max &&
      bandRate(-50) === -max,
    `${max} °/ms`,
  );
  suite.ok(
    'the clamp actually bites at the speeds this wheel reaches',
    plan.peakVelocity * WHEEL_FRAME.chaseGain > max,
    `peak ${(plan.peakVelocity * WHEEL_FRAME.chaseGain).toFixed(3)} vs clamp ${max.toFixed(3)}`,
  );

  /* ----------------------------------------------------------------------
     It slows with the wheel, and stops with it
     ---------------------------------------------------------------------- */

  const firstHalf = Math.abs(bandSpan(plan, 0, brakeMs / 2));
  const secondHalf = Math.abs(bandSpan(plan, brakeMs / 2, brakeMs));
  suite.ok(
    'the band slows with the wheel',
    secondHalf < firstHalf,
    `${firstHalf.toFixed(0)}° then ${secondHalf.toFixed(0)}°`,
  );
  suite.ok(
    'clearly so, not marginally: the second half covers much less ground',
    secondHalf / (firstHalf + secondHalf) < 0.45,
    `${((secondHalf / (firstHalf + secondHalf)) * 100).toFixed(1)}% of the travel in the second half`,
  );
  suite.ok(
    'and never re-accelerates once the brake has begun',
    (() => {
      let previous = Infinity;
      // The ramp is over by the peak; from there the brake only ever slows.
      for (let u = plan.shape.peak; u <= 1.0001; u += 0.005) {
        const rate = Math.abs(bandRate(velocityAt(plan, u * brakeMs)));
        if (rate > previous + 1e-12) return false;
        previous = rate;
      }
      return true;
    })(),
  );
  suite.ok(
    'the chase is down to a crawl by the time the pin stops the wheel',
    Math.abs(bandRate(plan.catchVelocity)) < bandMaxRate() * 0.6,
    `${((Math.abs(bandRate(plan.catchVelocity)) / bandMaxRate()) * 100).toFixed(0)}% of the plateau`,
  );
  suite.ok(
    'and it never rewinds — not even on the frame the pin catches the wheel',
    (() => {
      // The tick past the pin is a genuine reversal of the DRUM, so the seam is
      // exactly where a rate read off the wrong beat would come back negative
      // and the ring would visibly run backwards for a moment. Nothing on a
      // marquee may ever do that.
      for (let i = 0; i <= 720; i += 1) {
        const { rate } = bandStateAt(plan, (i / 720) * plan.durationMs);
        if (rate < 0) return false;
      }
      return true;
    })(),
  );
  suite.ok(
    'so the band is one monotonically advancing sweep, never a step back',
    (() => {
      const grid = 720;
      const dt = plan.durationMs / grid;
      let total = 0;
      for (let i = 0; i < grid; i += 1) {
        const next = total + bandStateAt(plan, (i + 0.5) * dt).rate * dt;
        if (next < total - 1e-9) return false;
        total = next;
      }
      return total > 0;
    })(),
  );
  suite.ok(
    'and it never beats the clamp, over the spin as a whole',
    bandSpan(plan) <= bandMaxRate() * plan.durationMs + 1e-9,
    `${bandSpan(plan).toFixed(0)}° vs a ceiling of ${(bandMaxRate() * plan.durationMs).toFixed(0)}°`,
  );
  suite.ok(
    'once off the clamp the lights are geared up on the drum, as configured',
    (() => {
      // The clamp bites for most of the travel on this wheel — that is the whole
      // point of it — so the gain is only directly observable in the tail, where
      // the drum has slowed enough for the band to come off the ceiling.
      const from = 0.72 * brakeMs;
      const band = bandSpan(plan, from, brakeMs);
      const drum = rotationAt(plan, brakeMs) - rotationAt(plan, from);
      return band > drum * 1.5 && band < drum * WHEEL_FRAME.chaseGain + 1e-9;
    })(),
    (() => {
      const from = 0.72 * brakeMs;
      return `${bandSpan(plan, from, brakeMs).toFixed(1)}° of band vs ${(
        rotationAt(plan, brakeMs) - rotationAt(plan, from)
      ).toFixed(1)}° of drum`;
    })(),
  );

  suite.ok(
    'the head builds in with the drum\u2019s own ramp, not on the first frame',
    // The bulbs are already lit, so the chase starting up is a fade-in rather
    // than a switch being thrown — and by the end of the ramp it is at full
    // strength, where it stays for the whole plateau.
    bandStateAt(plan, 0).amplitude === 0 &&
      plan.phases.accelMs > 0 &&
      bandStateAt(plan, plan.phases.accelMs).amplitude === 1 &&
      bandStateAt(plan, brakeMs - 1).amplitude === 1,
    `${plan.phases.accelMs} ms ramp`,
  );

  const atCatch = bandStateAt(plan, brakeMs);
  const atEnd = bandStateAt(plan, plan.durationMs);
  suite.ok(
    'the band is still moving fast when the pin catches the wheel',
    Math.abs(atCatch.rate) > 0 && near(atCatch.amplitude, 1, 1e-9),
    `${atCatch.rate.toFixed(3)} °/ms`,
  );
  suite.ok(
    'the head has dissolved by the instant the drum finishes — the lights cost the spin no extra time',
    atEnd.rate === 0 && atEnd.amplitude === 0,
    `rate ${atEnd.rate}, amplitude ${atEnd.amplitude}`,
  );
  suite.ok(
    'but it is still winding down at the halfway point of the settle',
    (() => {
      const mid = bandStateAt(plan, brakeMs + WHEEL_FRAME.settleMs / 2);
      return (
        mid.rate > 0 && mid.rate < atCatch.rate && mid.amplitude < 1 && mid.amplitude > 0
      );
    })(),
  );
  suite.ok(
    'the settle factor only ever falls, and lands on zero',
    (() => {
      let previous = Infinity;
      for (let ms = 0; ms <= WHEEL_FRAME.settleMs; ms += WHEEL_FRAME.settleMs / 40) {
        const value = settleFactor(ms);
        if (value > previous + 1e-12) return false;
        previous = value;
      }
      return (
        settleFactor(0) === 1 &&
        settleFactor(WHEEL_FRAME.settleMs) === 0 &&
        settleFactor(WHEEL_FRAME.settleMs * 4) === 0
      );
    })(),
  );

  /* ----------------------------------------------------------------------
     One on, one off, per pass
     ---------------------------------------------------------------------- */

  const arc = WHEEL_FRAME.sweepArcDeg;
  suite.ok(
    'a lamp burns brightest under the head and is dark behind the tail',
    lampIntensity(0, 0) === 1 && lampIntensity(0, arc) === 0 && lampIntensity(0, arc + 1) === 0,
  );
  suite.ok(
    'down the tail it is dimmer than the head, but still lit',
    (() => {
      const halfway = lampIntensity(0, arc / 2);
      return halfway > 0 && halfway < 1;
    })(),
  );
  suite.ok(
    'the band wraps cleanly, with no dead spot at 12 o’clock',
    // A lamp the head has already passed is lit even across the seam…
    lampIntensity(FULL_TURN - 1, 0) > 0 &&
    // …one it has not reached yet is dark…
    lampIntensity(1, 0) === 0 &&
    // …and a full turn of the head is exactly where it started.
    near(lampIntensity(arc / 2, 0), lampIntensity(arc / 2, FULL_TURN), 1e-12),
    `${lampIntensity(FULL_TURN - 1, 0).toFixed(3)} vs ${lampIntensity(1, 0)}`,
  );

  {
    // A bulb that blinks twice, or misses a beat, is exactly what this design
    // exists to prevent. Sweeping the band a full revolution and counting how
    // many times each lamp goes dark has to find exactly one — counted as
    // lit→dark on a CIRCULAR sweep, so a lamp whose lit window straddles 12
    // o’clock is not mistaken for two blinks.
    const steps = 3600;
    const bad = [];
    LAMP_ANGLES.forEach((lampAngle) => {
      const lit = Array.from(
        { length: steps },
        (_, i) => lampIntensity(lampAngle, (i / steps) * FULL_TURN) > 0,
      );
      let runs = 0;
      for (let i = 0; i < steps; i += 1) {
        if (lit[i] && !lit[(i + 1) % steps]) runs += 1;
      }
      if (runs !== 1) bad.push(`${lampAngle.toFixed(1)}°: ${runs} blinks`);
    });
    suite.ok(
      'every lamp turns on and off exactly once per pass',
      bad.length === 0,
      bad.slice(0, 4).join('; '),
    );
  }

  suite.ok(
    'the lit window is a fraction of the ring, not the whole of it',
    arc > 0 && arc < FULL_TURN,
    `${arc}° of 360°`,
  );

  /* ----------------------------------------------------------------------
     A comet, not a row of dots
     ---------------------------------------------------------------------- */

  const lit = litCount(0);
  suite.ok(
    'a pass lights several lamps at once',
    lit >= 4,
    `${lit} of ${WHEEL_FRAME.bulbCount} lit`,
  );
  suite.ok(
    'but leaves most of the ring dark',
    lit / WHEEL_FRAME.bulbCount < 0.6,
    `${((lit / WHEEL_FRAME.bulbCount) * 100).toFixed(0)}%`,
  );
  suite.ok(
    'and the lit run varies in brightness, so it reads as a head and a tail',
    (() => {
      const band = LAMP_ANGLES[3];
      const values = LAMP_ANGLES.map((angle) => quantizeIntensity(lampIntensity(angle, band), 12)).filter(
        (value) => value > 0,
      );
      return new Set(values).size >= 3;
    })(),
  );
  suite.ok(
    'the head really does travel round the ring, bulb by bulb',
    (() => {
      const step = 360 / WHEEL_FRAME.bulbCount;
      const from = headAngle(10);
      const to = headAngle(10 + step);
      const moved = ((to - from) % 360 + 360) % 360;
      return near(moved, step, 1e-6);
    })(),
    `${headAngle(10)}° → ${headAngle(10 + 360 / WHEEL_FRAME.bulbCount)}°`,
  );

  /* ----------------------------------------------------------------------
     Stepped, like a row of real bulbs
     ---------------------------------------------------------------------- */

  const levels = WHEEL_FRAME.litLevels;
  suite.ok('a lit lamp is snapped to a fixed number of steps', levels > 1, `${levels} levels`);
  suite.ok(
    'every snapped value is exactly on a step, and inside 0…1',
    (() => {
      for (let i = 0; i <= 40; i += 1) {
        const value = quantizeIntensity(i / 40);
        if (Math.abs(value * levels - Math.round(value * levels)) > 1e-9) return false;
        if (value < 0 || value > 1) return false;
      }
      return true;
    })(),
  );
  suite.ok(
    'the ends are exact: fully off is 0 and fully lit is 1',
    quantizeIntensity(0) === 0 && quantizeIntensity(1) === 1,
  );
  suite.ok(
    'a barely-touched lamp is off rather than dimly on',
    quantizeIntensity(1 / (levels * 4)) === 0,
  );

  /* ----------------------------------------------------------------------
     The ring sits down with the wheel
     ---------------------------------------------------------------------- */

  suite.ok(
    'no lamp is left carrying any of the chase once the drum has settled',
    litCount(0, atEnd.amplitude) === 0 &&
      quantizeIntensity(lampIntensity(0, 0) * atEnd.amplitude) === 0,
  );
  suite.ok(
    'no frame moves the head further than one bulb step, so the chase stays readable',
    (() => {
      const step = 360 / WHEEL_FRAME.bulbCount;
      const frames = Math.ceil(plan.durationMs / (1000 / 60));
      const dt = plan.durationMs / frames;
      let worst = 0;
      for (let i = 0; i <= frames; i += 1) worst = Math.max(worst, Math.abs(bandStateAt(plan, i * dt).rate) * dt);
      return worst <= step + 1e-9 && worst > step * 0.2;
    })(),
  );

  suite.ok(
    'the band is being driven off a 3–4 s spin, the one the config declares',
    plan.durationMs === WHEEL_SPIN.durationMs &&
      plan.durationMs >= 3000 &&
      plan.durationMs <= 4000,
    `${plan.durationMs} ms`,
  );
  suite.ok(
    'and it really does lap the ring before the pin catches it',
    Math.abs(bandSpan(plan, 0, brakeMs)) > FULL_TURN,
    `${Math.abs(bandSpan(plan, 0, brakeMs)).toFixed(0)}°`,
  );
  suite.ok(
    'the drum is genuinely still moving at the catch, so the ring is too',
    Math.abs(bandRate(velocityAt(plan, brakeMs))) > 0,
  );

  /* ----------------------------------------------------------------------
     The ring is never dark, and it surges when the machine catches
     ---------------------------------------------------------------------- */

  const rest = Array.from({ length: WHEEL_FRAME.bulbCount }, (_, i) => restingLevel(i));

  suite.ok(
    'a bulb is never dark: the powered ring holds a resting glow well above zero',
    rest.every((level) => level > 0),
    `${Math.min(...rest)}…${Math.max(...rest)}`,
  );
  suite.ok(
    'and it is not a perfect circle of identical dots',
    Math.max(...rest) > Math.min(...rest),
    `${new Set(rest).size} distinct levels across ${rest.length} lamps`,
  );
  suite.ok(
    'every resting level lands exactly on the step grid the chase uses',
    rest.every(
      (level) => Math.abs(level * levels - Math.round(level * levels)) < 1e-9,
    ),
    `${levels} steps`,
  );
  suite.ok(
    'the ring comes back to the SAME glow after every spin',
    rest.slice(0, 6).join() ===
      Array.from({ length: 6 }, (_, i) => restingLevel(i + WHEEL_FRAME.bulbCount)).join(),
  );
  suite.ok(
    'there is room above the rest for a chase to read',
    WHEEL_FRAME.idleLit > 0 && 1 - WHEEL_FRAME.idleLit > 0.5,
    `rest ${WHEEL_FRAME.idleLit}, headroom ${(1 - WHEEL_FRAME.idleLit).toFixed(2)}`,
  );

  {
    const surgeAt = (ms) => bandStateAt(plan, ms).flick;
    let peak = 0;
    for (let ms = 0; ms <= plan.durationMs; ms += 1) peak = Math.max(peak, surgeAt(ms));

    suite.ok(
      'the whole ring surges the instant the pin catches the wheel, which is where the spin begins to feel stopped',
      surgeAt(brakeMs) === peak && peak > 0.2,
      `${peak.toFixed(3)} at the catch`,
    );
    suite.eq(
      'the surge is over before the spin is, so nothing is left burning',
      surgeAt(plan.durationMs),
      0,
    );
    suite.ok(
      'it lifts EVERY lamp at once — which is exactly what a chase cannot do',
      // A chase lights a run of bulbs. The surge lifts the whole ring, and that
      // difference is the whole reason a player can tell the wheel has CAUGHT
      // rather than merely stopped moving.
      rest.every((level) => quantizeIntensity(level + peak) > quantizeIntensity(level)),
      `${peak.toFixed(3)} over a rest of ${WHEEL_FRAME.idleLit}`,
    );
    suite.ok(
      'and it chatters on the way down, the way a contactor does',
      (() => {
        // Two humps: the ring is at its brightest on the catch, dims, surges
        // smaller, dims again. A single fade would be one hump.
        let dips = 0;
        for (let ms = 1; ms < WHEEL_FRAME.settleFlickMs; ms += 1) {
          const a = surgeAt(brakeMs + ms - 1);
          const b = surgeAt(brakeMs + ms);
          const c = surgeAt(brakeMs + ms + 1);
          if (b < a && b < c) dips += 1;
        }
        return dips >= 2;
      })(),
      String(WHEEL_FRAME.settleFlickCount),
    );
  }

  suite.note(
    `${WHEEL_FRAME.bulbCount} lamps · sweep ${arc}° · gain ×${WHEEL_FRAME.chaseGain} · clamp ${WHEEL_FRAME.chaseMaxRevPerSec} rev/s · ${levels} steps · ${lit} lit at once · rest ${WHEEL_FRAME.idleLit}±${WHEEL_FRAME.idleVariation} · surge ${WHEEL_FRAME.settleFlickDepth}×${WHEEL_FRAME.settleFlickCount}`,
  );
}

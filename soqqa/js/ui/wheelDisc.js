/* ============================================================================
   SOQQA — Omad charxi disc view
   ----------------------------------------------------------------------------
   Owns the spinning disc. It paints the face from config.js (colours AND
   labels), turns it to a landing angle the engine has already decided, and
   lights the wedge the pointer stopped on. It performs no maths about winning —
   games/wheel.js decides the result, this module only makes the disc land
   exactly on it.

   Two things are deliberately different from the first version:

     • The face is vector art, built once as an SVG string from the segment
       table. 12 wedges in alternating deep ruby and gold-black, each with its
       own rim-lighting ramp, cut behind a recessed depth gradient, with a
       polished peg on every seam. The pegs are what the pointer flicks against.

     • The rotation is driven by requestAnimationFrame from the closed-form
       curve in js/ui/wheelPhysics.js — not by a CSS transition. That is what
       makes the tick past the pin, the damped rebound and the exact landing
       possible at all, and it lets the pin's deflection be derived from the
       measured speed at every single frame.

   Smoothness is not an accident of the curve, it is three deliberate choices:

     • ONE MONOTONIC CLOCK. The frame's position is read off `monotonicNow()`,
       never the wall clock. `Date.now()` is quantised to a millisecond and can
       be stepped backwards by an NTP correction mid-spin — either one puts a
       visible kink in a 3.8 s rotation that is otherwise perfectly smooth.
     • ONE COMPOSITOR LAYER. The drum's transform carries `translateZ(0)` beside
       the rotation, so the browser keeps the turned face as its own layer and
       transforms a texture instead of re-rasterising a 12-path SVG sixty times a
       second. That re-rasterisation is what reads as shimmer or stepping at
       speed, and it is the one thing the curve cannot fix.
     • NO LAYOUT, EVER. A frame writes the drum's transform, at most one custom
       property on the pin, and `--lamp-lit` on the bulbs that actually crossed a
       brightness step. Nothing in the loop reads layout, and nothing animates a
       filter.

   The hub and the rim are static chrome (index.html + style.css) painted over
   the disc: a real machine's lights and knob do not spin with the drum.
   ========================================================================= */

import {
  WHEEL_BIG_WIN_MULTIPLIER,
  WHEEL_FRAME,
  WHEEL_JACKPOT_MULTIPLIER,
  WHEEL_SEGMENTS,
  WHEEL_SPIN,
} from '../config.js';
import { SEGMENT_ANGLE, normalizeAngle } from '../games/wheel.js';
import { formatMultiplier } from './format.js';
import {
  alternationAt,
  bandStateAt,
  lampIntensity,
  pinFlickAt,
  pinSeatClickAt,
  planWheelSpin,
  quantizeIntensity,
  restingLevel,
  rotationAt,
  velocityAt,
} from './wheelPhysics.js';

/** The face is drawn on a square artboard whose width IS the disc diameter. */
export const FACE_VIEWBOX = 100;
const CENTRE = FACE_VIEWBOX / 2;

/**
 * The spin's clock: monotonic, sub-millisecond, and immune to the system clock
 * being corrected underneath a running animation. `performance.now()` is the
 * only timer with all three properties; `Date.now()` has none of them, and a
 * backwards step mid-spin would put a kink in a rotation that is otherwise a
 * closed-form curve. Exported so the choice can be asserted rather than
 * assumed — see tests/wheel-ui.test.mjs.
 */
export const monotonicNow = () =>
  typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
const DISC_RADIUS = FACE_VIEWBOX / 2;
/** Where the metal separators start, the pegs sit, and the hub collar ends. */
const SEAM_INNER = 15.5;
const PEG_RADIUS = 44;
const PEG_SIZE = 1.6;
/** Where the labels sit, as a fraction of the disc diameter (see style.css). */
const LABEL_RADIUS = '0.32';

/**
 * The two wedge ramps, running hub → rim, so the light always falls outward.
 *
 * Both are METAL rather than paint: a dark base, a rising body, a HARD break
 * back down to shadow — the reflection the polished surface catches — then the
 * lit band and a hot rim. Six stops is what makes a slice read as a polished
 * 3D surface instead of a flat fill, and the break is what stops the gold from
 * looking like yellow paper. The two ramps are deliberately far apart in hue at
 * EVERY radius, which is what keeps neighbouring wedges legible: the ruby is
 * red-hued all the way out while the gold is warm, and neither end is a near-
 * black neighbour of the other.
 *
 * Both palettes are DIFFERENTIATED BY DEPTH rather than by brightness alone.
 * An earlier recipe lit the mid bands hard, which washed the middle of the drum
 * out and made the two metals read as one glossy surface with a hue shift. The
 * body and reflection bands are therefore pushed down into real shadow (the
 * ruby's body band sits at ~44 weighted luminance against the gold's ~89) and
 * the hot rim is kept as the one bright note, so the eye reads a deep lacquer
 * and a bronze with a machined edge — the hierarchy a physical drum has, and
 * the reason it stops looking like a flat pie chart. The palette contract in
 * tests/wheel-cabin.test.mjs holds either way: the ramps still alternate, still
 * break back into shadow at band 3, still climb to the rim, and still stay
 * clearly apart at every band the player can see.
 */
/*
   The metals, re-cut for RICHNESS rather than for restraint.

   The previous recipe kept the bases genuinely dark (that part was right, and
   it is kept) but paid for it by muting the LIT bands as well — a bronze body
   stop at #bd8c2b and a ruby at #a5142d are low-chroma browns and dull reds,
   so the drum's average pixel was dark mud and the whole machine read flat no
   matter how good the geometry underneath it was. `saturation`, not luminance,
   is what separates a metal from a painted surface.

   So the bases stay sunk and the lit bands get their CHROMA back: the gold's
   body band is a saturated #e8a91a (channel spread 206, against 146 before)
   and the ruby's is a vigorous #c81232 (spread 182, against 155), with the hot
   rim climbing to near-specular. The mid-ramp break still dips back into
   shadow, and the hub -> rim climb is steep, which is what keeps the bevel
   reading as a turned surface instead of a gradient fill.
 */
const RUBY_RAMP = Object.freeze(['#2a030c', '#7e0a1f', '#c81232', '#5e0515', '#f02448', '#ff9fb2']);
const GOLD_RAMP = Object.freeze(['#1e1203', '#9c6608', '#e8a91a', '#7d4d06', '#ffc93c', '#fff7dd']);
/**
 * Stop offsets shared by both ramps.
 *
 * The first stop sits INSIDE the hub — the knob covers the inner third of the
 * radius, so it is never seen — which is why the recipe only has to hold up
 * from the second stop outwards. From there the bands are: body, reflection
 * break, lit band, hot rim. Exported because the contract is worth asserting:
 * the first VISIBLE band has to start outside the knob, and the two palettes
 * have to stay clearly apart at every band after it.
 */
export const WEDGE_RAMP_OFFSETS = Object.freeze([0, 0.36, 0.56, 0.66, 0.84, 1]);
const RAMP_OFFSETS = WEDGE_RAMP_OFFSETS;

/**
 * The two arcs cut into every slice, in artboard units.
 *
 * A single flat wedge photographed under a light has no edge, which is why the
 * first drum read as printed colour. These are what give each slice a surface:
 * a polished LIP just inside the rim (the edge the frame's light catches) and a
 * dark THROAT where the wedges meet the collar of the knob, so the slices look
 * inlaid into a recessed well rather than painted onto a flat disc.
 */
export const WHEEL_FACE_RINGS = Object.freeze({
  /** The polished lip's radius, in artboard units — inside the rim, outside the pegs. */
  lipRadius: 47.6,
  /** How far each lip stops short of its wedge's seam, in degrees. */
  lipInsetDeg: 2.6,
  /** The throat ring where the slices run under the knob's collar. */
  throatRadius: 17.4,
});
const { lipRadius: LIP_RADIUS, lipInsetDeg: LIP_INSET_DEG, throatRadius: THROAT_RADIUS } = WHEEL_FACE_RINGS;

/** Even segments are cut from ruby, odd ones from black gold. */
export const wedgeRamp = (index) => (Math.abs(Math.trunc(Number(index) || 0)) % 2 === 0 ? RUBY_RAMP : GOLD_RAMP);

const round = (value) => Number(Number(value).toFixed(3));

/** A point on the disc: 0° is 12 o'clock, growing clockwise. */
export function polarPoint(angleDeg, radius) {
  const rad = (Number(angleDeg) * Math.PI) / 180;
  return [round(CENTRE + radius * Math.sin(rad)), round(CENTRE - radius * Math.cos(rad))];
}

/** One wedge: apex at the hub, an arc along the rim. */
export function wedgePath(index, radius = DISC_RADIUS) {
  const from = SEGMENT_ANGLE * index - SEGMENT_ANGLE / 2;
  const to = from + SEGMENT_ANGLE;
  const [x1, y1] = polarPoint(from, radius);
  const [x2, y2] = polarPoint(to, radius);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${CENTRE} ${CENTRE} L ${x1} ${y1} A ${round(radius)} ${round(radius)} 0 ${large} 1 ${x2} ${y2} Z`;
}

/** The rim-lighting ramp of one wedge, as a linear gradient along its midline. */
function wedgeGradient(index) {
  const ramp = wedgeRamp(index);
  const [x1, y1] = polarPoint(index * SEGMENT_ANGLE, 0);
  const [x2, y2] = polarPoint(index * SEGMENT_ANGLE, DISC_RADIUS);
  const stops = ramp
    .map(
      (colour, stop) =>
        `<stop offset="${WEDGE_RAMP_OFFSETS[stop] ?? stop}" stop-color="${colour}"/>`,
    )
    .join('');
  return (
    `<linearGradient id="sqWheelRamp${index}" gradientUnits="userSpaceOnUse" ` +
    `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`
  );
}

/**
 * Where the rim lamps sit, on one ring, in artboard units.
 *
 * Offsets by half a step so no lamp ever lands on the pointer's seam, and
 * exported so the ring can be asserted geometrically rather than counted.
 *
 * @param {number} [count]
 * @param {number} [radius]
 * @returns {{ index: number, angle: number, x: number, y: number, left: string, top: string }[]}
 */
export function lampPositions(count = WHEEL_FRAME.bulbCount, radius = WHEEL_FRAME.bulbRadius) {
  const total = Math.max(1, Math.round(Number(count) || 1));
  const out = Math.max(0, Number(radius) || 0);

  return Array.from({ length: total }, (_, index) => {
    const angle = round((360 / total) * index + 360 / (total * 2));
    const [x, y] = polarPoint(angle, out);
    return { index, angle, x, y, left: `${x}%`, top: `${y}%` };
  });
}

/**
 * The whole disc face as SVG markup.
 *
 * Pure and exported, so the artwork can be asserted (wedge count, palette,
 * geometry inside the artboard, every fill resolving) without a browser.
 *
 * @param {object[]} [segments]
 * @returns {string}
 */
export function buildWheelFace(segments = WHEEL_SEGMENTS) {
  const wedges = segments
    .map(
      (segment, index) =>
        `<path class="wheel-wedge" data-wedge="${index}" ` +
        `d="${wedgePath(index)}" fill="url(#sqWheelRamp${index})" ` +
        `stroke="#f2d489" stroke-opacity="${index % 2 === 0 ? 0.34 : 0.42}" stroke-width="0.45"/>`,
    )
    .join('');

  // One metal separator per seam, half a segment off each segment centre — the
  // same offset the pin flick is phased against in js/ui/wheelPhysics.js. A
  // radial gradient paints them, so every strip is dark where it leaves the hub
  // and catches the light where it meets the rim, like a real raised divider.
  const seams = segments
    .map((_, index) => {
      const angle = index * SEGMENT_ANGLE + SEGMENT_ANGLE / 2;
      const [x1, y1] = polarPoint(angle, SEAM_INNER);
      const [x2, y2] = polarPoint(angle, DISC_RADIUS);
      return (
        `<path class="wheel-seam" d="M ${x1} ${y1} L ${x2} ${y2}" ` +
        `stroke="url(#sqWheelSeam)" stroke-width="0.8" fill="none"/>`
      );
    })
    .join('');

  // The polished lip: one arc cut into each slice just inside the rim, inset a
  // couple of degrees at both ends so neighbouring lips never merge across a
  // seam. This is the edge the frame's light lands on, and it is what makes a
  // slice read as a machined inlay instead of a printed sector.
  const lips = segments
    .map((_, index) => {
      const from = index * SEGMENT_ANGLE - SEGMENT_ANGLE / 2 + LIP_INSET_DEG;
      const to = index * SEGMENT_ANGLE + SEGMENT_ANGLE / 2 - LIP_INSET_DEG;
      const [x1, y1] = polarPoint(from, LIP_RADIUS);
      const [x2, y2] = polarPoint(to, LIP_RADIUS);
      return (
        `<path class="wheel-face__lip" d="M ${x1} ${y1} A ${LIP_RADIUS} ${LIP_RADIUS} 0 0 1 ${x2} ${y2}" ` +
        `fill="none" stroke="url(#sqWheelLip)" stroke-width="1.15" stroke-linecap="round"/>`
      );
    })
    .join('');

  // One stud per seam, each with the contact shadow that gives it height.
  const pegs = segments
    .map((_, index) => {
      const [cx, cy] = polarPoint(index * SEGMENT_ANGLE + SEGMENT_ANGLE / 2, PEG_RADIUS);
      return (
        `<ellipse class="wheel-peg__shadow" cx="${cx}" cy="${round(cy + 0.75)}" ` +
        `rx="${PEG_SIZE}" ry="${round(PEG_SIZE * 0.72)}" fill="#000" opacity="0.45"/>` +
        `<circle class="wheel-peg" cx="${cx}" cy="${cy}" r="${PEG_SIZE}" fill="url(#sqWheelPeg)"/>`
      );
    })
    .join('');

  return (
    `<svg class="wheel-face" viewBox="0 0 ${FACE_VIEWBOX} ${FACE_VIEWBOX}" ` +
    `aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">` +
    `<defs>${segments.map((_, index) => wedgeGradient(index)).join('')}` +
    // The recess: the drum sits down inside the frame, so it is darker toward
    // the hub and darkest right under the rim. Deliberately gentler in the
    // middle than the first version, which crushed both palettes into the same
    // near-black and cost the wheel its segment contrast.
    `<radialGradient id="sqWheelDepth" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="#000" stop-opacity="0.68"/>` +
    `<stop offset="30%" stop-color="#000" stop-opacity="0.36"/>` +
    `<stop offset="52%" stop-color="#000" stop-opacity="0.05"/>` +
    `<stop offset="78%" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset="90%" stop-color="#000" stop-opacity="0.22"/>` +
    `<stop offset="100%" stop-color="#000" stop-opacity="0.56"/>` +
    `</radialGradient>` +
    // The polished lip's own light: bright where the frame's key light falls,
    // falling into shadow by the lower right, so the ring of lips is lit like a
    // ring of metal and not like a uniform outline.
    `<linearGradient id="sqWheelLip" gradientUnits="userSpaceOnUse" x1="24" y1="10" x2="78" y2="90">` +
    `<stop offset="0" stop-color="#fff6dc" stop-opacity="0.72"/>` +
    `<stop offset="0.34" stop-color="#e8c46a" stop-opacity="0.42"/>` +
    `<stop offset="0.62" stop-color="#5c4410" stop-opacity="0.34"/>` +
    `<stop offset="1" stop-color="#2a1d05" stop-opacity="0.42"/>` +
    `</linearGradient>` +
    // The throat: the shadowed ring where the inlaid slices run under the
    // knob's collar. Anchored in user space so it darkens the hub end of every
    // wedge and nothing else.
    `<radialGradient id="sqWheelThroat" gradientUnits="userSpaceOnUse" cx="${CENTRE}" cy="${CENTRE}" r="${THROAT_RADIUS + 3}">` +
    `<stop offset="0" stop-color="#000" stop-opacity="0.62"/>` +
    `<stop offset="0.62" stop-color="#000" stop-opacity="0.5"/>` +
    `<stop offset="0.86" stop-color="#000" stop-opacity="0.22"/>` +
    `<stop offset="1" stop-color="#000" stop-opacity="0"/>` +
    `</radialGradient>` +
    // The room's reflection lying diagonally across the drum — the long soft
    // sheen a polished surface carries under a single overhead light. Rotated in
    // user space rather than drawn as a shape, so it stays a light and not a
    // second piece of artwork.
    `<linearGradient id="sqWheelSheen" gradientUnits="userSpaceOnUse" x1="50" y1="-14" x2="50" y2="60" gradientTransform="rotate(-26 ${CENTRE} ${CENTRE})">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="0"/>` +
    `<stop offset="0.42" stop-color="#fff8e6" stop-opacity="0.05"/>` +
    `<stop offset="0.56" stop-color="#fffdf6" stop-opacity="0.1"/>` +
    `<stop offset="0.7" stop-color="#fff8e6" stop-opacity="0.04"/>` +
    `<stop offset="1" stop-color="#fff" stop-opacity="0"/>` +
    `</linearGradient>` +
    // The rim light: a warm sheen that only exists near the frame, which is
    // what makes polished metal read as polished metal.
    `<radialGradient id="sqWheelRimLight" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="#ffe7b0" stop-opacity="0"/>` +
    `<stop offset="58%" stop-color="#ffe7b0" stop-opacity="0"/>` +
    `<stop offset="76%" stop-color="#ffdf9a" stop-opacity="0.1"/>` +
    `<stop offset="87%" stop-color="#ffe9ae" stop-opacity="0.26"/>` +
    `<stop offset="91%" stop-color="#fff4d2" stop-opacity="0.34"/>` +
    `<stop offset="100%" stop-color="#fff4d2" stop-opacity="0.3"/>` +
    `</radialGradient>` +
    `<radialGradient id="sqWheelSeam" gradientUnits="userSpaceOnUse" cx="${CENTRE}" cy="${CENTRE}" r="${DISC_RADIUS}">` +
    `<stop offset="0.18" stop-color="#3a2c0c" stop-opacity="0.3"/>` +
    `<stop offset="0.72" stop-color="#8a6a24" stop-opacity="0.6"/>` +
    `<stop offset="0.9" stop-color="#ffeec2" stop-opacity="0.88"/>` +
    `<stop offset="1" stop-color="#fff8e2" stop-opacity="0.95"/>` +
    `</radialGradient>` +
    `<radialGradient id="sqWheelPeg" cx="36%" cy="28%" r="76%">` +
    `<stop offset="0%" stop-color="#fffdf2"/>` +
    `<stop offset="40%" stop-color="#f0d383"/>` +
    `<stop offset="78%" stop-color="#a8802a"/>` +
    `<stop offset="100%" stop-color="#4a3708"/>` +
    `</radialGradient>` +
    `<radialGradient id="sqWheelGloss" cx="50%" cy="14%" r="66%">` +
    `<stop offset="0%" stop-color="#fff" stop-opacity="0.2"/>` +
    `<stop offset="48%" stop-color="#fff" stop-opacity="0.05"/>` +
    `<stop offset="100%" stop-color="#fff" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<g class="wheel-face__wedges">${wedges}</g>` +
    `<circle class="wheel-face__depth" cx="${CENTRE}" cy="${CENTRE}" r="${DISC_RADIUS}" ` +
    `fill="url(#sqWheelDepth)"/>` +
    `<g class="wheel-face__lips">${lips}</g>` +
    `<circle class="wheel-face__throat" cx="${CENTRE}" cy="${CENTRE}" r="${THROAT_RADIUS}" ` +
    `fill="url(#sqWheelThroat)"/>` +
    `<g class="wheel-face__seams">${seams}</g>` +
    `<circle class="wheel-face__rim-light" cx="${CENTRE}" cy="${CENTRE}" r="${DISC_RADIUS}" ` +
    `fill="url(#sqWheelRimLight)"/>` +
    `<g class="wheel-face__pegs">${pegs}</g>` +
    `<circle class="wheel-face__sheen" cx="${CENTRE}" cy="${CENTRE}" r="${DISC_RADIUS}" ` +
    `fill="url(#sqWheelSheen)"/>` +
    `<circle class="wheel-face__gloss" cx="${CENTRE}" cy="${CENTRE}" r="${DISC_RADIUS}" ` +
    `fill="url(#sqWheelGloss)"/>` +
    `</svg>`
  );
}

/**
 * @param {HTMLElement|null} root — the wheel view section
 * @param {{ segments?: object[], durationMs?: number }} [options]
 */
export function createWheelDisc(root, { segments = WHEEL_SEGMENTS, durationMs = WHEEL_SPIN.durationMs } = {}) {
  const disc = root ? root.querySelector('[data-wheel-disc]') : null;
  const face = root ? root.querySelector('[data-wheel-face]') : null;
  const glow = root ? root.querySelector('[data-wheel-glow]') : null;
  const stage = root ? root.querySelector('[data-wheel-stage]') : null;
  const pointer = root ? root.querySelector('[data-wheel-pointer]') : null;
  const lampLayer = root ? root.querySelector('[data-wheel-lamps]') : null;

  const reducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const raf =
    typeof globalThis.requestAnimationFrame === 'function'
      ? (callback) => globalThis.requestAnimationFrame(callback)
      : (callback) => setTimeout(() => callback(monotonicNow()), 16);
  const caf =
    typeof globalThis.cancelAnimationFrame === 'function'
      ? (handle) => globalThis.cancelAnimationFrame(handle)
      : (handle) => clearTimeout(handle);

  let labels = [];
  let lamps = [];
  /** Each lamp's angle on the ring, in the same 0…360 convention as the disc. */
  let lampAngles = [];
  /** The brightness step each lamp is currently showing, so only changes are written. */
  let lampLevels = [];
  /**
   * Each lamp's OWN resting brightness — a bulb is a light source that is always
   * on, so this is the level a lamp relaxes back to when the chase has gone, not
   * zero. Composed from `restingLevel()`, so the ring comes back to exactly the
   * same glow after every spin.
   */
  let lampRest = [];
  let rotation = 0;
  /** The angle the travelling light band's head currently sits at, in degrees. */
  let bandAngle = 0;
  let spinning = false;
  let frame = 0;
  let lastFlick = null;

  const segmentAngleOf = (index) => normalizeAngle(SEGMENT_ANGLE * index);

  /**
   * Write the disc's angle and the pin's deflection for one frame.
   *
   * @param {number} angle — absolute disc rotation, degrees
   * @param {number} speed — angular velocity, degrees per ms
   * @param {number} [seatClick] — the final click, in the same 0…1 units as the
   *   flick. Added to the peg deflection rather than replacing it, so the arm
   *   keeps riding the pegs while it comes to rest.
   */
  function paint(angle, speed, seatClick = 0) {
    // `translateZ(0)` beside the rotation is not decoration: it is what keeps
    // the turned face on its own compositor layer for the whole spin, so the
    // browser transforms a texture instead of re-rasterising twelve wedge paths
    // and their gradients on every frame. At 1.5°/frame that difference is the
    // one a player sees as the drum "vibrating" rather than turning.
    if (disc) disc.style.transform = `rotate(${round(angle)}deg) translateZ(0)`;
    if (!pointer) return;
    // One style write per frame, and only when it actually moved: the pin is
    // decoration, and re-writing the same value would cost a style recalc for
    // nothing at 60Hz. The sum is clamped, so the arm can never be driven past
    // full deflection by the two terms landing on the same frame.
    const flick = Number(
      Math.max(-1, Math.min(1, pinFlickAt(angle, speed) + (Number(seatClick) || 0))).toFixed(3),
    );
    if (flick === lastFlick) return;
    lastFlick = flick;
    pointer.style.setProperty('--wheel-pin-flick', String(flick));
  }

  /**
   * Light the ring from the band's current position — one number per lamp.
   *
   * This is where the chase lives, and it is deliberately NOT a CSS keyframe.
   * A keyframe chase has a fixed duration, so it cannot follow the drum; and
   * re-timing a running animation every frame makes the phase jump, which is
   * exactly the stutter a marquee must never have. Here the band's angle is
   * integrated from the drum's own angular velocity, so the light *is* the
   * rotation: it travels the way the drum turns, it slows with it
   * continuously, and it has no phase to jump.
   *
   * Two things keep that cheap at 60 Hz. A lamp's brightness is snapped to
   * `WHEEL_FRAME.litLevels` steps, and it is written only on the frames it
   * actually crosses a step — so a frame costs a few style writes, not 24, and
   * `--lamp-lit` is the only animated property in the whole subtree (`opacity`
   * and `transform` are derived from it in style.css). No filter, no
   * box-shadow, no layout: the ring stays on the compositor.
   *
   * Two things drive a bulb. The SVETOMUZIKA is the headline: the odd half of
   * the ring flashing against the even half, one flash per `flashStepDeg` of
   * band travel — so it flashes ~7 times a second at speed and eases down to a
   * slow warm pulse as the wheel dies, instead of running on a clock of its own.
   * The TRAVELLING HEAD rides on top as a bias: it is a third of the brightness
   * at most, but it is the part that keeps the ring legible as a wheel TURNING
   * rather than as a ring blinking, and it is why the marquee still follows the
   * drum's direction.
   *
   * The drive is blended INTO the lamp's resting glow rather than replacing it:
   * a bulb is a light source that is always on, so with the marquee gone the ring
   * settles back to the warm even glow it had before the spin instead of going
   * dark, which is what a real cabinet does between turns.
   *
   * @param {number} amplitude — how hard the ring is being driven at all, 1 → 0
   * @param {number} [flick] — the surge the whole ring gives when the pin stops
   *   the wheel, added to every lamp at once (see `settleFlickAt`)
   */
  function paintLamps(amplitude, flick = 0) {
    const amp = Math.max(0, Math.min(1, Number(amplitude) || 0));
    const surge = Math.max(0, Number(flick) || 0);

    for (let i = 0; i < lamps.length; i += 1) {
      const rest = lampRest[i] ?? 0;
      const drive = Math.min(
        1,
        WHEEL_FRAME.flashDepth * alternationAt(i, bandAngle) +
          WHEEL_FRAME.headGain * lampIntensity(lampAngles[i], bandAngle),
      );
      const lit = quantizeIntensity(rest + (1 - rest) * drive * amp + surge);
      if (lit === lampLevels[i]) continue;
      lampLevels[i] = lit;
      lamps[i].style.setProperty('--lamp-lit', String(lit));
    }
  }

  /**
   * Build the rim lamps: one drilled socket holding a bulb core and a halo.
   *
   * `--lamp-lit` is written onto the SOCKET, so both layers inside it read the
   * same number through inheritance — one style write lights the core and its
   * spill together. At rest the property sits at the bulb's own resting level
   * and the ring holds a warm, slightly uneven glow (style.css), so a lamp is a
   * real light source with a warm white core and a gold bloom on the brass, not
   * a dot changing opacity.
   *
   * Each lamp also carries its PARITY, and that is what the result strobe hangs
   * off: `data-lamp-parity="odd"` bulbs strobe on the opposite half of the cycle
   * from the even ones, so the ring flashes against itself. It is written as an
   * attribute rather than left to `:nth-child(odd)` in the stylesheet because
   * this module is what decides the order the sockets are appended in — the two
   * can never disagree if the same code sets both, and the contract test cannot
   * select a `:nth-child` through the DOM shim to prove it reached anything.
   *
   * The strobe cadences are written from config here, so the stylesheet holds no
   * copy of them that could drift; it only decides what a lit lamp looks like.
   */
  function renderLamps() {
    if (!lampLayer) return;

    lamps.forEach((lamp) => lamp.remove?.());
    lamps = [];

    const count = Math.max(1, WHEEL_FRAME.bulbCount);
    lampLayer.style.setProperty('--lamp-strobe', `${round(WHEEL_FRAME.strobeMs)}ms`);
    lampLayer.style.setProperty('--lamp-strobe-fast', `${round(WHEEL_FRAME.strobeFastMs)}ms`);

    const positions = lampPositions(count);
    lampAngles = positions.map(({ angle }) => angle);
    lampLevels = positions.map(() => null);
    lampRest = positions.map(({ index }) => restingLevel(index));

    positions.forEach(({ index, left, top }) => {
      const lamp = document.createElement('span');
      lamp.className = 'wheel-lamp';
      lamp.dataset.wheelLamp = String(index);
      lamp.style.left = left;
      lamp.style.top = top;
      lamp.style.setProperty('--i', String(index));
      // Which half of the marquee this bulb is on. Odd and even strobe on
      // opposite phases, which is the whole svetomuzika effect.
      lamp.dataset.lampParity = index % 2 === 0 ? 'even' : 'odd';
      // Lit from the moment it is built: the ring of a powered machine glows
      // between spins, so a resting cabinet is a warm ring and not a dark one.
      lamp.style.setProperty('--lamp-lit', String(lampRest[index]));

      // The halo first: it is the widest layer, it must sit behind the core,
      // and style.css reads it as the lamp's spill onto the brass.
      const halo = document.createElement('span');
      halo.className = 'wheel-lamp__glow';

      const core = document.createElement('span');
      core.className = 'wheel-lamp__core';

      lamp.append(halo, core);
      lampLayer.append(lamp);
      lamps.push(lamp);
    });
  }

  /** Paint the face, the rim lamps and the labels. Safe to call more than once. */
  function render() {
    if (!disc) return;

    if (face) face.innerHTML = buildWheelFace(segments);
    renderLamps();

    // Remove any previously rendered labels (re-render safety).
    labels.forEach((label) => label.remove?.());
    labels = [];

    segments.forEach((segment, index) => {
      const label = document.createElement('span');
      label.className = 'wheel-label';
      label.classList.toggle('wheel-label--blank', !(segment.multiplier > 0));
      label.classList.toggle('wheel-label--top', segment.multiplier >= WHEEL_BIG_WIN_MULTIPLIER);
      label.dataset.wheelLabel = String(index);
      label.textContent = formatMultiplier(segment.multiplier);
      // Radial text: reading direction runs from the hub outwards.
      label.style.transform =
        `translate(-50%, -50%) rotate(${segmentAngleOf(index) - 90}deg) ` +
        `translateX(calc(var(--wheel-size) * ${LABEL_RADIUS}))`;
      disc.append(label);
      labels.push(label);
    });
  }

  function clearHighlight() {
    labels.forEach((label) => label.classList.remove('is-win', 'is-lost'));
    disc?.classList.remove('is-win');
    stage?.classList.remove('is-win', 'is-jackpot');
    glow?.classList.remove('is-visible');
  }

  /**
   * Mark where the pointer stopped. A paying wedge lights up; a ×0 wedge only
   * gets a muted emphasis — the player should always see the landing spot, but
   * never mistake it for a win, and a losing stop stays otherwise dark.
   */
  function highlight({ segmentIndex, multiplier }) {
    const landed = Number.isInteger(segmentIndex) ? labels[segmentIndex] : null;
    if (landed) landed.classList.add(multiplier > 0 ? 'is-win' : 'is-lost');

    if (!(multiplier > 0)) return;

    if (glow && Number.isInteger(segmentIndex)) {
      glow.style.setProperty('--win-angle', `${round(segmentAngleOf(segmentIndex))}deg`);
      glow.classList.add('is-visible');
    }
    if (multiplier >= WHEEL_BIG_WIN_MULTIPLIER) {
      disc?.classList.add('is-win');
      stage?.classList.add('is-win');
    }
    // The top tier gets its own, quicker marquee on top of that — the ladder
    // the player reads as normal → exciting → spectacular.
    if (multiplier >= WHEEL_JACKPOT_MULTIPLIER) stage?.classList.add('is-jackpot');
  }

  /** Resolve `result`'s landing angle into a plan and animate it. */
  function spin(result) {
    if (!disc) return Promise.resolve();

    const quick = reducedMotion();
    const span = quick ? WHEEL_SPIN.reducedMotionDurationMs : Math.max(0, Number(durationMs) || 0);

    const plan = planWheelSpin({
      fromRotation: rotation,
      stopAngle: Number(result?.stopAngle) || 0,
      turns: quick ? 1 : Math.max(1, Number(result?.turns) || WHEEL_SPIN.minTurns),
      jitter: Number(result?.jitter) || 0,
      durationMs: span,
    });

    spinning = true;
    clearHighlight();
    disc.classList.add('is-spinning');
    stage?.classList.add('is-chasing');

    return new Promise((resolve) => {
      const startedAt = monotonicNow();
      let lastAt = 0;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        caf(frame);
        // Seat the drum on the exact drawn angle — the curve already ends there,
        // so this is a no-op in practice and a guarantee in every other case.
        rotation = plan.to;
        paint(plan.to, 0, 0);
        // The ring sits down with the wheel: the last of the flywheel has
        // already bled off, so this only has to settle every lamp back onto its
        // own resting glow — the ring is left lit, exactly as it was found.
        paintLamps(0, 0);
        disc.classList.remove('is-spinning');
        stage?.classList.remove('is-chasing');
        spinning = false;
        resolve();
      };

      const step = () => {
        if (settled) return;
        const elapsed = monotonicNow() - startedAt;
        const at = Math.min(elapsed, plan.durationMs);
        const dt = Math.max(0, at - lastAt);
        lastAt = at;

        // The arm: the pegs it is riding (from the disc's angle and speed) plus
        // the one click it takes as the wheel finally seats.
        paint(rotationAt(plan, at), velocityAt(plan, at), pinSeatClickAt(plan, at));

        // Advance the light band by the distance it covers in this frame, at
        // the rate the wheel is actually turning (see bandStateAt), then light
        // the ring from where it landed.
        const { rate, amplitude, flick } = bandStateAt(plan, at);
        bandAngle += rate * dt;
        paintLamps(amplitude, flick);

        if (elapsed >= plan.durationMs) finish();
        else frame = raf(step);
      };

      step();
    });
  }

  return {
    render,
    spin,
    highlight,
    /** Rotation currently applied to the disc (unwrapped, ever-increasing). */
    get rotation() {
      return rotation;
    },
    clearHighlight,
    elements: {
      disc,
      face,
      glow,
      stage,
      pointer,
      lampLayer,
      /** The angle the light band's head is at; the band's only state. */
      get bandAngle() {
        return bandAngle;
      },
      /** `labels` is re-created on every render(), so expose it as a getter. */
      get labels() {
        return labels;
      },
      /** ...and the built lamps with them. */
      get lamps() {
        return lamps;
      },
      /** Each lamp's resting brightness, in the same order as `lamps`. */
      get lampRest() {
        return lampRest;
      },
    },
    isSpinning: () => spinning,
  };
}

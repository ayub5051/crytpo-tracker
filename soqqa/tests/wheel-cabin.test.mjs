/* ============================================================================
   SOQQA — Omad charxi cabin contract
   ----------------------------------------------------------------------------
   The wheel's frame is split across three files by design:

     index.html   the static chrome — brass rim, its bulbs, the landing pin's
                  vector arrow, the brass knob (index.html + style.css)
     js/ui/wheelDisc.js  the drum's face, built from the segment table
     style.css    how all of it moves

   Splitting it means each half can be wrong on its own, so this suite holds the
   join: the bulbs have to be on the rim and not on the drum, the knob has to
   carry no lettering, the chase has to read the index the markup writes, and
   the pin's flick has to be the width the config declares.
   ========================================================================= */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WHEEL_FRAME, WHEEL_SEGMENTS, WHEEL_SPIN } from '../js/config.js';
import { SEGMENT_ANGLE } from '../js/games/wheel.js';
import {
  FACE_VIEWBOX,
  WEDGE_RAMP_OFFSETS,
  WHEEL_FACE_RINGS,
  buildWheelFace,
  lampPositions,
  polarPoint,
  wedgePath,
  wedgeRamp,
} from '../js/ui/wheelDisc.js';
import { alternationAt, bandMaxRate } from '../js/ui/wheelPhysics.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

/** Handles emoji/pictographs, which the wheel chrome must not fall back to. */
const PICTOGRAPHIC = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/u;

/** The slice of index.html that holds the wheel cabinet. */
function wheelMarkup(html) {
  const start = html.indexOf('class="game-layout game-layout--wheel"');
  const end = html.indexOf('<aside class="card legend"');
  return start === -1 || end === -1 ? '' : html.slice(start, end);
}

/** The body of a CSS rule, by its exact selector. */
function ruleBody(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return '';
  return css.slice(start, css.indexOf('\n}', start));
}

/**
 * The body of the rule whose SELECTOR LIST contains `selector`, for the rules
 * that deliberately share one declaration block between two selectors (the
 * strobe drives the halo and the core together). `ruleBody` insists on a
 * standalone rule and would otherwise find the reduced-motion override further
 * down the file instead.
 */
function groupBody(css, selector) {
  const at = css.indexOf(selector);
  if (at === -1) return '';
  const brace = css.indexOf('{', at);
  return brace === -1 ? '' : css.slice(brace, css.indexOf('\n}', brace));
}

/** The raw body of a `@keyframes` block, braces included; '' when there is none. */
function keyframeBody(css, name) {
  const start = css.indexOf(`@keyframes ${name} {`);
  if (start === -1) return '';
  let depth = 0;
  let index = css.indexOf('{', start);
  const body = [];
  for (; index < css.length; index += 1) {
    const char = css[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
    body.push(char);
  }
  return body.join('');
}

/**
 * Every property a keyframes block declares, lower-cased and de-duplicated.
 *
 * This is the lever the whole "does it actually animate smoothly" question
 * turns on: a keyframe that touches anything but `opacity` and `transform`
 * forces the engine to re-layout or re-paint the element on every frame, and
 * with 24 lamps on a ring that is precisely how a bulb chase ends up stuttering
 * or looking frozen.
 */
function keyframeProps(css, name) {
  const block = keyframeBody(css, name);
  if (!block) return null;
  const inner = block.slice(block.indexOf('{') + 1);
  const props = new Set();
  [...inner.matchAll(/([a-z-]+)\s*:/g)].forEach((match) => props.add(match[1]));
  return [...props];
}

/** Every property a rule declares, for the "is this cheap to animate" checks. */
const ruleProps = (css, selector) =>
  [...ruleBody(css, selector).matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);

const near = (a, b, tolerance = 0.01) => Math.abs(a - b) <= tolerance;

/** The `background` value of a rule, whitespace-collapsed. */
const backgroundOf = (css, selector) =>
  ((/background:\s*([\s\S]*?);/.exec(ruleBody(css, selector)) ?? [])[1] ?? '').replace(/\s+/g, ' ');

/**
 * The 70.71 % at which a round element clips its own `circle` gradient.
 *
 * A `circle` gradient with no explicit size is sized to `farthest-corner`, so
 * its radius is 0.7071 × the element's width — while the element, at
 * `border-radius: 50%`, is a circle of half that. Everything past this point is
 * painted outside the element and thrown away.
 */
const CIRCLE_CLIP = (0.5 / Math.SQRT1_2) * 100;

/**
 * A comma-separated CSS value split at its TOP level only — the commas inside
 * `rgba(…)` are part of the colour, and a naive `split(',')` shatters every
 * shadow layer into fragments that then parse as nothing.
 */
function cssLayers(value) {
  const layers = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      layers.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) layers.push(current.trim());
  return layers;
}

/**
 * The one rule every light layer on this cabinet obeys, asserted as a rule
 * rather than layer by layer: a glow has to FADE, and it has to finish fading
 * before the element clips it.
 *
 * This is not a style preference. A falloff written to `transparent 82 %` on a
 * round element really ends at whatever alpha it had reached by 70.71 % — so a
 * gradient that looks like a careful fade in the stylesheet renders as a hard,
 * fully-saturated edge wrapped around the wheel. The backdrop and the neon ring
 * both shipped that way, and that edge is most of what read as a cheap orange
 * halo rather than as light.
 */
function assertFalloffInsideDisc(suite, label, css, selector) {
  const background = backgroundOf(css, selector);
  const offsets = [...background.matchAll(/([\d.]+)%/g)].map((match) => Number(match[1]));
  // Where the ramp reaches zero. It has to be the LAST stop written, not just
  // any stop: a `transparent` early in the middle of the ring is how the hole
  // in the middle is cut, so finding one proves nothing on its own.
  const fades = [...background.matchAll(/transparent\s+([\d.]+)%/g)].map((match) => Number(match[1]));
  const last = offsets[offsets.length - 1];
  suite.ok(
    `${label} fades out inside the disc instead of being cut off by it`,
    offsets.length >= 3 &&
      offsets.every((offset) => offset <= CIRCLE_CLIP + 0.01) &&
      fades.length > 0 &&
      Math.max(...fades) === last,
    `${offsets.join(' / ')}% — clip at ${CIRCLE_CLIP.toFixed(2)}%`,
  );
}

/**
 * Signed shortest difference between two angles, in (−180, 180]. Needed because
 * a wedge at 345° is one segment-step away from 15°, not 330° away, and folding
 * the difference into [0, 360) would say otherwise.
 */
const angularDelta = (a, b) => (((a - b) % 360) + 540) % 360 - 180;

/**
 * The anti-ring rule — and the reason the glow stopped looking cheap.
 *
 * A ring is not a colour and not an alpha, it is a SHAPE. Any layer whose
 * brightness rises again on its way out — a peak at a second radius, or a hole
 * with light behind it — reads as its own glowing circle, and several such
 * layers stacked is exactly what "multiple weird glowing rings" was. Dimming
 * them does not help: the eye finds an edge at any alpha, and every one of them
 * had been dimmed in turn.
 *
 * So the contract is about the PROFILE rather than the numbers: every stop has
 * to be dimmer than the one inside it. Note the shape of it — a falloff written
 * as `transparent 55%, …a peak at 64%…` fails this as surely as an obvious
 * bright band, which is the trap the previous two attempts each fell into.
 */
function assertNoRing(suite, label, css, selector) {
  const stops = [...backgroundOf(css, selector).matchAll(/(rgba\(([^)]+)\)|transparent)\s*([\d.]+)%/g)].map(
    (match) => ({
      a: match[2] ? Number(match[2].split(',').pop().trim()) : 0,
      at: Number(match[3]),
    }),
  );
  suite.ok(
    `${label} only ever gets fainter on its way out, so it cannot read as a ring`,
    stops.length >= 4 &&
      stops.some((stop) => stop.a > 0) &&
      stops.every((stop, index) => index === 0 || stop.a <= stops[index - 1].a),
    stops.length === 0
      ? 'NO STOP WAS PARSED — the guard would otherwise pass on an empty set'
      : stops.map((stop) => `${stop.a}@${stop.at}%`).join(' '),
  );
}

export function runWheelCabinTests(suite) {
  const html = read('index.html');
  const css = read('style.css');
  const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const cabin = wheelMarkup(html);

  suite.ok('the wheel cabinet markup was located', cabin.length > 800, `${cabin.length} chars`);
  suite.ok(
    'the wheel chrome carries no emoji',
    cabin.length > 0 && !PICTOGRAPHIC.test(cabin),
    (cabin.match(PICTOGRAPHIC) ?? [''])[0],
  );

  /* ----------------------------------------------------------------------
     The stage: drum, static rim, pin, knob
     ---------------------------------------------------------------------- */
  const stage = cabin.slice(cabin.indexOf('class="wheel-stage"'), cabin.indexOf('data-wheel-summary'));
  suite.ok('the wheel stage markup was located', stage.length > 600, `${stage.length} chars`);

  /* ----------------------------------------------------------------------
     The cabinet's warm backdrop
     ---------------------------------------------------------------------- */
  {
    const backdrop = ruleBody(cssCode, '.wheel-stage::before');
    suite.ok('there is a backdrop behind the wheel', backdrop.length > 0);
    suite.ok(
      'it is one soft warm wash behind the wheel, and the only atmosphere layer there is',
      /radial-gradient\(\s*circle,/.test(backdrop) &&
        /rgba\(255,\s*178,\s*46,\s*0\.\d+\)\s*0%/.test(backdrop),
      (/background:[^;]+;/.exec(backdrop) ?? [''])[0].replace(/\s+/g, ' ').slice(0, 160),
    );
    // Warmth is a function of opacity, not of hue alone: a bloom this faint
    // reads as a dark ring on a dim screen, which is the "cold" look the
    // backdrop exists to kill. It is equally true at the other end — a
    // saturated gold disc at 0.3 is the loudest thing on the page, which is the
    // "cheap" look this layer then acquired. So warmth is a BAND now, with a
    // floor for visibility and a ceiling for restraint.
    {
      const stops = [...backdrop.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)].map(
        (match) => ({ r: +match[1], g: +match[2], b: +match[3], a: +match[4] }),
      );
      const peak = Math.max(...stops.map((stop) => stop.a));
      suite.ok(
        'it is a whisper on the wall, not a lamp: present, and nowhere near loud',
        stops.length >= 4 && peak >= 0.05 && peak <= 0.18,
        stops.length === 0
          ? 'NO rgba() STOP WAS PARSED — the guard would otherwise pass on an empty set'
          : `${stops.length} stops, peak ${peak}`,
      );
      // One hue family, warm at every stop. The recipe before this one ran
      // amber → crimson → the page's violet and teal: defensible as physics, but
      // at this size it read as colour banding wrapped round a gold machine,
      // which is half of what made the glow look wrong.
      suite.ok(
        'and it is warm at every stop — one hue family, no colour banding',
        stops.every((stop) => stop.r > stop.g && stop.g > stop.b),
        stops.map((stop) => `rgba(${stop.r},${stop.g},${stop.b},${stop.a})`).join(' '),
      );
    }
    assertNoRing(suite, 'the backdrop', cssCode, '.wheel-stage::before');
    suite.ok(
      'and it spills past the drum rather than stopping at the frame',
      /inset:\s*calc\(var\(--wheel-size\)\s*\*\s*-[\d.]+\)/.test(backdrop),
      (/inset:[^;]+;/.exec(backdrop) ?? [''])[0].trim(),
    );
    {
      const backdropZ = Number(/z-index:\s*(\d+)/.exec(backdrop)?.[1] ?? NaN);
      const discZ = Number(/z-index:\s*(\d+)/.exec(ruleBody(cssCode, '.wheel-disc'))?.[1] ?? NaN);
      suite.ok(
        'it sits behind the drum, so it is only ever seen AROUND the wheel',
        Number.isFinite(backdropZ) && backdropZ < discZ,
        `backdrop ${backdropZ} vs drum ${discZ}`,
      );
    }
    suite.ok(
      'and it costs nothing per frame: a gradient, never a filter or an animation',
      !ruleProps(cssCode, '.wheel-stage::before').includes('filter') &&
        !ruleProps(cssCode, '.wheel-stage::before').includes('animation') &&
        !ruleProps(cssCode, '.wheel-stage::before').includes('backdrop-filter'),
      ruleProps(cssCode, '.wheel-stage::before').join(', '),
    );
    assertFalloffInsideDisc(suite, 'the backdrop', cssCode, '.wheel-stage::before');

    // The seat the drum drops into. A neutral black well is most of what makes a
    // cabinet read as a UI card, so it is deliberately a warm dark brown.
    const stageRule = ruleBody(cssCode, '.wheel-stage');
    suite.ok(
      'and the well behind the drum is warm, not a neutral black',
      /radial-gradient\(circle at 50% 44%,\s*rgba\(38,\s*26,\s*10/.test(stageRule),
      (/background:[^;]+;/.exec(stageRule) ?? [''])[0].replace(/\s+/g, ' '),
    );

    // The well is LIT, in layers — a dark seat, the amber bounce the rim throws
    // back into its own cavity, a crimson falloff under it, the deep inner
    // shadow that seats the drum, and the bloom spilling past the frame. One
    // `inset 0 0 0 1px` hairline is what read as a card border.
    const insetLayers = (stageRule.match(/inset 0/g) ?? []).length;
    suite.ok(
      'the well is lit in layers, not outlined in a flat 1 px ring',
      insetLayers >= 4 && /inset 0 0 \d+px rgba\(255,\s*183,\s*3/.test(stageRule),
      `${insetLayers} inset layers`,
    );

    // The bloom thrown OUTWARD, onto the panel around the cabinet. Three passes
    // at three radii and two hues used to be here, on top of two more rings in
    // the layers above — five overlapping halos is not five times the
    // atmosphere, it is a glow that has lost its source. One dim warm pass is
    // left, over the black drop shadow that seats the machine. A centred shadow
    // is a blurred copy of the frame's own circle, so it is brightest at the
    // metal and only ever falls outward: it cannot brighten again at any radius.
    {
      const shadow = (/box-shadow:\s*([\s\S]*?);/.exec(stageRule) ?? [])[1] ?? '';
      const passes = cssLayers(shadow)
        .filter((layer) => !layer.startsWith('inset'))
        .map((layer) =>
          /^0 0 ([\d.]+)px rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(layer),
        )
        .filter(Boolean)
        .map((match) => ({
          blur: +match[1],
          r: +match[2],
          g: +match[3],
          b: +match[4],
          a: +match[5],
        }));
      suite.ok(
        'the spill onto the panel is one dim warm pass, not a stack of halos',
        passes.length === 1 && passes[0].a <= 0.14 && passes[0].r > passes[0].b,
        passes.map((pass) => `${pass.blur}px a=${pass.a}`).join(', ') || 'none',
      );
      suite.ok(
        'and the machine is seated by a deep black drop shadow rather than more light',
        /0 24px 70px rgba\(0, 0, 0, 0\.86\)/.test(shadow),
        shadow.replace(/\s+/g, ' ').slice(0, 80),
      );
    }
  }

  /* ----------------------------------------------------------------------
     The ambient aura
     ----------------------------------------------------------------------
     A second, wider pass of the SAME warm light. Two monotone washes of one
     hue sum to a monotone wash of one hue, so this adds reach and depth without
     adding an edge — which is the only reason it is allowed to exist at all.
     Anything with a peak at its own radius is a ring, and a machine wearing
     three of them is what this block spent two rounds failing to see.
     ---------------------------------------------------------------------- */
  {
    suite.ok('the cabinet carries an ambient aura layer', /class="wheel-aura"/.test(cabin));

    const aura = ruleBody(cssCode, '.wheel-aura');
    suite.ok(
      'the aura is the same warm light, wider and even dimmer than the backdrop',
      /radial-gradient\(\s*circle,/.test(aura) &&
        /rgba\(255,\s*176,\s*48,\s*0\.1\)\s*0%/.test(aura),
      (/background:[^;]+;/.exec(aura) ?? [''])[0].replace(/\s+/g, ' ').slice(0, 120),
    );

    {
      const lit = [...aura.matchAll(/rgba\(([^)]+)\)\s*([\d.]+)%/g)].map((match) => ({
        parts: match[1].split(',').map((part) => Number(part.trim())),
        at: Number(match[2]),
      }));
      const peak = Math.max(...lit.map((stop) => stop.parts[3]));
      suite.ok(
        'it shares the backdrop\u2019s hue family, so the two read as one wash and not two bands',
        lit.length >= 4 && lit.every(({ parts: [r, g, b] }) => r > g && g > b),
        `${lit.length} stops`,
      );
      // No peak at a radius of its own. That is the whole difference between an
      // aura and a ring: the brightest stop has to be the INNERMOST one, under
      // the opaque drum, where it can never be seen.
      suite.ok(
        'and it peaks under the drum, never at a radius of its own',
        lit.length >= 4 && peak <= 0.12 && lit[0].parts[3] === peak,
        `peak ${peak}, first stop ${lit[0]?.parts[3]}`,
      );
    }
    assertNoRing(suite, 'the aura', cssCode, '.wheel-aura');
    assertFalloffInsideDisc(suite, 'the aura', cssCode, '.wheel-aura');

    suite.ok(
      'it carries no filter at all — nothing here has a band left to soften',
      !ruleProps(cssCode, '.wheel-aura').includes('filter'),
      ruleProps(cssCode, '.wheel-aura').join(', '),
    );
    suite.ok(
      'and it never animates, because an atmosphere that moves is one that pulls the eye',
      !ruleProps(cssCode, '.wheel-aura').includes('animation') &&
        !ruleProps(cssCode, '.wheel-aura').includes('transition'),
      ruleProps(cssCode, '.wheel-aura').join(', '),
    );

    {
      const auraZ = Number(/z-index:\s*(\d+)/.exec(aura)?.[1] ?? NaN);
      const discZ = Number(/z-index:\s*(\d+)/.exec(ruleBody(cssCode, '.wheel-disc'))?.[1] ?? NaN);
      suite.ok(
        'the aura sits behind the drum, so it is a halo and not a smear over the wedges',
        Number.isFinite(auraZ) && auraZ < discZ,
        `aura ${auraZ} vs drum ${discZ}`,
      );
    }
  }

  /* ----------------------------------------------------------------------
     There is no neon layer any more
     ----------------------------------------------------------------------
     Removing it IS the fix, so it is pinned the way a fix is pinned: with the
     aura's peak and this ring's peak at different radii — plus a third coloured
     band in the backdrop — the machine wore two concentric glowing rings, and
     each of them was separately dimmed while the composite stayed loud.

     These assertions therefore guard the ABSENCE. What is left as the only
     moving part of this machine is the bulb ring on the rim, which is a
     spinner, plus the earned result lighting.
     ---------------------------------------------------------------------- */
  {
    const reducedSheet = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));

    suite.ok(
      'the cabinet no longer carries a neon layer',
      !/class="wheel-neon"/.test(cabin) && !/wheel-neon/.test(cssCode),
      (stage.match(/class="wheel-[a-z-]+"/g) ?? []).join(' '),
    );
    suite.ok(
      'and its keyframes are gone with it, so nothing can animate it back in',
      !/@keyframes\s+neon-breathe/.test(cssCode) &&
        !/animation:[^;]*neon-breathe/.test(cssCode),
    );
    suite.ok(
      'exactly one atmosphere layer is left behind the drum, and it is the static one',
      (stage.match(/class="wheel-aura"/g) ?? []).length === 1 &&
        (stage.match(/class="wheel-(aura|neon)/g) ?? []).length === 1,
    );
    // The slice runs from the FIRST reduced-motion block to the end of the
    // file, and it therefore contains comments as well as rules — so it is
    // stripped before the check, or it would be asserting against prose.
    const reducedRules = reducedSheet.replace(/\/\*[\s\S]*?\*\//g, ' ');
    suite.ok(
      'and the reduced-motion sheet carries no dead entry for it',
      !/wheel-neon/.test(reducedRules),
      (reducedRules.match(/\.wheel-[a-z_-]+/g) ?? []).slice(0, 5).join(' '),
    );
  }

  /* ----------------------------------------------------------------------
     Number legibility
     ----------------------------------------------------------------------
     The drum alternates deep ruby and PALE GOLD, and the labels are near-white:
     a label that relies on a single soft shadow sits at almost no contrast on
     the light half of the wheel. The fix is a dark RING around the glyph, which
     is why the count of shadow layers is asserted and not just the colour.
     ---------------------------------------------------------------------- */
  {
    const label = ruleBody(cssCode, '.wheel-label');
    const ring = /--label-ring:\s*([\s\S]*?);/.exec(label)?.[1] ?? '';
    const ringLayers = (ring.match(/rgba\(/g) ?? []).length;

    suite.ok(
      'a number is outlined by a hard dark ring, not one soft shadow',
      ringLayers >= 7,
      `${ringLayers} outline layers`,
    );
    suite.ok(
      'the ring includes the requested 2 px drop layer',
      /0 2px 4px rgba\(0,\s*0,\s*0,\s*0\.9\)/.test(ring),
    );
    suite.ok(
      'the ring actually reaches the text-shadow',
      /text-shadow:\s*var\(--label-ring\)/.test(label),
    );
    suite.ok(
      'the numbers are heavy and tabular, so no label is wider than the widest',
      /font-weight:\s*(800|900)/.test(label) && /font-variant-numeric:\s*tabular-nums/.test(label),
      (/font-size:[^;]+;/.exec(label) ?? [''])[0].trim(),
    );

    // `text-shadow` is ONE property: a state that re-declares it replaces the
    // whole list. Written the obvious way, the jackpot rule would have made the
    // biggest number on the wheel the only one with no outline at all.
    ['.wheel-label--top', '.wheel-label.is-win', '.wheel-label.is-lost'].forEach((selector) => {
      const body = ruleBody(cssCode, selector);
      suite.ok(
        `${selector} keeps the ring instead of replacing it`,
        /text-shadow:\s*var\(--label-ring\)/.test(body),
        (/text-shadow:[^;]+;/.exec(body) ?? [''])[0].trim().slice(0, 64),
      );
    });
  }

  suite.eq('the stage declares one drum', (stage.match(/class="wheel-disc"/g) ?? []).length, 1);
  suite.ok('the drum holds the face mount and the win wedge', stage.includes('data-wheel-face') && stage.includes('data-wheel-glow'));
  suite.ok('the drum starts empty — the face is built at runtime', /class="wheel-face-mount" data-wheel-face><\/div>/.test(stage));
  suite.ok('the landing pin is a real element the view can drive', stage.includes('data-wheel-pointer'));
  suite.ok('the pin is drawn as vector art, not a CSS triangle', stage.includes('wheel-pointer__art') && stage.includes('wheel-pointer__blade'));
  suite.ok('the pin has a pivot the arrow can swing about', stage.includes('wheel-pointer__pivot'));

  /* ----------------------------------------------------------------------
     The rim
     ---------------------------------------------------------------------- */
  const rimStart = stage.indexOf('<svg class="wheel-rim"');
  const rimEnd = stage.indexOf('</svg>', rimStart);
  const rim = rimStart === -1 ? '' : stage.slice(rimStart, rimEnd);

  suite.ok('the rim is a real band with a brass gradient', rim.includes('wheel-rim__band') && rim.includes('url(#sqRimBrass)'));
  suite.ok(
    'the band is a thick frame, not an outline',
    Number(/class="wheel-rim__band"[^>]*stroke-width="([\d.]+)"/.exec(rim)?.[1] ?? 0) >= 5,
    (/stroke-width="([\d.]+)"/.exec(rim) ?? [])[1],
  );
  suite.ok('the band catches a highlight along its top', rim.includes('wheel-rim__spec') && rim.includes('url(#sqRimSpec)'));
  suite.ok('the drum is seated in a recess shadow', rim.includes('wheel-rim__seat') && rim.includes('url(#sqRimRecess)'));
  suite.ok(
    'the bulbs are no longer hand-written into the SVG',
    !rim.includes('wheel-bulb') && !stage.includes('wheel-bulb'),
  );
  suite.ok('a lamp layer exists for the runtime to fill', stage.includes('data-wheel-lamps'));

  // Every one of these is a hook the stylesheet animates through, so a class
  // going missing in the markup would silently kill an animation.
  ['wheel-stage', 'wheel-disc', 'wheel-face-mount', 'wheel-wedge-glow', 'wheel-pointer', 'wheel-hub', 'wheel-lamps'].forEach(
    (className) => {
      suite.ok(
        `the markup carries .${className}, which the stylesheet needs`,
        stage.includes(`class="${className}"`),
      );
    },
  );

  /* ----------------------------------------------------------------------
     The frame's neon filament
     ----------------------------------------------------------------------
     Two concentric hairlines on the outer edge — a 0.55 unit filament with a
     1.7 unit halo behind it — carrying a violet → cyan → magenta gradient, so
     the frame reads as an edge-lit machine. They are STATIC: the rim carries a
     `filter` for its depth shadow, and animating anything inside a filtered
     subtree re-rasterises that filter every frame.
     ---------------------------------------------------------------------- */
  {
    suite.ok(
      'the frame carries a neon filament and its halo',
      rim.includes('wheel-rim__neon') && rim.includes('wheel-rim__neon-halo'),
    );
    suite.ok(
      'both are drawn from one declared gradient',
      /class="wheel-rim__neon"[^>]*stroke="url\(#([^"]+)\)"/.test(rim) &&
        new RegExp(`<linearGradient id="${
          /class="wheel-rim__neon"[^>]*stroke="url\(#([^"]+)\)"/.exec(rim)?.[1]
        }"`).test(rim),
    );
    suite.ok(
      'the filament is a hairline on the outermost edge, outside the brass band',
      (() => {
        const filament = Number(/class="wheel-rim__neon"[^>]*r="([\d.]+)"/.exec(rim)?.[1] ?? NaN);
        const band = Number(/class="wheel-rim__band"[^>]*r="([\d.]+)"/.exec(rim)?.[1] ?? NaN);
        return Number.isFinite(filament) && filament > band;
      })(),
      `filament ${/class="wheel-rim__neon"[^>]*r="([\d.]+)"/.exec(rim)?.[1]} vs band ${/class="wheel-rim__band"[^>]*r="([\d.]+)"/.exec(rim)?.[1]}`,
    );
    {
      const neonStops = [...(rim.match(/id="sqRimNeon"[\s\S]*?<\/linearGradient>/)?.[0] ?? '').matchAll(
        /stop-opacity="([\d.]+)"/g,
      )].map((match) => Number(match[1]));
      suite.ok(
        'and the filament is visible light, not a tint: a stop clearing 0.8',
        neonStops.length >= 3 && neonStops.some((alpha) => alpha >= 0.8),
        neonStops.join(', '),
      );
      // The other half of the contract: it is an EDGE light. The halo may spill,
      // but it has to stay a spill — narrow, and wider than the thread it wraps,
      // or the rim becomes a painted band instead of a lit one.
      suite.ok(
        'while the halo stays a narrow spill around the thread, not a band',
        (() => {
          const halo = Number(/class="wheel-rim__neon-halo"[^>]*stroke-width="([\d.]+)"/.exec(rim)?.[1] ?? NaN);
          const thread = Number(/class="wheel-rim__neon"[^>]*stroke-width="([\d.]+)"/.exec(rim)?.[1] ?? NaN);
          return Number.isFinite(halo) && Number.isFinite(thread) && halo > thread && halo < 3;
        })(),
        `halo ${
          /class="wheel-rim__neon-halo"[^>]*stroke-width="([\d.]+)"/.exec(rim)?.[1]
        } vs thread ${/class="wheel-rim__neon"[^>]*stroke-width="([\d.]+)"/.exec(rim)?.[1]}`,
      );
    }
    suite.ok(
      'the neon layer is never animated, because the rim is a filtered subtree',
      !/\.wheel-rim__neon[\s\S]{0,120}animation:/.test(cssCode),
    );
  }

  /* ----------------------------------------------------------------------
     The lamp ring, from the real builder
     ---------------------------------------------------------------------- */
  const lamps = lampPositions();
  suite.eq(
    'the ring is built with exactly the bulbs the config declares',
    lamps.length,
    WHEEL_FRAME.bulbCount,
  );
  suite.ok(
    'the bulb count is even and dense enough to read as a travelling pulse',
    WHEEL_FRAME.bulbCount % 2 === 0 && WHEEL_FRAME.bulbCount >= 16,
    `${WHEEL_FRAME.bulbCount} bulbs`,
  );
  // The spin's chase is integrated from the drum's own speed and arrives as
  // `--lamp-lit`, so it has no timing to check at all. What the config does have
  // to say is how the light is SHAPED: how far it sweeps, how heavy its tail
  // is, and how its rate is derived from the drum.
  suite.ok(
    'the band sweeps an arc wide enough to light several bulbs at once',
    WHEEL_FRAME.sweepArcDeg > 0 && WHEEL_FRAME.sweepArcDeg < 360,
    `${WHEEL_FRAME.sweepArcDeg}°`,
  );
  suite.ok(
    'and it tails off behind its head, rather than ending in a hard edge',
    WHEEL_FRAME.tailExponent > 0,
    String(WHEEL_FRAME.tailExponent),
  );
  suite.ok(
    'its rate comes from the drum, scaled and clamped so it cannot blur',
    WHEEL_FRAME.chaseGain > 0 && WHEEL_FRAME.chaseMaxRevPerSec > 0,
    `×${WHEEL_FRAME.chaseGain}, capped at ${WHEEL_FRAME.chaseMaxRevPerSec} rev/s`,
  );
  suite.ok(
    'its brightness is stepped, which is what a row of real bulbs does',
    WHEEL_FRAME.litLevels > 1,
    `${WHEEL_FRAME.litLevels} steps`,
  );
  suite.ok(
    'and the lights wind down with the wheel rather than stopping dead',
    WHEEL_FRAME.settleMs > 0 &&
      WHEEL_FRAME.settleRateDecay > 0 &&
      WHEEL_FRAME.settleFadeDecay > 0,
    `${WHEEL_FRAME.settleMs} ms settle`,
  );
  /* ----------------------------------------------------------------------
     Svetomuzika: the two halves flashing against each other
     ---------------------------------------------------------------------- */
  suite.ok(
    'the marquee is not a single head chasing round: the two halves flash against each other',
    // The travelling head still exists, but only as a BIAS on top of the flash —
    // the alternation is what a player recognises as a casino machine.
    WHEEL_FRAME.flashDepth > WHEEL_FRAME.headGain &&
      WHEEL_FRAME.flashDepth > 0.5 &&
      WHEEL_FRAME.headGain > 0,
    `flash ×${WHEEL_FRAME.flashDepth} vs head ×${WHEEL_FRAME.headGain}`,
  );
  suite.ok(
    'the travelling head is still there, which is what keeps the ring legible as a turning wheel',
    WHEEL_FRAME.headGain > 0 && WHEEL_FRAME.sweepArcDeg > 0,
    `head ×${WHEEL_FRAME.headGain} over ${WHEEL_FRAME.sweepArcDeg}°`,
  );
  suite.ok(
    'one flash per `flashStepDeg` of band travel, so the cadence is the drum\u2019s own',
    WHEEL_FRAME.flashStepDeg > 0,
    `${WHEEL_FRAME.flashStepDeg}\u00b0 of band per flash`,
  );
  {
    // The fastest the ring can flash is fixed by the same clamp that stops the
    // head blurring. It has to stay slow enough that a flash lasts several
    // frames — otherwise the "flash" aliases into a steady blur and the whole
    // effect is lost, which is the failure mode a fast strobe always has.
    const maxHz = (bandMaxRate() * 1000) / WHEEL_FRAME.flashStepDeg;
    const framesPerFlash = (1000 / 60) * maxHz;
    suite.ok(
      'the clamp keeps it slow enough to actually read as a flash',
      framesPerFlash >= 3,
      `${maxHz.toFixed(1)} flashes/s = ${framesPerFlash.toFixed(1)} frames each`,
    );
    suite.ok(
      'but fast enough to be a flash rather than a slow pulse',
      maxHz >= 3 && maxHz <= 12,
      `${maxHz.toFixed(1)} flashes/s at the clamp`,
    );
  }
  suite.ok(
    'and the two halves are on opposite phases, so they can never flash together',
    (() => {
      for (let angle = -720; angle <= 720; angle += 3) {
        for (let i = 0; i < 8; i += 1) {
          if (Math.abs(alternationAt(i, angle) + alternationAt(i + 1, angle) - 1) > 1e-9) return false;
        }
      }
      return true;
    })(),
  );

  const radii = lamps.map(({ x, y }) => Math.hypot(x - 50, y - 50));
  suite.ok(
    'every lamp sits on one ring',
    radii.length > 0 && radii.every((radius) => near(radius, WHEEL_FRAME.bulbRadius, 0.05)),
    `${Math.min(...radii).toFixed(2)}–${Math.max(...radii).toFixed(2)}`,
  );
  const steps = lamps.map((lamp, index) => angularDelta(lamps[(index + 1) % lamps.length].angle, lamp.angle));
  suite.ok(
    'the lamps are evenly spaced all the way round, with no gap at 12 o\u2019clock',
    steps.every((step) => Math.abs(step - 360 / WHEEL_FRAME.bulbCount) < 0.02),
    `${Math.min(...steps).toFixed(2)}–${Math.max(...steps).toFixed(2)}\u00b0`,
  );
  suite.ok(
    'no lamp lands on the pointer seam',
    lamps.every((lamp) => Math.abs(angularDelta(lamp.angle, 0)) > 1),
    `${lamps[0]?.angle}\u00b0`,
  );
  suite.ok(
    'each lamp is handed the percentages the markup positions it with',
    lamps.every(({ left, top }) => left.endsWith('%') && top.endsWith('%') && Number.parseFloat(left) > 0),
    `${lamps[0]?.left}, ${lamps[0]?.top}`,
  );
  suite.ok(
    'the ring sits inside the rim on the drum side of the band',
    WHEEL_FRAME.bulbRadius < 50 && WHEEL_FRAME.bulbRadius > 40,
    String(WHEEL_FRAME.bulbRadius),
  );

  // Geometry, in wheel-size units: the sockets have to be small enough to leave
  // brass showing between them, and their halos wide enough that the lit band
  // still reads as a continuous ring of light rather than 24 separate dots.
  {
    const lampSize = Number(/--wheel-lamp-size:\s*calc\(var\(--wheel-size\)\s*\*\s*([\d.]+)\)/.exec(css)?.[1] ?? NaN);
    // Centre-to-centre gap between neighbouring lamps, in wheel-size units.
    const spacing = (2 * Math.PI * (WHEEL_FRAME.bulbRadius / 100)) / WHEEL_FRAME.bulbCount;
    const bleed = Number(/inset:\s*-([\d.]+)%/.exec(ruleBody(cssCode, '.wheel-lamp__glow'))?.[1] ?? NaN);
    const halo = 1 + (2 * bleed) / 100;

    suite.ok('the lamp size and spacing were read from the files', Number.isFinite(lampSize) && Number.isFinite(bleed), `${lampSize} · ${bleed}%`);
    suite.ok(
      'the sockets leave brass showing between them',
      lampSize < spacing,
      `socket ${lampSize} vs spacing ${spacing.toFixed(3)}`, // per wheel-size unit
    );
    suite.ok(
      'a lit lamp halos most of the way to its neighbours',
      lampSize * halo > spacing * 0.7 && lampSize * halo < spacing * 1.4,
      `halo ${(lampSize * halo).toFixed(3)} vs spacing ${spacing.toFixed(3)}`,
    );
    suite.ok(
      'and with the flare on they merge into one unbroken ring of light',
      lampSize * halo * 1.3 > spacing,
      `${(lampSize * halo * 1.3).toFixed(3)} vs ${spacing.toFixed(3)}`,
    );
  }

  /* ----------------------------------------------------------------------
     The brass knob carries no lettering
     ---------------------------------------------------------------------- */
  suite.ok(
    'the centre is a bare knob with no lettering in it',
    !stage.includes('wheel-hub__text') && !/class="wheel-hub"[^>]*>[^<]/.test(stage),
  );
  suite.ok('no SOQQA wordmark survives anywhere in the wheel chrome', !stage.includes('SOQQA'));
  suite.ok('the hub is out of the drum, so it does not spin with it', /<\/div>\s*\n\s*<!--/.test(stage) && stage.lastIndexOf('class="wheel-hub"') > stage.indexOf('</svg>'));

  /* ----------------------------------------------------------------------
     The drum is turned by the physics loop, not by CSS
     ---------------------------------------------------------------------- */
  const discRule = ruleBody(cssCode, '.wheel-disc');
  suite.ok('the drum has no transform transition', discRule.length > 0 && !/transition:/.test(discRule), discRule.replace(/\s+/g, ' ').slice(0, 90));
  suite.ok('the drum has no CSS animation either', !/animation:/.test(discRule));
  suite.ok(
    'the old easing curve is gone, since the curve is integrated frame by frame',
    !css.includes('--ease-wheel'),
  );

  /* ----------------------------------------------------------------------
     The pin's flick
     ---------------------------------------------------------------------- */
  const pointerRule = ruleBody(cssCode, '.wheel-pointer');
  const cssFlick = Number(/--wheel-pin-flick-deg:\s*([\d.]+)deg/.exec(css)?.[1] ?? NaN);
  suite.eq('the CSS flick budget matches WHEEL_SPIN.pinFlickDeg', cssFlick, WHEEL_SPIN.pinFlickDeg);
  suite.ok(
    'the pin actually spends the flick the view writes, as a rotation',
    /rotate\(\s*calc\(\s*var\(--wheel-pin-flick[^)]*\)\s*\*\s*var\(--wheel-pin-flick-deg\)/.test(pointerRule),
    pointerRule.replace(/\s+/g, ' ').slice(0, 140),
  );
  suite.ok('the pin swings about its pivot, not its centre', /transform-origin:\s*50%\s+2\d%/.test(pointerRule));
  suite.ok('the pin no longer uses a border triangle', !/border-(top|left|right):/.test(pointerRule));

  /* ----------------------------------------------------------------------
     Lighting is earned, and the chase IS the rotation
     ---------------------------------------------------------------------- */
  const glowLamp = ruleBody(cssCode, '.wheel-lamp__glow');
  suite.ok('a resting lamp is not animated', glowLamp.length > 0 && !/animation:/.test(glowLamp));
  suite.ok(
    'a resting lamp sits at a low, even glow',
    (() => {
      const resting = Number(/opacity:\s*calc\(\s*([\d.]+)/.exec(glowLamp)?.[1] ?? NaN);
      return Number.isFinite(resting) && resting > 0 && resting < 0.6;
    })(),
    (/opacity:[^;]+;/.exec(glowLamp) ?? [''])[0].trim(),
  );
  suite.ok('the lamp is a lit gradient, not a flat dot', /radial-gradient\(/.test(glowLamp));

  // The bulb is LIT BY A NUMBER the view writes, not by a stylesheet clock.
  // That is the whole point of the band: a keyframe chase has a fixed duration,
  // so it cannot follow the drum, and re-timing it every frame to try makes the
  // phase jump — the one thing a marquee must never do.
  suite.ok(
    'the halo is lit by the number the view writes, on both opacity and scale',
    /opacity:\s*calc\(\s*[\d.]+\s*\+\s*var\(--lamp-lit/.test(glowLamp) &&
      /transform:\s*scale\(calc\(\s*[\d.]+\s*\+\s*var\(--lamp-lit/.test(glowLamp),
    glowLamp.replace(/\s+/g, ' ').slice(0, 180),
  );

  const coreLamp = ruleBody(cssCode, '.wheel-lamp__core');
  suite.ok(
    'and each socket also carries a hot bulb core, lit from the same number',
    coreLamp.length > 0 &&
      /opacity:\s*calc\(var\(--lamp-lit/.test(coreLamp) &&
      /radial-gradient\(/.test(coreLamp),
    coreLamp.replace(/\s+/g, ' ').slice(0, 140),
  );

  // While the drum is merely turning, nothing may animate the ring: the chase
  // is script-driven, so a keyframe here would fight the loop and stutter. The
  // stylesheet is only allowed to promise the properties it will move.
  {
    const group = cssCode.slice(cssCode.indexOf('.wheel-stage.is-chasing .wheel-lamp'));
    const body = group.slice(0, group.indexOf('}'));
    suite.ok(
      'nothing animates the lamps while the wheel is merely spinning',
      body.length > 0 && !/animation:/.test(body),
      body.replace(/\s+/g, ' ').slice(0, 120),
    );
    suite.ok(
      'but the lamp promises the only two properties the chase moves',
      /will-change:\s*opacity,\s*transform/.test(body),
    );
  }

  /* --- the result strobe: svetomuzika, locked on ------------------------- */
  const strobeRule = groupBody(cssCode, '.wheel-stage.is-win .wheel-lamp__glow');
  suite.ok(
    'the result strobe only exists once a win is confirmed',
    /lamp-strobe/.test(strobeRule),
    strobeRule.replace(/\s+/g, ' ').slice(0, 140),
  );
  suite.ok(
    'it is a hard switch, not a fade: a strobe needs steps, not a ramp',
    // A bulb on a contactor is on or it is off. Without `steps` the keyframe
    // would interpolate and the whole ring would simply breathe.
    /animation:[^;]*steps\(1,\s*end\)/.test(strobeRule),
    (/animation:[^;]+;/.exec(strobeRule) ?? [''])[0].trim(),
  );
  suite.ok(
    'it loops forever, because a celebration has no natural end',
    /animation:[^;]*infinite/.test(strobeRule),
  );

  // The two halves. This is the effect itself: odd bulbs lit while even bulbs
  // are out, then swapped — so a ring flashing against ITSELF rather than
  // flashing together, which is what a single shared delay would give.
  {
    const oddRule = groupBody(
      cssCode,
      ".wheel-stage.is-win .wheel-lamp[data-lamp-parity='odd'] .wheel-lamp__glow",
    );
    suite.ok(
      'the two halves of the ring are put on opposite phases',
      /animation-delay:\s*calc\(\s*0ms\s*-\s*var\(--lamp-strobe[^)]*\)\s*\/\s*2\s*\)/.test(oddRule),
      oddRule.replace(/\s+/g, ' ').slice(0, 170),
    );
    suite.ok(
      'the offset is SUBTRACTED, so the ring is already mid-flash on the first\n       frame instead of starting with both halves lit',
      /^calc\(\s*0ms\s*-/.test((/animation-delay:\s*([^;]+);/.exec(oddRule)?.[1] ?? '').trim()) ||
        /calc\(\s*0ms\s*-/.test(oddRule),
      (/animation-delay:[^;]+;/.exec(oddRule) ?? [''])[0].trim(),
    );
    suite.ok(
      'and the parity selector is the attribute the view writes, not an nth-child',
      // The view appends the sockets, so it is the only thing that knows their
      // order. Keying the CSS off `:nth-child` would be a second, silently
      // drifting copy of that order — and the contract test could not select one
      // through the DOM shim to prove it had reached anything.
      cssCode.includes("[data-lamp-parity='odd']") && !/:nth-child\(/.test(cssCode),
    );
  }

  // The fallbacks in the stylesheet are only a safety net — the view writes the
  // real timings from config — but a net that has drifted from config is worse
  // than none, so they have to agree to within a millisecond.
  {
    const fallback = (name) =>
      Number(new RegExp(`var\\(--${name},\\s*([\\d.]+)ms\\)`).exec(cssCode)?.[1] ?? NaN);
    suite.ok(
      'the strobe cycle the stylesheet falls back on is the config’s',
      near(fallback('lamp-strobe'), WHEEL_FRAME.strobeMs, 0.05),
      `${fallback('lamp-strobe')} vs ${WHEEL_FRAME.strobeMs} ms`,
    );
    suite.ok(
      'and so is the quicker one the top tier runs',
      near(fallback('lamp-strobe-fast'), WHEEL_FRAME.strobeFastMs, 0.05) &&
        WHEEL_FRAME.strobeFastMs < WHEEL_FRAME.strobeMs,
      `${fallback('lamp-strobe-fast')} vs ${fallback('lamp-strobe')} ms`,
    );
  }

  // The animation budget. This is the difference between a strobe that visibly
  // blinks and one that stutters: on 24 lamps, one filter or one box-shadow on
  // the animating element re-rasterises the whole ring every frame.
  suite.ok(
    'the strobe animates opacity and transform only',
    keyframeProps(css, 'lamp-strobe')?.every((prop) => prop === 'opacity' || prop === 'transform'),
    keyframeProps(css, 'lamp-strobe')?.join(', '),
  );
  suite.ok(
    'and it has exactly the two states a square wave needs',
    (() => {
      const stops = [...keyframeBody(css, 'lamp-strobe').matchAll(/([\d.]+)%\s*{/g)].map((m) =>
        Number(m[1]),
      );
      return stops.length === 3 && stops[0] === 0 && stops[1] === 50 && stops[2] === 100;
    })(),
    [...keyframeBody(css, 'lamp-strobe').matchAll(/([\d.]+)%\s*{/g)].map((m) => m[1]).join(' / '),
  );
  suite.ok(
    'the frame\u2019s win spill animates opacity alone',
    keyframeProps(css, 'win-spill')?.every((prop) => prop === 'opacity'),
    keyframeProps(css, 'win-spill')?.join(', '),
  );

  // The two levels a bulb is actually seen at, read out of the stylesheet's own
  // interpolation so the look cannot drift from the config that drives it. A
  // resting bulb has to be plainly LIT — the ring of a powered machine is not a
  // ring of dark sockets — and the head has to stand far enough above it that
  // the travelling chase reads at a glance.
  {
    const glow = /opacity:\s*calc\(\s*([\d.]+)\s*\+\s*var\(--lamp-lit[^)]*\)\s*\*\s*([\d.]+)\s*\)/.exec(
      glowLamp,
    );
    const atRest = Number(glow?.[1] ?? NaN) + WHEEL_FRAME.idleLit * Number(glow?.[2] ?? NaN);
    const atHead = Number(glow?.[1] ?? NaN) + Number(glow?.[2] ?? NaN);

    suite.ok('the halo\u2019s response curve was read from the stylesheet', Number.isFinite(atRest), glowLamp.replace(/\s+/g, ' ').slice(0, 90));
    suite.ok(
      'a resting bulb is plainly lit, not a dark socket waiting for a spin',
      atRest > 0.3,
      `${atRest.toFixed(2)} at rest`,
    );
    suite.ok(
      'and the head is most of the way brighter again, so the chase reads',
      atHead > atRest * 1.8,
      `${atHead.toFixed(2)} under the head vs ${atRest.toFixed(2)} at rest`,
    );
  }

  // The strobe's two states. The bright one has to be a real lift on a bulb that
  // is already lit (a resting bulb's core sits near 0.4), and the dark one must
  // not be pitch black either — the bulb is switched off for half a cycle, but
  // it is still a bulb in a lit cabinet, not a hole in the ring.
  {
    const glowStops = [...keyframeBody(css, 'lamp-strobe').matchAll(/opacity:\s*([\d.]+)/g)].map(
      (match) => Number(match[1]),
    );
    const bright = Math.max(...glowStops);
    const dark = Math.min(...glowStops);
    suite.ok(
      'the strobe\u2019s bright state is a real lift on a bulb that is already lit',
      bright >= 1,
      String(bright),
    );
    suite.ok(
      'and its dark half is switched off, but still a bulb rather than a hole',
      dark > WHEEL_FRAME.idleLit && dark < 0.5,
      `${dark} vs a resting ${WHEEL_FRAME.idleLit}`,
    );
  }
  suite.ok(
    'the lamp only promises what it animates',
    /will-change:\s*opacity,\s*transform/.test(strobeRule) &&
      /will-change:\s*opacity,\s*transform/.test(
        cssCode.slice(cssCode.indexOf('.wheel-stage.is-win .wheel-lamp__glow')),
      ),
    strobeRule.replace(/\s+/g, ' ').slice(0, 120),
  );
  suite.ok(
    'the animated halo carries no filter',
    !ruleProps(cssCode, '.wheel-lamp__glow').includes('filter'),
    ruleProps(cssCode, '.wheel-lamp__glow').join(', '),
  );
  suite.ok(
    'the animated halo carries no box-shadow either',
    !ruleProps(cssCode, '.wheel-lamp__glow').includes('box-shadow'),
    ruleProps(cssCode, '.wheel-lamp__glow').join(', '),
  );
  suite.ok(
    'nothing in the lamp subtree is filtered',
    ['.wheel-lamps', '.wheel-lamp', '.wheel-lamp__glow', '.wheel-lamp__core'].every(
      (selector) => !ruleProps(cssCode, selector).includes('filter'),
    ),
  );
  suite.ok(
    'the socket never moves, so only the layers inside it change per frame',
    !/animation:/.test(ruleBody(cssCode, '.wheel-lamp')) &&
      /transform:\s*translate\(-50%,\s*-50%\)/.test(ruleBody(cssCode, '.wheel-lamp')),
  );
  suite.ok(
    'a significant win strokes the whole ring, core and halo together',
    /\.wheel-stage\.is-win\s+\.wheel-lamp__glow,\s*\n?\.wheel-stage\.is-win\s+\.wheel-lamp__core\s*{[^}]*lamp-strobe/.test(
      cssCode,
    ),
  );
  suite.ok(
    'and the top tier steps the strobe up a gear, on both halves',
    /\.wheel-stage\.is-jackpot\s+\.wheel-lamp__glow,\s*\n?\.wheel-stage\.is-jackpot\s+\.wheel-lamp__core\s*{[^}]*animation-duration:\s*var\(--lamp-strobe-fast/.test(
      cssCode,
    ) && /is-jackpot[^,]*\[data-lamp-parity='odd'\]/.test(cssCode),
  );
  suite.ok(
    'a paying stop throws gold onto the frame around the drum',
    /\.wheel-stage\.is-win::after\s*{[^}]*opacity:\s*1/.test(cssCode) &&
      /\.wheel-stage::after\s*{[^}]*box-shadow:/.test(cssCode),
  );

  const wedgeGlow = ruleBody(cssCode, '.wheel-wedge-glow');
  suite.ok('the winning wedge is dark at rest', /opacity:\s*0\b/.test(wedgeGlow));
  suite.ok(
    'the winning wedge is a lit sector aimed by the angle the view writes',
    /conic-gradient\(/.test(wedgeGlow) && /var\(--win-angle/.test(wedgeGlow),
  );
  suite.ok(
    'the lit wedge pulsing is its own state, and it has keyframes',
    /\.wheel-wedge-glow\.is-visible\s*{[^}]*wedge-pulse/.test(cssCode) && css.includes('@keyframes wedge-pulse'),
  );
  suite.ok(
    'the top tier still lights the drum',
    /\.wheel-disc\.is-win\s*{/.test(cssCode) && /\.wheel-stage\.is-win\s+\.wheel-lamp__glow\s*{/.test(cssCode),
  );

  /* ----------------------------------------------------------------------
     Reduced motion
     ---------------------------------------------------------------------- */
  const reducedStart = css.indexOf('@media (prefers-reduced-motion: reduce)');
  const reduced = reducedStart === -1 ? '' : css.slice(reducedStart);
  suite.ok(
    'reduced motion stops the result chase, the flare and the wedge pulse',
    /\.wheel-stage\.is-win\s+\.wheel-lamp__glow/.test(reduced) &&
      /\.wheel-stage\.is-win\s+\.wheel-lamp__core/.test(reduced) &&
      /\.wheel-wedge-glow\.is-visible/.test(reduced),
  );
  suite.ok(
    'the spin\u2019s own chase needs no entry there — it is script-driven, and the reduced-motion spin is one short hop',
    WHEEL_SPIN.reducedMotionDurationMs > 0 && WHEEL_SPIN.reducedMotionDurationMs < 500,
    `${WHEEL_SPIN.reducedMotionDurationMs} ms`,
  );

  /* ----------------------------------------------------------------------
     The face itself, straight out of the builder
     ---------------------------------------------------------------------- */
  const face = buildWheelFace();
  suite.ok('the face is an SVG using the shared artboard', face.startsWith(`<svg class="wheel-face" viewBox="0 0 ${FACE_VIEWBOX} ${FACE_VIEWBOX}"`));
  suite.ok('the face is hidden from assistive tech', face.includes('aria-hidden="true"'));
  suite.ok('the face has no lettering — the multipliers are DOM labels', !/<text\b/.test(face));
  suite.ok('the face uses no SVG filters', !/<filter\b/.test(face));
  suite.eq(
    'the face is built fresh from the segment table, deterministically',
    buildWheelFace(),
    face,
  );

  /* --- the markup is well formed ---------------------------------------- */
  // The face is assembled from strings, so an unclosed tag is one string
  // concatenation away — and in a browser a stray `<g>` swallows whatever is
  // parsed after it. Verified by nesting, which is the part that actually
  // breaks: every open tag has to be closed by its own close tag, in order.
  {
    const VOID = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polygon', 'polyline', 'stop', 'use']);
    const stack = [];
    const bad = [];
    for (const [, closing, tag, selfClosing] of face.matchAll(/<(\/?)([A-Za-z][\w:-]*)\b[^>]*?(\/?)>/g)) {
      if (closing) {
        if (stack.pop() !== tag) bad.push(`</${tag}> closes the wrong element`);
      } else if (!selfClosing && !VOID.has(tag)) {
        stack.push(tag);
      }
    }
    suite.ok('the face nests to exactly one root', stack.length === 0 && bad.length === 0, [...bad, ...stack].join(', '));
    suite.ok(
      'it declares the namespaces a browser needs for an inline SVG',
      face.startsWith('<svg class="wheel-face"') && !face.includes('undefined') && !face.includes('NaN'),
    );
    suite.ok(
      'no coordinate came out undefined or NaN',
      !/(cx|cy|r|d|x1|y1|x2|y2)="[^"]*(undefined|NaN)/.test(face),
    );
  }

  const wedges = [...face.matchAll(/<path class="wheel-wedge" data-wedge="(\d+)" d="([^"]+)" fill="url\(#([^)]+)\)"/g)];
  suite.eq('one wedge per segment', wedges.length, WHEEL_SEGMENTS.length);
  suite.eq(
    'the wedges are drawn in table order',
    wedges.map(([, index]) => Number(index)),
    WHEEL_SEGMENTS.map((_, index) => index),
  );

  /* --- geometry: apex on the hub, arc exactly on the rim ---------------- */
  {
    const bad = [];
    wedges.forEach(([, index, d, gradient]) => {
      const parsed = /^M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+) A ([\d.]+) ([\d.]+) 0 ([01]) 1 ([\d.-]+) ([\d.-]+) Z$/.exec(d);
      if (!parsed) {
        bad.push(`${index}: unreadable path`);
        return;
      }
      const [, ax, ay, x1, y1, rx, , large, x2, y2] = parsed;
      const i = Number(index);
      if (!near(Number(ax), 50) || !near(Number(ay), 50)) bad.push(`${index}: apex ${ax},${ay}`);
      if (!near(Number(rx), FACE_VIEWBOX / 2)) bad.push(`${index}: arc radius ${rx}`);
      if (Number(large) !== 0) bad.push(`${index}: arc spans more than a half turn`);
      [x1, y1, x2, y2].forEach((value) => {
        if (Number(value) < 0 || Number(value) > FACE_VIEWBOX) bad.push(`${index}: ${value} off the artboard`);
      });
      if (!near(Math.hypot(Number(x1) - 50, Number(y1) - 50), FACE_VIEWBOX / 2, 0.02)) {
        bad.push(`${index}: start not on the rim`);
      }
      if (!near(Math.hypot(Number(x2) - 50, Number(y2) - 50), FACE_VIEWBOX / 2, 0.02)) {
        bad.push(`${index}: end not on the rim`);
      }
      // The wedge spans exactly one segment, centred on its own angle.
      const angleOf = (x, y) => ((Math.atan2(Number(x) - 50, -(Number(y) - 50)) * 180) / Math.PI + 360) % 360;
      const span = angularDelta(angleOf(x2, y2), angleOf(x1, y1));
      if (!near(span, SEGMENT_ANGLE, 0.02)) bad.push(`${index}: spans ${span.toFixed(2)}°`);
      if (Math.abs(angularDelta(angleOf(x1, y1) + SEGMENT_ANGLE / 2, i * SEGMENT_ANGLE)) > 0.02) {
        bad.push(`${index}: centred on ${angleOf(x1, y1).toFixed(2)}°`);
      }
      if (gradient !== `sqWheelRamp${i}`) bad.push(`${index}: fill ${gradient}`);
    });
    suite.ok('every wedge is a clean sector: apex on the hub, arc on the rim', bad.length === 0, bad.slice(0, 4).join('; '));
    suite.ok(
      'the shared path builder closes the sector',
      /^M 50 50 L .+ A 50 50 0 0 1 .+ Z$/.test(wedgePath(3)),
      wedgePath(3),
    );
  }

  /* --- the alternating ruby / gold-black palette ------------------------ */
  {
    const ramps = wedges.map(([, , , gradient]) => gradient);
    const ruby = ramps.filter((_, index) => index % 2 === 0);
    const gold = ramps.filter((_, index) => index % 2 === 1);
    suite.eq('the ramps alternate strictly', ruby.length + gold.length, WHEEL_SEGMENTS.length);
    suite.ok('every even wedge takes the ruby ramp', ruby.every((id) => id.startsWith('sqWheelRamp')) && new Set(ruby).size === ruby.length);
    suite.ok('every odd wedge takes the gold ramp', gold.every((id) => id.startsWith('sqWheelRamp')) && new Set(gold).size === gold.length);
    suite.ok(
      'the ruby and gold ramps are different artwork',
      JSON.stringify(wedgeRamp(0)) !== JSON.stringify(wedgeRamp(1)),
      `${wedgeRamp(0)[1]} vs ${wedgeRamp(1)[1]}`,
    );
    suite.eq('the ramp depends only on the wedge index', wedgeRamp(6), wedgeRamp(0));
    suite.eq('the ramp is even/odd, never in-between', wedgeRamp(7), wedgeRamp(1));

    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const luminance = (hex) => {
      const [r, g, b] = rgb(hex);
      return 0.3 * r + 0.59 * g + 0.11 * b;
    };
    /** Channel spread. The honest measure of how METALLIC a stop is: luminance
        says how light it is, chroma says how much colour is in it, and a metal
        that has lost its chroma is a grey-brown regardless of its brightness. */
    const chroma = (hex) => {
      const channels = rgb(hex);
      return Math.max(...channels) - Math.min(...channels);
    };
    const distance = (a, b) => rgb(a).reduce((sum, value, i) => sum + Math.abs(value - rgb(b)[i]), 0);

    const rubyStops = wedgeRamp(0);
    const goldStops = wedgeRamp(1);
    suite.eq(
      'every ramp is a six-stop metal recipe',
      [rubyStops.length, goldStops.length],
      [6, 6],
    );
    suite.eq(
      'the ramps share the band offsets',
      WEDGE_RAMP_OFFSETS.length,
      rubyStops.length,
    );

    const [r, g, b] = rgb(rubyStops[4]);
    suite.ok('the ruby ramp really is red', r > 150 && r > g * 2 && r > b * 2, rubyStops[4]);
    const [gr, gg, gb] = rgb(goldStops[5]);
    suite.ok('the gold ramp is warm and bright at the rim', gr > 230 && gg > 190 && gb < gg, goldStops[5]);

    // The break is what makes it read as metal: the ramp has to dip back down
    // into shadow mid-way before it climbs to the rim.
    [rubyStops, goldStops].forEach((ramp, which) => {
      const name = which === 0 ? 'ruby' : 'gold';
      suite.ok(
        `the ${name} ramp breaks back into shadow before it lights up`,
        luminance(ramp[3]) < luminance(ramp[2]) && luminance(ramp[3]) < luminance(ramp[4]),
        `${ramp[2]} \u2192 ${ramp[3]} \u2192 ${ramp[4]}`,
      );
      suite.ok(
        `the ${name} ramp climbs out to the rim, band by band`,
        luminance(ramp[2]) > luminance(ramp[1]) && luminance(ramp[5]) > luminance(ramp[4]),
      );
    });

    // The first band is inside the knob, so the contract only has to hold from
    // the second stop out — but it has to hold all the way out.
    const visible = WEDGE_RAMP_OFFSETS.map((offset, index) => ({ offset, index })).filter(
      ({ offset }) => offset >= WEDGE_RAMP_OFFSETS[1],
    );
    const contrast = visible.map(({ index }) => distance(rubyStops[index], goldStops[index]));
    suite.ok(
      'the two ramps stay clearly apart at every band the player can see',
      contrast.length === 5 && contrast.every((value) => value > 75),
      contrast.join(', '),
    );
    suite.ok(
      'and they separate in brightness, not only in hue, over most of the wheel',
      visible.filter(({ index }) => Math.abs(luminance(rubyStops[index]) - luminance(goldStops[index])) > 60)
        .length >= 3,
      visible
        .map(({ index }) => `${index}:${Math.abs(luminance(rubyStops[index]) - luminance(goldStops[index])).toFixed(0)}`)
        .join(' '),
    );

    // The hidden base band is deliberately dark; the knob has to be big enough
    // to cover it, and the first visible band has to clear the knob.
    const hubPct = Number(/width:\s*([\d.]+)%/.exec(ruleBody(cssCode, '.wheel-hub'))?.[1] ?? NaN);
    suite.ok('the hub width was read from the stylesheet', Number.isFinite(hubPct) && hubPct > 20, String(hubPct));
    suite.ok(
      'the knob covers the hidden base band of both ramps',
      WEDGE_RAMP_OFFSETS[0] * 50 < hubPct / 2 + 0.01,
      `first band at ${(WEDGE_RAMP_OFFSETS[0] * 50).toFixed(1)} vs knob radius ${(hubPct / 2).toFixed(1)}`,
    );
    suite.ok(
      'and the first visible band starts outside it',
      WEDGE_RAMP_OFFSETS[1] * 50 >= hubPct / 2,
      `first visible band at ${(WEDGE_RAMP_OFFSETS[1] * 50).toFixed(1)} vs knob radius ${(hubPct / 2).toFixed(1)}`,
    );

    /* --- deep bases, but RICH lit bands -----------------------------------
       The earlier pass bought its depth the wrong way: it sank the bases (right)
       and then muted the lit bands too (wrong), leaving a bronze body stop at a
       channel spread of 146 and a dull red at 155. The drum's average pixel was
       dark mud and the machine read flat however good its geometry was, because
       luminance was never the thing that separates a metal from a painted
       surface — CHROMA is.

       So the contract is now the one that matches what the eye actually checks:
       the bases stay sunk (floors below), and every LIT band has to carry real
       chroma and climb clear of its own base. Both directions are assertable,
       which is what makes this a contract rather than a preference.
       -------------------------------------------------------------------- */
    const rimBand = (ramp) => luminance(ramp[5]);
    suite.ok(
      'the base bands are sunk into real shadow, not merely tinted',
      luminance(rubyStops[0]) <= 18 && luminance(goldStops[0]) <= 22,
      `ruby ${luminance(rubyStops[0]).toFixed(0)} (was 20) · gold ${luminance(goldStops[0]).toFixed(0)} (was 27)`,
    );
    suite.ok(
      'the lit body bands are RICH, not a lacquer and a bronze',
      chroma(rubyStops[2]) >= 150 && chroma(goldStops[2]) >= 175,
      `ruby chroma ${chroma(rubyStops[2])} · gold chroma ${chroma(goldStops[2])}`,
    );
    suite.ok(
      'and each lit band climbs clear of its own base, so the bevel has depth',
      luminance(rubyStops[2]) - luminance(rubyStops[0]) >= 45 &&
        luminance(goldStops[2]) - luminance(goldStops[0]) >= 120,
      `ruby +${(luminance(rubyStops[2]) - luminance(rubyStops[0])).toFixed(0)} · ` +
        `gold +${(luminance(goldStops[2]) - luminance(goldStops[0])).toFixed(0)}`,
    );
    suite.ok(
      'the hot rim is still the one bright note on each slice',
      rimBand(rubyStops) >= 130 && rimBand(goldStops) >= 230,
      `ruby ${rimBand(rubyStops).toFixed(0)} · gold ${rimBand(goldStops).toFixed(0)}`,
    );
  }

  /* ----------------------------------------------------------------------
     The surface layers: a lip, a throat and the room's reflection
     ----------------------------------------------------------------------
     Colour alone does not give a slice a surface. Each wedge therefore carries a
     polished lip arc just inside the rim — the edge the frame's light catches —
     the whole inlay sits in a dark throat where it runs under the knob, and one
     diagonal sheen lies over the lot. All three are light rather than artwork:
     inert, and built from gradients, with no SVG filter anywhere.
     ---------------------------------------------------------------------- */
  {
    suite.ok(
      'the rings the surface layers are cut at are published',
      WHEEL_FACE_RINGS.lipRadius > 44 && WHEEL_FACE_RINGS.lipRadius < FACE_VIEWBOX / 2,
      `lip at ${WHEEL_FACE_RINGS.lipRadius} (pegs at 44, rim at ${FACE_VIEWBOX / 2})`,
    );

    const lips = [...face.matchAll(/<path class="wheel-face__lip" d="M ([\d.-]+) ([\d.-]+) A ([\d.]+) ([\d.]+) 0 0 1 ([\d.-]+) ([\d.-]+)"/g)];
    suite.eq('one polished lip per slice', lips.length, WHEEL_SEGMENTS.length);
    {
      const bad = [];
      lips.forEach(([, x1, y1, , , x2, y2], index) => {
        const radius = (x, y) => Math.hypot(Number(x) - 50, Number(y) - 50);
        if (!near(radius(x1, y1), WHEEL_FACE_RINGS.lipRadius, 0.05)) bad.push(`${index}: starts at ${radius(x1, y1).toFixed(2)}`);
        if (!near(radius(x2, y2), WHEEL_FACE_RINGS.lipRadius, 0.05)) bad.push(`${index}: ends at ${radius(x2, y2).toFixed(2)}`);
        const angleOf = (x, y) => ((Math.atan2(Number(x) - 50, -(Number(y) - 50)) * 180) / Math.PI + 360) % 360;
        // Inset at both ends, so two neighbouring lips can never meet at a seam
        // and read as one continuous ring of outline.
        const span = angularDelta(angleOf(x2, y2), angleOf(x1, y1));
        if (!near(span, SEGMENT_ANGLE - 2 * WHEEL_FACE_RINGS.lipInsetDeg, 0.05)) {
          bad.push(`${index}: spans ${span.toFixed(2)}°`);
        }
        if (Math.abs(angularDelta(angleOf(x1, y1) + span / 2, index * SEGMENT_ANGLE)) > 0.05) {
          bad.push(`${index}: centred on ${angleOf(x1, y1).toFixed(2)}°`);
        }
      });
      suite.ok(
        'every lip is an arc on its own slice, centred and inset from both seams',
        bad.length === 0,
        bad.slice(0, 4).join('; '),
      );
    }

    suite.ok(
      'the slices run under the knob into a dark throat',
      /<circle class="wheel-face__throat"[^>]*r="[\d.]+"[^>]*fill="url\(#sqWheelThroat\)"\/>/.test(face) &&
        WHEEL_FACE_RINGS.throatRadius < WEDGE_RAMP_OFFSETS[1] * 50,
      `throat at ${WHEEL_FACE_RINGS.throatRadius}`,
    );
    suite.ok(
      'the room’s reflection lies across the drum at an angle',
      /<circle class="wheel-face__sheen"[^>]*fill="url\(#sqWheelSheen\)"\/>/.test(face) &&
        /id="sqWheelSheen"[^>]*gradientTransform="rotate\(/.test(face),
      (/id="sqWheelSheen"[^>]*gradientTransform="rotate\(([^)]+)\)"/.exec(face) ?? [''])[1] ?? 'no rotation',
    );
    suite.ok(
      'the reflection is a light, not a wash: no stop above a tenth',
      [...(face.match(/id="sqWheelSheen"[\s\S]*?<\/linearGradient>/)?.[0] ?? '').matchAll(/stop-opacity="([\d.]+)"/g)].every(
        (match) => Number(match[1]) <= 0.1,
      ),
    );
    suite.ok(
      'the surface layers never borrow the wedge or peg class',
      !/class="wheel-wedge[" ]/.test(lips.map((match) => match[0]).join('')) &&
        !/class="wheel-peg"/.test(face.match(/<g class="wheel-face__lips">[\s\S]*?<\/g>/)?.[0] ?? ''),
    );
    suite.ok(
      'and all three are inert in the stylesheet',
      /\.wheel-face__lips,[\s\S]*?\.wheel-face__throat,[\s\S]*?\.wheel-face__sheen,[\s\S]*?\{[^}]*pointer-events:\s*none/.test(cssCode),
      ruleProps(cssCode, '.wheel-face__lip').join(', ') || 'no .wheel-face__lip rule',
    );
  }

  /* --- pegs, references, bounds ----------------------------------------- */
  {
    const pegs = [...face.matchAll(/<circle class="wheel-peg" cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"/g)];
    suite.eq('one peg per seam', pegs.length, WHEEL_SEGMENTS.length);
    suite.ok(
      'every peg sits on the seam between two wedges',
      pegs.every(([, cx, cy]) => {
        const angle = ((Math.atan2(Number(cx) - 50, -(Number(cy) - 50)) * 180) / Math.PI + 360) % 360;
        return near((angle - SEGMENT_ANGLE / 2) % SEGMENT_ANGLE, 0, 0.02) || near((angle - SEGMENT_ANGLE / 2) % SEGMENT_ANGLE, SEGMENT_ANGLE, 0.02);
      }),
    );
    suite.ok(
      'the pegs sit inside the rim, so the pin can flick them',
      pegs.every(([, cx, cy]) => {
        const radius = Math.hypot(Number(cx) - 50, Number(cy) - 50);
        return radius > 40 && radius < FACE_VIEWBOX / 2;
      }),
    );

    const ids = [...face.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    suite.ok('every face id is unique', new Set(ids).size === ids.length, `${ids.length} ids`);
    const refs = [...face.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]);
    suite.ok(
      'every fill resolves to a gradient the face declares',
      refs.length > 0 && refs.every((id) => ids.includes(id)),
      refs.filter((id) => !ids.includes(id)).join(', '),
    );

    // polarPoint is the shared geometry helper — a wrong convention here would
    // put every wedge and peg in the wrong place at once.
    suite.eq('0° is 12 o\u2019clock', polarPoint(0, 40), [50, 10]);
    suite.eq('90° is 3 o\u2019clock', polarPoint(90, 40), [90, 50]);
    suite.eq('180° is 6 o\u2019clock', polarPoint(180, 40), [50, 90]);
    suite.eq('270° is 9 o\u2019clock', polarPoint(270, 40), [10, 50]);
  }

  const measured = wedges.map(([, index, d]) => {
    const numbers = d.match(/-?[\d.]+/g) ?? [];
    const [x1, y1] = [Number(numbers[2]), Number(numbers[3])];
    const [x2, y2] = [Number(numbers[7]), Number(numbers[8])];
    return `${index}:${Math.hypot(x2 - x1, y2 - y1).toFixed(1)}`;
  });
  suite.note(
    `${WHEEL_SEGMENTS.length} wedges · ${lamps.length} rim lamps on a ${WHEEL_FRAME.bulbRadius} ring · band sweep ${WHEEL_FRAME.sweepArcDeg}° ×${WHEEL_FRAME.chaseGain} (cap ${WHEEL_FRAME.chaseMaxRevPerSec} rev/s, ${WHEEL_FRAME.litLevels} steps) · chord ${measured.slice(0, 3).join(' ')}…`,
  );
}

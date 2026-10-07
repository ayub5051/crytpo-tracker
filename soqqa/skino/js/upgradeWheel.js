/* ============================================================================
   BLAZZER — Upgrade disc
   A canvas wheel with exactly two wedges, sized to the odds: the WIN wedge
   spans `chance` of the disc, the LOSE wedge the remainder. It is drawn in the
   same visual language as the Wheel mini-game (js/wheel.js) — same rim, hub,
   billboarded labels and quartic ease-out spin — but its geometry is
   proportionate rather than equal-sliced, which is the whole point: what you
   see is literally your chance as a slice of the circle.

   The outcome is never decided here. js/upgrade.js settles the bet through the
   provably-fair pipeline first and then hands this module the wedge to land on,
   so the animation can never be the source of truth.
   ========================================================================= */

const TAU = Math.PI * 2;
const SIZE = 520; // internal canvas resolution; CSS scales it down

const WIN_START = '#1d5f6b';
const WIN_END = '#5ed2e2';
const LOSE_FILL = '#15161b';

let canvas = null;
let ctx = null;
let rotation = -0.18;
let spinning = false;
let chance = 0.5;

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* --------------------------------------------------------------- geometry */

/**
 * The rotation that puts the TOP POINTER inside a wedge.
 *
 * Wedge 0 (win) occupies `[0, chance)` of the circle in wheel-local space;
 * wedge 1 (lose) occupies `[chance, 1)`. The pointer sits at -π/2 in screen
 * space, so wheel-local angle `a` needs a rotation of `-π/2 - a`.
 *
 * @param {0|1} wedge  which wedge to land on
 * @param {number} fromRotation current rotation
 * @param {number} from  lower edge of the wedge, as a fraction of the circle
 * @param {number} span  width of the wedge, as a fraction of the circle
 */
export function rotationFor(wedge, fromRotation, from, span) {
  // Land anywhere in the wedge's inner 70%, so the result never looks like a
  // razor-thin near-miss against one of the boundary lines.
  const lo = from + span * 0.15;
  const hi = from + span * 0.85;
  const point = lo + Math.random() * (hi - lo);
  const base = -Math.PI / 2 - point * TAU;
  const turns = 5 + Math.floor(Math.random() * 2);
  let delta = base - fromRotation;
  delta = ((delta % TAU) + TAU) % TAU;
  return fromRotation + turns * TAU + delta;
}

/** Which wedge the pointer is currently over, for a given rotation. */
export function wedgeAt(currentRotation, currentChance) {
  const rel = ((-Math.PI / 2 - currentRotation) % TAU + TAU) % TAU;
  return rel / TAU < currentChance ? 0 : 1;
}

/* ------------------------------------------------------------------- draw */

function draw() {
  if (!ctx) return;
  const r = SIZE / 2;
  const winArc = Math.max(0.001, chance) * TAU;

  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.save();
  ctx.translate(r, r);

  // Outer rim
  ctx.beginPath();
  ctx.arc(0, 0, r - 4, 0, TAU);
  ctx.fillStyle = '#0d0e11';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.rotate(rotation);

  // Wedge 0 — the win band. A radial gradient makes it read as lit from the
  // hub outward, so the odds slice glows rather than sits flat.
  const grad = ctx.createRadialGradient(0, 0, 40, 0, 0, r - 14);
  grad.addColorStop(0, WIN_START);
  grad.addColorStop(1, WIN_END);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r - 14, 0, winArc);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Wedge 1 — the losing remainder.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r - 14, winArc, TAU);
  ctx.closePath();
  ctx.fillStyle = LOSE_FILL;
  ctx.fill();

  // Wedge separators, drawn after both fills so the boundary stays crisp
  // however small the win slice becomes.
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1.5;
  [0, winArc].forEach((angle) => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * (r - 14), Math.sin(angle) * (r - 14));
    ctx.stroke();
  });

  ctx.restore();

  // Billboarded labels — positioned on each wedge's bisector but drawn
  // screen-upright, so neither can ever read upside-down or mirrored.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelRadius = r * 0.66;
  drawLabel('WIN', (winArc / 2 + rotation), labelRadius, '#041417', true);
  drawLabel('LOSE', (winArc + (TAU - winArc) / 2 + rotation), labelRadius, '#6b6e77', false);

  // Hub
  ctx.beginPath();
  ctx.arc(0, 0, 40, 0, TAU);
  ctx.fillStyle = '#0a0a0c';
  ctx.fill();
  ctx.strokeStyle = 'rgba(94,210,226,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, TAU);
  ctx.fillStyle = '#5ed2e2';
  ctx.fill();

  ctx.restore();
}

function drawLabel(text, angle, radius, color, bold) {
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;
  ctx.fillStyle = color;
  ctx.font = `${bold ? 800 : 600} 16px Inter, sans-serif`;
  ctx.fillText(text, x, y, radius * 0.9);
}

/* ------------------------------------------------------------------- spin */

function animateTo(target, done) {
  const start = rotation;
  const duration = reducedMotion ? 400 : 3600;
  const t0 = performance.now();

  function frame(now) {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 4); // quart ease-out, as js/wheel.js
    rotation = start + (target - start) * eased;
    draw();
    if (p < 1) {
      requestAnimationFrame(frame);
    } else {
      rotation %= TAU;
      draw();
      done();
    }
  }

  requestAnimationFrame(frame);
}

/**
 * Spin to a settled result and resolve when the disc stops.
 *
 * @param {{ win: boolean, chance: number, origin?: Element|null }} result
 * @returns {Promise<void>}
 */
export function spinTo({ win, chance: nextChance, origin = null }) {
  chance = Math.min(0.95, Math.max(0.02, Number(nextChance) || 0.02));
  if (!ctx) return Promise.resolve();

  return new Promise((resolve) => {
    spinning = true;
    const from = win ? 0 : chance;
    const span = win ? chance : 1 - chance;
    const target = rotationFor(win ? 0 : 1, rotation, from, span);
    animateTo(target, () => {
      spinning = false;
      pulse(origin);
      resolve();
    });
  });
}

/** A short scale pulse on the stage the instant the disc stops. */
function pulse(origin) {
  if (reducedMotion) return;
  const stage = origin || document.querySelector('[data-upgrade-stage]');
  if (!stage) return;
  stage.classList.remove('is-win-pulse');
  void stage.offsetWidth; // replay on back-to-back spins
  stage.classList.add('is-win-pulse');
  window.setTimeout(() => stage.classList.remove('is-win-pulse'), 460);
}

export function isSpinning() {
  return spinning;
}

/** Lend the disc its canvas and paint the resting frame. */
export function mountUpgradeWheel() {
  canvas = document.querySelector('[data-upgrade-canvas]');
  if (!canvas) return null;
  canvas.width = SIZE;
  canvas.height = SIZE;
  ctx = canvas.getContext('2d');
  draw();
  return canvas;
}

/** Repaint after the odds change (a new stake or target was picked). */
export function setUpgradeChance(nextChance) {
  chance = Math.min(0.95, Math.max(0.02, Number(nextChance) || 0.02));
  draw();
}

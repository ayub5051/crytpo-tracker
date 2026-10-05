/* ============================================================================
   SKINO — Wheel mini-game
   A canvas prize wheel. Each spin costs Crystals and pays out Crystals or a
   skin. Outcomes are weighted so the wheel stays roughly break-even (~97%
   return) — generous but not a free-money printer.
   ========================================================================= */

import { getSkinById } from './skins.js';
import { spendCrystals, addCrystals, getCrystals, formatCrystals } from './crystals.js';
import { addToInventory } from './inventory.js';
import { record } from './ledger.js';
import { showToast } from './toast.js';

export const SPIN_COST = 100;

/* Segment weights sum to ~21.93. Crystal payouts average ~83 and skin prizes
   add ~13 of expected value, giving ~96.6 Crystals back per 100 spent. */
export const SEGMENTS = [
  { label: 'No win', kind: 'none', value: 0, weight: 4, color: '#141519' },
  { label: '+25', kind: 'crystals', value: 25, weight: 4, color: '#1a1c22' },
  { label: '+50', kind: 'crystals', value: 50, weight: 4, color: '#141519' },
  { label: '+75', kind: 'crystals', value: 75, weight: 3, color: '#1a1c22' },
  { label: '+100', kind: 'crystals', value: 100, weight: 3, color: '#141519' },
  { label: '+150', kind: 'crystals', value: 150, weight: 2, color: '#1a1c22' },
  { label: '+250', kind: 'crystals', value: 250, weight: 1, color: '#141519' },
  { label: '+500', kind: 'crystals', value: 500, weight: 0.5, color: '#1a1c22' },
  { label: '+1000', kind: 'crystals', value: 1000, weight: 0.2, color: '#12262b', accent: true },
  { label: 'AK Slate', kind: 'skin', skinId: 'ak-47-slate', weight: 0.15, color: '#141519' },
  { label: 'Deagle Blaze', kind: 'skin', skinId: 'desert-eagle-blaze', weight: 0.06, color: '#1a1c22' },
  { label: 'AWP Asiimov', kind: 'skin', skinId: 'awp-asiimov', weight: 0.02, color: '#12262b', accent: true },
];

const TAU = Math.PI * 2;
const SIZE = 640; // internal canvas resolution; CSS scales it down

let canvas = null;
let ctx = null;
let rotation = -0.12;
let spinning = false;
let spinButton = null;
let resultEl = null;

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Weighted-random segment index. Exported so the odds can be audited. */
export function pickWeighted(random = Math.random) {
  const total = SEGMENTS.reduce((sum, seg) => sum + seg.weight, 0);
  let roll = random() * total;
  for (let i = 0; i < SEGMENTS.length; i += 1) {
    roll -= SEGMENTS[i].weight;
    if (roll <= 0) return i;
  }
  return SEGMENTS.length - 1;
}

/** Which segment sits under the top pointer at a given wheel rotation. */
export function segmentAt(rotation) {
  const slice = TAU / SEGMENTS.length;
  const rel = (((-Math.PI / 2 - rotation) % TAU) + TAU) % TAU;
  return Math.floor(rel / slice) % SEGMENTS.length;
}

/**
 * Rotation that brings the centre of segment `index` under the top pointer,
 * landing after several full turns from `fromRotation`.
 */
export function targetRotation(index, fromRotation, jitter) {
  const slice = TAU / SEGMENTS.length;
  const offset = jitter ?? (Math.random() - 0.5) * slice * 0.7;
  const base = -Math.PI / 2 - (index + 0.5) * slice + offset;
  const turns = 5 + Math.floor(Math.random() * 2);
  let delta = base - fromRotation;
  delta = ((delta % TAU) + TAU) % TAU;
  return fromRotation + turns * TAU + delta;
}

function draw() {
  if (!ctx) return;
  const r = SIZE / 2;
  const slice = TAU / SEGMENTS.length;

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

  SEGMENTS.forEach((seg, i) => {
    const start = i * slice;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r - 14, start, start + slice);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  ctx.restore();

  // Labels orbit with the wheel but stay upright so they read at any rotation.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  SEGMENTS.forEach((seg, i) => {
    const world = i * slice + slice / 2 + rotation;
    ctx.save();
    ctx.translate(Math.cos(world) * r * 0.66, Math.sin(world) * r * 0.66);
    ctx.fillStyle = seg.accent ? '#5ed2e2' : '#a2a5ad';
    ctx.font = `600 ${seg.label.length > 8 ? 21 : 26}px Inter, sans-serif`;
    ctx.fillText(seg.label, 0, 0);
    ctx.restore();
  });

  // Hub
  ctx.beginPath();
  ctx.arc(0, 0, 46, 0, TAU);
  ctx.fillStyle = '#0a0a0c';
  ctx.fill();
  ctx.strokeStyle = 'rgba(94,210,226,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, TAU);
  ctx.fillStyle = '#5ed2e2';
  ctx.fill();

  ctx.restore();
}

function animateTo(target, done) {
  const start = rotation;
  const duration = reducedMotion ? 500 : 4200;
  const t0 = performance.now();

  function frame(now) {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 4);
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

function setResult(text, variant = '') {
  if (!resultEl) return;
  resultEl.textContent = text;
  resultEl.dataset.state = variant;
}

function award(seg) {
  if (seg.kind === 'crystals') {
    addCrystals(seg.value);
    record({ type: 'wheel', label: 'Wheel win', amount: seg.value });
    setResult(`Won ${formatCrystals(seg.value)} Crystals`, 'win');
    showToast(`+${formatCrystals(seg.value)} Crystals from the Wheel`, 'success');
  } else if (seg.kind === 'skin') {
    const skin = getSkinById(seg.skinId);
    addToInventory(seg.skinId);
    record({
      type: 'wheel',
      label: `Wheel win: ${skin.weapon} | ${skin.finish}`,
      amount: 0,
      skinId: seg.skinId,
    });
    setResult(`Won ${skin.weapon} | ${skin.finish}`, 'win');
    showToast(`Wheel win: ${skin.weapon} | ${skin.finish}!`, 'success');
  } else {
    setResult('No win this time — spin again', 'lose');
  }
}

function spin() {
  if (spinning) return;
  if (!spendCrystals(SPIN_COST)) {
    showToast('Not enough Crystals to spin', 'error');
    return;
  }

  spinning = true;
  if (spinButton) spinButton.disabled = true;
  setResult('Spinning…', 'spin');
  record({ type: 'wheel', label: 'Wheel spin', amount: -SPIN_COST });

  const index = pickWeighted();
  const segment = SEGMENTS[index];

  animateTo(targetRotation(index, rotation), () => {
    spinning = false;
    if (spinButton) spinButton.disabled = false;
    award(segment);
  });
}

export function initWheel() {
  canvas = document.querySelector('[data-wheel-canvas]');
  if (!canvas) return;

  canvas.width = SIZE;
  canvas.height = SIZE;
  ctx = canvas.getContext('2d');
  spinButton = document.querySelector('[data-wheel-spin]');
  resultEl = document.querySelector('[data-wheel-result]');

  draw();

  spinButton?.addEventListener('click', spin);
}

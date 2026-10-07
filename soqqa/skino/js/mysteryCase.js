/* ============================================================================
   BLAZZER — Mystery Case mini-game
   Pick a tier, pay Crystals, and watch a CS:GO-style horizontal reel settle on
   a prize. Prizes are Crystals or a skin drawn from the tier's price bracket,
   and every open fires the shared confetti celebration (js/confetti.js).
   ========================================================================= */

import { SKINS, getSkinById } from './skins.js';
import {
  spendCrystals,
  addCrystals,
  getCrystals,
  formatCrystals,
  onCrystalsChange,
} from './crystals.js';
import { addToInventory } from './inventory.js';
import { record } from './ledger.js';
import { showToast } from './toast.js';
import { crystalIcon } from './icons.js';
import { celebrateWin } from './celebration.js';

/* Four escalating tiers. Skin prizes are drawn from the tier's price bracket
   (min/max are Crystals). Weights are relative, not percentages. */
export const TIERS = [
  {
    id: 'bronze',
    name: 'Bronze',
    cost: 100,
    min: 0,
    max: 2000,
    prizes: [
      { kind: 'crystals', value: 25, weight: 34 },
      { kind: 'crystals', value: 50, weight: 26 },
      { kind: 'crystals', value: 90, weight: 16 },
      { kind: 'crystals', value: 200, weight: 6 },
      { kind: 'skin', weight: 18 },
    ],
  },
  {
    id: 'silver',
    name: 'Silver',
    cost: 260,
    min: 1000,
    max: 4000,
    prizes: [
      { kind: 'crystals', value: 50, weight: 30 },
      { kind: 'crystals', value: 120, weight: 24 },
      { kind: 'crystals', value: 240, weight: 14 },
      { kind: 'crystals', value: 520, weight: 6 },
      { kind: 'skin', weight: 26 },
    ],
  },
  {
    id: 'gold',
    name: 'Gold',
    cost: 650,
    min: 2500,
    max: 6500,
    prizes: [
      { kind: 'crystals', value: 120, weight: 28 },
      { kind: 'crystals', value: 300, weight: 22 },
      { kind: 'crystals', value: 650, weight: 14 },
      { kind: 'crystals', value: 1300, weight: 6 },
      { kind: 'skin', weight: 30 },
    ],
  },
  {
    id: 'neon',
    name: 'Neon',
    cost: 1600,
    min: 5000,
    max: Infinity,
    prizes: [
      { kind: 'crystals', value: 300, weight: 26 },
      { kind: 'crystals', value: 800, weight: 22 },
      { kind: 'crystals', value: 1600, weight: 14 },
      { kind: 'crystals', value: 3200, weight: 6 },
      { kind: 'skin', weight: 32 },
    ],
  },
];

const REEL_LENGTH = 44; // tiles drawn in the strip
const WIN_INDEX = 36; // where the winning tile sits — long run-in, clear settle
const SPIN_MS = 4200; // reel travel time (unrelated to the wheel's physics)

let els = null;
let activeTier = TIERS[0];
let spinning = false;

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pickWeighted(prizes) {
  const total = prizes.reduce((sum, p) => sum + p.weight, 0);
  let roll = Math.random() * total;
  for (const prize of prizes) {
    roll -= prize.weight;
    if (roll <= 0) return prize;
  }
  return prizes[prizes.length - 1];
}

function skinsInBracket(tier) {
  const pool = SKINS.filter((s) => s.price >= tier.min && s.price <= tier.max);
  return pool.length ? pool : SKINS;
}

/** Resolve a weighted prize definition into a concrete, real payout. */
function rollPrize(tier) {
  const def = pickWeighted(tier.prizes);
  if (def.kind === 'crystals') return { kind: 'crystals', value: def.value };
  const pool = skinsInBracket(tier);
  const skin = pool[Math.floor(Math.random() * pool.length)];
  return { kind: 'skin', skinId: skin.id };
}

function createTile(prize, isWinner) {
  const tile = document.createElement('div');
  tile.className = 'case-tile';
  if (isWinner) tile.classList.add('is-winner');

  if (prize.kind === 'skin') {
    const skin = getSkinById(prize.skinId);
    const img = document.createElement('img');
    img.className = 'case-tile-img';
    img.src = skin.image;
    img.alt = '';
    img.loading = 'lazy';
    const name = document.createElement('span');
    name.className = 'case-tile-name';
    name.textContent = skin.weapon;
    tile.append(img, name);
  } else {
    const value = document.createElement('span');
    value.className = 'case-tile-value';
    value.textContent = `+${formatCrystals(prize.value)}`;
    const mark = document.createElement('span');
    mark.className = 'case-tile-mark';
    mark.innerHTML = crystalIcon(13);
    tile.append(value, mark);
  }
  return tile;
}

/** Reflect the current tier and affordability on the controls. */
function update() {
  if (!els) return;
  const affordable = getCrystals() >= activeTier.cost;
  els.play.disabled = spinning || !affordable;
  els.play.innerHTML = `Open · ${formatCrystals(activeTier.cost)} ${crystalIcon(14)}`;
  els.play.classList.toggle('is-short', !affordable);
  els.tiers.querySelectorAll('.case-tier').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.tier === activeTier.id);
  });
}

function settle(prize) {
  spinning = false;
  if (els) els.track.style.transition = 'none';

  if (prize.kind === 'crystals') {
    addCrystals(prize.value);
    record({ type: 'case', label: 'Mystery Case win', amount: prize.value });
    els.result.dataset.state = 'win';
    els.result.textContent = `Won ${formatCrystals(prize.value)} Crystals.`;
    showToast(`+${formatCrystals(prize.value)} Crystals from the Mystery Case`, 'success');
  } else {
    const skin = getSkinById(prize.skinId);
    // Stage 3: tag the instance with how it was won (shown as "How I got this").
    addToInventory(prize.skinId, 1, { obtainedVia: 'case' });
    record({
      type: 'case',
      label: `Case win: ${skin.weapon} | ${skin.finish}`,
      amount: 0,
      skinId: prize.skinId,
    });
    els.result.dataset.state = 'win';
    els.result.textContent = `Won ${skin.weapon} | ${skin.finish}.`;
    showToast(`Case win: ${skin.weapon} | ${skin.finish}!`, 'success');
  }

  update();
  // Every open hands off to the shared cinematic celebration; bigger tiers get
  // a denser confetti burst.
  celebrateWin({
    amount: prize.kind === 'crystals' ? prize.value : 0,
    text:
      prize.kind === 'crystals'
        ? ''
        : `${getSkinById(prize.skinId).weapon} | ${getSkinById(prize.skinId).finish}`,
    big: activeTier.id === 'neon' || prize.kind === 'skin',
  });
}

function openCase() {
  if (spinning || !els) return;
  if (!spendCrystals(activeTier.cost)) {
    showToast('Not enough Crystals for that case', 'error');
    return;
  }

  spinning = true;
  els.play.disabled = true;
  els.result.dataset.state = 'spin';
  els.result.textContent = 'Opening…';
  record({ type: 'case', label: `${activeTier.name} case`, amount: -activeTier.cost });

  const prize = rollPrize(activeTier);

  // Build the strip; the winner sits at a fixed index, the rest are previews.
  const tiles = [];
  for (let i = 0; i < REEL_LENGTH; i += 1) {
    const tile = i === WIN_INDEX ? prize : rollPrize(activeTier);
    tiles.push(createTile(tile, i === WIN_INDEX));
  }
  els.track.replaceChildren(...tiles);

  // Snap back to the start, then let the browser paint before transitioning.
  els.track.style.transition = 'none';
  els.track.style.transform = 'translate3d(0, 0, 0)';
  void els.track.offsetWidth;

  const winnerEl = els.track.children[WIN_INDEX];
  const step = els.track.children[1].offsetLeft - els.track.children[0].offsetLeft;
  const jitter = rand(-step * 0.28, step * 0.28); // land off-centre, not robotic
  const offset =
    winnerEl.offsetLeft + winnerEl.offsetWidth / 2 - els.reel.clientWidth / 2 + jitter;

  const duration = reducedMotion ? 400 : SPIN_MS;
  requestAnimationFrame(() => {
    els.track.style.transition = `transform ${duration}ms cubic-bezier(0.16, 0.84, 0.22, 1)`;
    els.track.style.transform = `translate3d(${-offset}px, 0, 0)`;
  });

  window.setTimeout(() => settle(prize), duration + 350);
}

function buildTiers() {
  TIERS.forEach((tier) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'case-tier';
    btn.dataset.tier = tier.id;
    btn.innerHTML = `<span class="case-tier-name">${tier.name}</span>
      <span class="case-tier-cost">${formatCrystals(tier.cost)} ${crystalIcon(12)}</span>`;
    btn.addEventListener('click', () => {
      if (spinning || tier.id === activeTier.id) return;
      activeTier = tier;
      els.result.dataset.state = '';
      els.result.textContent = `${tier.name} case selected — press open.`;
      update();
    });
    els.tiers.append(btn);
  });
}

export function initMysteryCase() {
  const panel = document.querySelector('[data-case-panel]');
  if (!panel) return;

  els = {
    reel: panel.querySelector('[data-case-reel]'),
    track: panel.querySelector('[data-case-track]'),
    tiers: panel.querySelector('[data-case-tiers]'),
    play: panel.querySelector('[data-case-play]'),
    result: panel.querySelector('[data-case-result]'),
  };

  buildTiers();
  els.play.addEventListener('click', openCase);
  onCrystalsChange(() => update());
  update();
}

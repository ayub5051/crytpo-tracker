/* ============================================================================
   BLAZZER — Mines mini-game
   A 5×5 field. Pay to start, reveal tiles and dodge the mines; every safe pick
   lifts the multiplier, and cashing out banks it. Multipliers come from the
   true hypergeometric survival odds with a small house edge, so the board is
   fair-by-construction rather than hand-tuned. Wins hand off to the shared
   celebration (js/celebration.js).
   ========================================================================= */

import {
  spendCrystals,
  addCrystals,
  getCrystals,
  formatCrystals,
  onCrystalsChange,
} from './crystals.js';
import { record } from './ledger.js';
import { showToast } from './toast.js';
import { crystalIcon, bombIcon } from './icons.js';
import { celebrateWin } from './celebration.js';

export const GRID_SIZE = 25;
export const PLAY_COST = 100;
export const MINE_OPTIONS = [3, 5, 8];
const RTP = 0.97; // 97% return-to-player, matching the wheel's generosity

/** n choose k, integer-safe for these small values. */
function combinations(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i += 1) result = (result * (n - i)) / (i + 1);
  return Math.round(result);
}

/** Probability of clearing `picks` reveals with `mines` hidden in the field. */
export function survivalChance(picks, mines) {
  return combinations(GRID_SIZE - picks, mines) / combinations(GRID_SIZE, mines);
}

/** Payout multiplier after `picks` safe reveals (1× before the first pick). */
export function multiplierFor(picks, mines) {
  if (picks <= 0) return 1;
  return RTP / survivalChance(picks, mines);
}

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

let els = null;
let vignetteEl = null;
let mines = MINE_OPTIONS[0];
let state = 'idle'; // idle | playing | ended
let picks = 0;
let mineSet = new Set();
let multRaf = 0;

/* --------------------------------------------------------------- rendering */

function buildGrid() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < GRID_SIZE; i += 1) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'mine-tile';
    tile.dataset.index = String(i);
    tile.setAttribute('aria-label', `Tile ${i + 1}`);
    tile.innerHTML = '<span class="mine-tile-face"></span>';
    frag.append(tile);
  }
  els.grid.replaceChildren(frag);
}

function buildDifficulty() {
  MINE_OPTIONS.forEach((count) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mines-option';
    btn.dataset.mines = String(count);
    btn.innerHTML = `<span class="mines-option-count">${count}</span><span class="mines-option-note">mines</span>`;
    btn.addEventListener('click', () => {
      if (state === 'playing' || count === mines) return;
      mines = count;
      setResult(`Field set to ${count} mines — press play.`, '');
      syncControls();
    });
    els.difficulty.append(btn);
  });
}

/** Tiles are plain buttons until a round is live. */
function resetTiles() {
  els.grid.querySelectorAll('.mine-tile').forEach((tile) => {
    tile.classList.remove('is-safe', 'is-bomb', 'is-picked', 'is-animating', 'is-entering');
    tile.style.removeProperty('--reveal-delay');
    tile.style.removeProperty('--enter-delay');
    tile.disabled = true;
    tile.querySelector('.mine-tile-face').replaceChildren();
    tile.removeAttribute('aria-label');
    tile.setAttribute('aria-label', `Tile ${Number(tile.dataset.index) + 1}`);
  });
}

/* Add the transient compositor hint to one tile and drop it once its motion
   has finished, so `will-change` is never left standing on idle tiles. */
function flashMotion(tile, ms) {
  if (reducedMotion) return;
  tile.classList.add('is-animating');
  window.setTimeout(() => tile.classList.remove('is-animating'), ms);
}

/* New-game entry: a diagonal wave from the top-left tile to the bottom-right,
   each tile 30ms behind the previous (row + column), 400ms of motion each —
   ~700ms in total. Delays ride on a custom property read by the CSS. */
function playGridEntry() {
  if (reducedMotion) return;
  const tiles = els.grid.querySelectorAll('.mine-tile');
  tiles.forEach((tile) => {
    const i = Number(tile.dataset.index);
    const wave = Math.floor(i / 5) + (i % 5);
    tile.style.setProperty('--enter-delay', `${wave * 30}ms`);
  });
  void els.grid.offsetWidth; // restart the wave cleanly
  tiles.forEach((tile) => tile.classList.add('is-entering'));
  window.setTimeout(() => {
    tiles.forEach((tile) => {
      tile.classList.remove('is-entering');
      tile.style.removeProperty('--enter-delay');
    });
  }, 720);
}

function paintMultiplier(value) {
  els.multiplier.textContent = `${value.toFixed(2)}×`;
  els.payout.textContent = picks > 0 ? formatCrystals(Math.round(PLAY_COST * value)) : '0';
}

/** Tween the multiplier between values with an ease-out curve. */
function animateMultiplier(from, to) {
  window.cancelAnimationFrame(multRaf);
  const duration = reducedMotion ? 0 : 400;
  const t0 = performance.now();

  // Let the crystal beside the payout glow softly while the number counts up.
  const crystalStat = els.payout.closest('.mines-stat');
  if (!reducedMotion && crystalStat) {
    crystalStat.classList.remove('is-counting');
    void crystalStat.offsetWidth;
    crystalStat.classList.add('is-counting');
    window.setTimeout(() => crystalStat.classList.remove('is-counting'), 420);
  }

  function frame(now) {
    const p = duration === 0 ? 1 : Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    paintMultiplier(from + (to - from) * eased);
    if (p < 1) {
      multRaf = requestAnimationFrame(frame);
    }
  }

  multRaf = requestAnimationFrame(frame);
}

function bumpMultiplier() {
  const stat = els.multiplier.closest('.mines-stat');
  if (!stat) return;
  stat.classList.remove('is-bump');
  void stat.offsetWidth;
  stat.classList.add('is-bump');
}

function setResult(text, variant) {
  els.result.textContent = text;
  els.result.dataset.state = variant;
}

/** Reflect state + affordability on the controls. */
function syncControls() {
  const canAfford = getCrystals() >= PLAY_COST;
  const playing = state === 'playing';

  els.play.disabled = playing || !canAfford;
  els.play.classList.toggle('is-short', !canAfford);
  els.cash.disabled = !playing || picks === 0;

  els.difficulty.querySelectorAll('.mines-option').forEach((btn) => {
    btn.classList.toggle('is-active', Number(btn.dataset.mines) === mines);
    btn.disabled = playing;
  });
}

/* ---------------------------------------------------------------- gameplay */

function startRound() {
  if (state === 'playing' || !els) return;
  if (!spendCrystals(PLAY_COST)) {
    showToast('Not enough Crystals to play', 'error');
    return;
  }

  state = 'playing';
  picks = 0;
  mineSet = new Set();
  while (mineSet.size < mines) mineSet.add(Math.floor(Math.random() * GRID_SIZE));

  resetTiles();
  els.grid.querySelectorAll('.mine-tile').forEach((tile) => {
    tile.disabled = false;
  });
  playGridEntry();
  paintMultiplier(1);
  bumpMultiplier();
  setResult(`Field live — ${GRID_SIZE - mines} safe tiles. Pick one.`, 'spin');
  record({ type: 'mines', label: `Mines · ${mines} mines`, amount: -PLAY_COST });
  syncControls();
}

function revealAllMines(exceptIndex) {
  let order = 0;
  els.grid.querySelectorAll('.mine-tile').forEach((tile) => {
    const index = Number(tile.dataset.index);
    if (!mineSet.has(index) || index === exceptIndex) return;
    const delay = reducedMotion ? 0 : order * 30;
    order += 1;
    tile.style.setProperty('--reveal-delay', `${delay}ms`);
    tile.classList.add('is-bomb');
    tile.querySelector('.mine-tile-face').innerHTML = bombIcon(20);
    tile.disabled = true;
    flashMotion(tile, 340 + delay);
  });
}

/** Brief screen-wide red vignette pulse on a bomb hit. */
function pulseVignette() {
  if (reducedMotion || !vignetteEl) return;
  vignetteEl.classList.remove('is-on');
  void vignetteEl.offsetWidth;
  vignetteEl.classList.add('is-on');
  window.setTimeout(() => vignetteEl.classList.remove('is-on'), 320);
}

function finish() {
  state = 'ended';
  els.grid.querySelectorAll('.mine-tile').forEach((tile) => {
    tile.disabled = true;
  });
  syncControls();
}

function boom(index) {
  const tile = els.grid.querySelector(`.mine-tile[data-index="${index}"]`);
  if (tile) {
    tile.classList.add('is-bomb', 'is-picked');
    tile.querySelector('.mine-tile-face').innerHTML = bombIcon(22);
    flashMotion(tile, 400);
  }
  revealAllMines(index);
  finish();
  pulseVignette();
  setResult('Boom — you hit a mine. Press play to try again.', 'lose');
  showToast('Struck a mine — better luck next round', 'error');
}

function autoCashOut() {
  // Every safe tile cleared — the round pays out on its own.
  cashOut(true);
}

function cashOut(auto = false) {
  if (state !== 'playing' || picks === 0) return;

  const multiplier = multiplierFor(picks, mines);
  const payout = Math.round(PLAY_COST * multiplier);

  addCrystals(payout);
  record({
    type: 'mines',
    label: `Mines — ${picks} safe pick${picks === 1 ? '' : 's'}`,
    amount: payout,
  });

  revealAllMines();
  finish();
  paintMultiplier(multiplier);
  setResult(
    `${auto ? 'Board cleared! ' : ''}Cashed out ${formatCrystals(payout)} Crystals at ${multiplier.toFixed(2)}×.`,
    'win'
  );
  // Quick pop on the button itself, then hand off to the shared celebration.
  if (!reducedMotion) {
    els.cash.classList.remove('is-pop');
    void els.cash.offsetWidth;
    els.cash.classList.add('is-pop');
    window.setTimeout(() => els.cash.classList.remove('is-pop'), 240);
  }

  showToast(`+${formatCrystals(payout)} Crystals from Mines`, 'success');
  celebrateWin({ amount: payout, big: payout >= PLAY_COST * 5 });
}

function pickTile(index) {
  if (state !== 'playing') return;
  const tile = els.grid.querySelector(`.mine-tile[data-index="${index}"]`);
  if (!tile || tile.classList.contains('is-safe') || tile.disabled) return;

  if (mineSet.has(index)) {
    boom(index);
    return;
  }

  picks += 1;
  tile.classList.add('is-safe');
  tile.disabled = true;
  tile.querySelector('.mine-tile-face').innerHTML = crystalIcon(22);
  tile.setAttribute('aria-label', `Tile ${index + 1}, safe`);
  flashMotion(tile, 460);

  const previous = picks === 1 ? 1 : multiplierFor(picks - 1, mines);
  const next = multiplierFor(picks, mines);
  animateMultiplier(previous, next);
  bumpMultiplier();
  syncControls();

  if (picks === GRID_SIZE - mines) {
    autoCashOut();
  } else {
    setResult(`${picks} safe · ${multiplierFor(picks, mines).toFixed(2)}× — cash out or push on.`, 'spin');
  }
}

/* ------------------------------------------------------------------- setup */

export function initMines() {
  const panel = document.querySelector('[data-mines-panel]');
  if (!panel) return;

  els = {
    grid: panel.querySelector('[data-mines-grid]'),
    difficulty: panel.querySelector('[data-mines-difficulty]'),
    play: panel.querySelector('[data-mines-play]'),
    cash: panel.querySelector('[data-mines-cashout]'),
    multiplier: panel.querySelector('[data-mines-multiplier]'),
    payout: panel.querySelector('[data-mines-payout]'),
    result: panel.querySelector('[data-mines-result]'),
  };
  if (!els.grid || !els.play || !els.cash) return;

  // Screen-wide vignette layer for bomb hits — fixed like the win layers.
  vignetteEl = document.createElement('div');
  vignetteEl.className = 'mines-vignette';
  vignetteEl.setAttribute('data-mines-vignette', '');
  vignetteEl.setAttribute('aria-hidden', 'true');
  document.body.append(vignetteEl);

  buildGrid();
  buildDifficulty();
  paintMultiplier(1);
  resetTiles();

  els.grid.addEventListener('click', (event) => {
    const tile = event.target.closest('.mine-tile');
    if (tile) pickTile(Number(tile.dataset.index));
  });
  els.play.addEventListener('click', startRound);
  els.cash.addEventListener('click', () => cashOut(false));
  onCrystalsChange(() => syncControls());

  syncControls();
}

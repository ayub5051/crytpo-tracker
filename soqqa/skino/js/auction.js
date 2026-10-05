/* ============================================================================
   SKINO — Random Auction mini-game
   A mystery skin goes under the hammer. A house bidder raises the price up to a
   hidden ceiling; outbid it before the clock runs out to win the lot for your
   final bid. The skin stays veiled until the auction settles.
   ========================================================================= */

import { SKINS, formatPrice, RARITIES } from './skins.js';
import { spendCrystals, getCrystals, formatCrystals, onCrystalsChange } from './crystals.js';
import { addToInventory } from './inventory.js';
import { record } from './ledger.js';
import { showToast } from './toast.js';

export const DURATION_MS = 15_000;
const MIN_BID = 50;

let els = null;
let lot = null;
let ceiling = 0;
let step = 0;
let currentBid = 0;
let leader = null; // 'you' | 'rival' | null
let running = false;
let endsAt = 0;
let tickId = null;
let rivalId = null;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Lottable skins: mid-tier so auctions stay winnable and meaningful. */
const LOT_POOL = SKINS.filter((skin) => skin.price >= 300 && skin.price <= 8000);

function pickLot() {
  return LOT_POOL[randInt(0, LOT_POOL.length - 1)];
}

function nextBid() {
  return currentBid + step;
}

function update() {
  if (!els) return;

  els.bid.textContent = currentBid > 0 ? formatPrice(currentBid) : '—';
  els.leader.textContent =
    leader === 'you' ? 'You' : leader === 'rival' ? 'The house' : '—';

  const canBid = running && leader !== 'you';
  const amount = nextBid();
  const affordable = amount <= getCrystals();
  els.place.disabled = !canBid;
  els.place.textContent = canBid ? `Bid · ${formatPrice(amount)}` : 'Bid';
  els.place.classList.toggle('is-short', canBid && !affordable);
}

function tick() {
  const remaining = Math.max(0, endsAt - performance.now());
  if (els) els.time.textContent = `${(remaining / 1000).toFixed(1)}s`;
  if (remaining <= 0) settle();
}

function scheduleRival() {
  rivalId = window.setTimeout(() => {
    rivalId = null;
    if (!running) return;
    if (nextBid() <= ceiling) {
      currentBid = nextBid();
      leader = 'rival';
      update();
      scheduleRival();
    }
  }, randInt(1300, 2500));
}

function begin() {
  if (running || !els) return;
  running = true;
  lot = pickLot();

  const factor = 0.55 + Math.random() * 0.35;
  ceiling = Math.max(MIN_BID, Math.round(lot.price * factor));
  step = Math.max(25, Math.round(lot.price * 0.08));
  currentBid = MIN_BID;
  leader = null;
  endsAt = performance.now() + DURATION_MS;

  // Veil the lot for the duration of the auction (image loads while blurred).
  els.img.src = lot.image;
  els.img.alt = 'Mystery lot';
  els.img.classList.add('is-hidden');
  els.img.parentElement.classList.add('is-veiled');
  els.name.textContent = 'Mystery lot';
  els.rarity.textContent = `${lot.rarity} tier`;
  els.rarity.style.color = RARITIES[lot.rarity] ?? '';
  els.result.dataset.state = 'spin';
  els.result.textContent = 'The house opens the bidding…';
  els.start.disabled = true;

  update();
  els.time.textContent = `${(DURATION_MS / 1000).toFixed(1)}s`;
  tickId = window.setInterval(tick, 100);
  scheduleRival();
}

function reveal() {
  els.img.src = lot.image;
  els.img.alt = `${lot.weapon} | ${lot.finish}`;
  els.img.classList.remove('is-hidden');
  els.img.parentElement.classList.remove('is-veiled');
  els.name.textContent = `${lot.weapon} | ${lot.finish}`;
  els.rarity.textContent = lot.rarity;
}

function settle() {
  if (!running) return;
  running = false;

  if (tickId !== null) {
    window.clearInterval(tickId);
    tickId = null;
  }
  if (rivalId !== null) {
    window.clearTimeout(rivalId);
    rivalId = null;
  }

  els.time.textContent = '0.0s';
  els.place.disabled = true;
  els.place.textContent = 'Bid';
  els.start.disabled = false;
  els.start.textContent = 'New auction';
  reveal();

  if (leader === 'you' && spendCrystals(currentBid)) {
    addToInventory(lot.id);
    record({
      type: 'auction',
      label: `Won ${lot.weapon} | ${lot.finish}`,
      amount: -currentBid,
      skinId: lot.id,
    });
    els.result.dataset.state = 'win';
    els.result.textContent = `Won the lot for ${formatCrystals(currentBid)} Crystals.`;
    showToast(`Auction won: ${lot.weapon} | ${lot.finish}`, 'success');
  } else if (leader === 'you') {
    els.result.dataset.state = 'lose';
    els.result.textContent = 'Not enough Crystals to settle — the lot went unsold.';
  } else {
    els.result.dataset.state = 'lose';
    els.result.textContent = `Outbid — the lot closed at ${formatCrystals(
      currentBid
    )} Crystals.`;
  }

  update();
}

function placeBid() {
  if (!running || leader === 'you') return;
  const amount = nextBid();
  if (amount > getCrystals()) {
    showToast('Not enough Crystals for that bid', 'error');
    return;
  }
  currentBid = amount;
  leader = 'you';
  update();
}

export function initAuction() {
  const panel = document.querySelector('[data-auction-panel]');
  if (!panel) return;

  els = {
    img: panel.querySelector('[data-auction-img]'),
    rarity: panel.querySelector('[data-auction-rarity]'),
    name: panel.querySelector('[data-auction-name]'),
    bid: panel.querySelector('[data-auction-bid]'),
    leader: panel.querySelector('[data-auction-leader]'),
    time: panel.querySelector('[data-auction-time]'),
    start: panel.querySelector('[data-auction-start]'),
    place: panel.querySelector('[data-auction-place]'),
    result: panel.querySelector('[data-auction-result]'),
  };

  els.start.addEventListener('click', begin);
  els.place.addEventListener('click', placeBid);
  onCrystalsChange(() => update());
}

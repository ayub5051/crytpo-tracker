/* ============================================================================
   BLAZZER — marketplace (Stage 3.2)
   The secondary market: browse, filter, list, buy, cancel and re-price. The
   demo runs local-first — LocalStorage is authoritative so the market works
   with no server at all — and mirrors every action to the server API when
   `window.BLAZZER_MARKET.sync === true` (best effort; a missing server never
   breaks the UI).

   What lives here:
     • the listing model (seed + CRUD + events), the single source of truth
     • the enhanced listing card (seller row, expiry/just-listed badges)
     • the filter drawer, URL-synced and reload-persistent, debounced 200ms
     • a windowed virtual scroll so thousands of listings stay at 60fps

   Animation is transform/opacity only and every flourish collapses under
   `prefers-reduced-motion`.
   ========================================================================= */

import { SKINS, RARITIES, PRICE_BANDS, getSkinById, createSkinCard } from './skins.js';
import { getCrystals, spendCrystals, formatCrystals } from './crystals.js';
import { getItem, addToInventory, updateItem, onInventoryChange } from './inventory.js';
import { record } from './ledger.js';
import { showToast } from './toast.js';
import { crystalIcon, hydrateCrystalIcons } from './icons.js';
import { initMarketToolbar } from './marketFilters.js';
import { openBuyModal } from './market-buy.js';
import { initMyListings, refreshMyListings } from './market-my-listings.js';

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* ------------------------------------------------------------------ config */

export const COMMISSION = 0.07;
export const LISTING_DURATIONS = [
  { id: '1h', label: '1h', ms: 60 * 60 * 1000 },
  { id: '6h', label: '6h', ms: 6 * 60 * 60 * 1000 },
  { id: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { id: '3d', label: '3d', ms: 3 * 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
];
export const DEFAULT_DURATION = '24h';

const LISTINGS_KEY = 'blazzer:market:listings';
const ME_KEY = 'blazzer:market:me';
const FILTERS_KEY = 'blazzer:market:filters';
// Bumping SEED_VERSION retires any previously-seeded market data (a user's own
// listings are preserved) so a fixed seeder actually replaces the old one.
const SEED_VERSION = 2;

const VIRTUAL_THRESHOLD = 60; // below this, render straight into the grid
const WINDOW_BUFFER = 2; // extra rows above/below the viewport

export const WEAR_ORDER = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];
export const RARITY_ORDER = Object.keys(RARITIES);
export const CATEGORIES = [
  { id: 'rifles', label: 'Rifles', test: (w) => /^(AK-47|M4A4|M4A1-S|Galil|FAMAS|SG 553|AUG)/.test(w) },
  { id: 'snipers', label: 'Snipers', test: (w) => /^(AWP|SSG 08|SCAR-20|G3SG1)/.test(w) },
  { id: 'pistols', label: 'Pistols', test: (w) => /^(Desert Eagle|USP-S|Glock-18|P250|Five-SeveN|Tec-9|CZ75|P2000|R8)/.test(w) },
  { id: 'smgs', label: 'SMGs', test: (w) => /^(MP9|MAC-10|UMP-45|P90|MP7|MP5)/.test(w) },
  { id: 'knives', label: 'Knives', test: (w) => w.startsWith('★') && !/Gloves/.test(w) },
  { id: 'gloves', label: 'Gloves', test: (w) => /Gloves/.test(w) },
];
export function categoryOf(weapon = '') {
  const hit = CATEGORIES.find((c) => c.test(weapon));
  return hit ? hit.id : 'other';
}

/* ------------------------------------------------------------- fee helpers */

export function feeOf(price) {
  return Math.round(Math.max(0, Number(price) || 0) * COMMISSION);
}
export function payoutOf(price) {
  return Math.max(0, Math.round(Number(price) || 0) - feeOf(price));
}

/* ------------------------------------------------------ deterministic PRNG */

/** mulberry32 — tiny, fast, stable across reloads for the seeded listings. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SELLER_NAMES = [
  'nyx', 'Kestrel', 'vanta', 'Orbit', 'gl1tch', 'Sable', 'Fen', 'quasar',
  'Rook', 'Mirage', 'Onibi', 'Halcyon', 'Cinder', 'Volt', 'Nomad', 'Zephyr',
];

/* -------------------------------------------------------------------- state */

const listeners = new Set();

const state = {
  q: '',
  sort: 'featured',
  rarity: 'all', // toolbar rarity select
  rarities: new Set(), // drawer chips
  categories: new Set(),
  wears: new Set(),
  stattrakOnly: false,
  ratingMin: 0,
  priceMin: 0,
  priceMax: 0,
};

let me = null;
let listings = [];
let els = null;
let layout = null; // { cols, rowHeight, gridTop }
let lastWidth = 0;
let scrollRaf = 0;
let debounceTimer = 0;
let ro = null;

/* --------------------------------------------------------------- utilities */

function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

function emit() {
  listeners.forEach((fn) => fn());
}

export function onMarketChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The current user's pseudonymous seller identity (no login in the demo). */
function ensureMe() {
  if (me) return me;
  me = readJson(ME_KEY, null);
  if (!me || !me.id) {
    me = { id: 'me', name: 'You', rating: 5, sales: 0 };
    writeJson(ME_KEY, me);
  }
  return me;
}

function maxPriceOf() {
  return Math.max(500, ...SKINS.map((s) => s.price));
}

/* -------------------------------------------------------------------- seed */

/** The wear float ranges a condition spans — used for a truthful detail modal. */
const FLOAT_RANGES = {
  'Factory New': [0.0, 0.07],
  'Minimal Wear': [0.07, 0.15],
  'Field-Tested': [0.15, 0.38],
  'Well-Worn': [0.38, 0.45],
  'Battle-Scarred': [0.45, 1.0],
};

/** The listing duration windows, each with its own jitter range. */
const DURATION_WINDOWS = [
  [30 * 60 * 1000, 90 * 60 * 1000],
  [4 * 3600 * 1000, 8 * 3600 * 1000],
  [20 * 3600 * 1000, 28 * 3600 * 1000],
  [60 * 3600 * 1000, 84 * 3600 * 1000],
  [144 * 3600 * 1000, 192 * 3600 * 1000],
];

function bandFor(rarity) {
  return PRICE_BANDS[rarity] || PRICE_BANDS.Consumer;
}

/**
 * Validate the market against the six data-integrity rules. Anything that
 * fails is reported and dropped — the grid never renders broken data.
 *
 * @returns {{valid:object[], rejected:{listing:object, reason:string}[]}}
 */
export function validateListings(list) {
  const valid = [];
  const rejected = [];
  const seenIds = new Set();
  const seenCatalogue = new Set();
  const seenMinutes = new Set();

  (Array.isArray(list) ? list : []).forEach((listing) => {
    const skin = getSkinById(listing.catalogueId);
    // 1. the skin exists in the catalogue
    if (!skin) return rejected.push({ listing, reason: 'unknown skin' });

    // 6. rarity matches the catalogue
    if (listing.rarity !== skin.rarity) return rejected.push({ listing, reason: 'rarity mismatch' });

    // 2. the price is inside the rarity band
    const [low, high] = bandFor(skin.rarity);
    if (!(listing.price >= low && listing.price <= high)) {
      return rejected.push({ listing, reason: `price ${listing.price} outside ${skin.rarity} band ${low}-${high}` });
    }

    // 3. the instance id is unique, and each skin is listed once
    if (seenIds.has(listing.id)) return rejected.push({ listing, reason: 'duplicate id' });
    if (seenCatalogue.has(listing.catalogueId)) return rejected.push({ listing, reason: 'duplicate skin' });

    // 5. the expiry is unique to the minute
    const minute = Math.floor(listing.expiresAt / 60_000);
    if (seenMinutes.has(minute)) return rejected.push({ listing, reason: 'duplicate expiry' });

    seenIds.add(listing.id);
    seenCatalogue.add(listing.catalogueId);
    seenMinutes.add(minute);
    valid.push(listing);
    return undefined;
  });

  return { valid, rejected };
}

/** Every skin must carry a distinct gradient (rule 4). */
export function validateCatalogue() {
  const seen = new Map();
  SKINS.forEach((skin) => {
    const existing = seen.get(skin.gradient);
    if (existing) throw new Error(`[market] duplicate gradient: ${skin.id} and ${existing}`);
    seen.set(skin.gradient, skin.id);
  });
  return true;
}

/**
 * Seed a diverse market: one distinct skin per listing (never duplicates),
 * priced inside its rarity band, each with a unique expiry.
 */
function seedListings() {
  const random = rng(0xb1a22e7);
  const now = Date.now();
  const out = [];

  const seller = (i) => {
    const name = SELLER_NAMES[i % SELLER_NAMES.length];
    return {
      id: `seed:${name}`,
      name,
      rating: 3.5 + Math.round(random() * 3) / 2, // 3.5 – 5.0
      sales: 4 + Math.floor(random() * 240),
    };
  };

  // Shuffle the catalogue and take every skin exactly once.
  const catalogue = SKINS.map((skin, i) => ({ skin, order: hash(0x9e3779b9 ^ i) }))
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.skin);

  catalogue.forEach((skin, index) => {
    const [low, high] = bandFor(skin.rarity);
    const base = skin.basePrice ?? skin.price;
    // ±10% variance, clamped so the price can never leave the rarity band.
    const drifted = Math.round((base * (0.9 + random() * 0.2)) / 5) * 5;
    const price = Math.max(low, Math.min(high, drifted));

    const [winMin, winMax] = DURATION_WINDOWS[Math.floor(random() * DURATION_WINDOWS.length)];
    const [flMin, flMax] = FLOAT_RANGES[skin.condition] || [0, 1];

    out.push({
      id: `seed:${skin.id}`,
      uid: null,
      catalogueId: skin.id,
      weapon: skin.weapon,
      finish: skin.finish,
      condition: skin.condition,
      rarity: skin.rarity,
      stattrak: random() < 0.08,
      floatValue: Number((flMin + random() * (flMax - flMin)).toFixed(6)),
      stickers: [],
      fairProof: null,
      seller: seller(index),
      price,
      fee: feeOf(price),
      payout: payoutOf(price),
      createdAt: now - Math.floor(random() * 6 * 60 * 60 * 1000),
      expiresAt: now + Math.round((winMin + random() * (winMax - winMin)) / 1000) * 1000,
      status: 'active',
      buyerId: null,
      soldAt: null,
      seeded: true,
    });
  });

  // Rule 5: no two listings may end within a minute of each other.
  out.sort((a, b) => a.expiresAt - b.expiresAt);
  for (let i = 1; i < out.length; i += 1) {
    if (out[i].expiresAt - out[i - 1].expiresAt < 61_000) {
      out[i].expiresAt = out[i - 1].expiresAt + 61_000;
    }
  }

  return out;
}

/** Small stable hash used to shuffle the catalogue deterministically. */
function hash(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/* ------------------------------------------------------------- persistence */

function persist() {
  writeJson(LISTINGS_KEY, { v: SEED_VERSION, listings });
}

function load() {
  const stored = readJson(LISTINGS_KEY, null);
  const userListings = Array.isArray(stored?.listings) ? stored.listings.filter((l) => !l.seeded) : [];

  // A different seed version means the stored seed is stale — rebuild it, but
  // keep the user's own listings and anything they have already sold.
  if (stored?.v === SEED_VERSION && Array.isArray(stored.listings) && stored.listings.length) {
    listings = stored.listings;
    return;
  }

  const { valid, rejected } = validateListings(seedListings());
  if (rejected.length) {
    console.warn(`[market] dropped ${rejected.length} invalid seed listing(s):`);
    rejected.forEach((r) => console.warn('  ·', r.reason, r.listing?.id));
  }
  listings = [...valid, ...userListings];
  persist();
}

// Load (and seed on first run) at import time so the model is usable even
// before the Market view is first shown — e.g. a Sell action from Inventory.
load();

/* ------------------------------------------------------------------ queries */

/** Active, unexpired listings (expiry is checked lazily on read). */
export function getListings() {
  const now = Date.now();
  return listings.filter((l) => l.status === 'active' && l.expiresAt > now);
}

export function getListing(id) {
  const listing = listings.find((l) => l.id === id);
  if (!listing || listing.status !== 'active' || listing.expiresAt <= Date.now()) return null;
  return listing;
}

export function myListings() {
  const mine = ensureMe().id;
  return getListings()
    .filter((l) => l.seller.id === mine)
    .sort((a, b) => a.expiresAt - b.expiresAt);
}

/** Median-based suggested price for a catalogue item. */
export function suggestPrice(catalogueId) {
  const prices = listings
    .filter((l) => l.catalogueId === catalogueId && l.status === 'sold')
    .map((l) => l.price)
    .sort((a, b) => a - b);
  if (!prices.length) {
    const skin = getSkinById(catalogueId);
    const base = skin?.price ?? 1000;
    return { suggested: base, low: Math.round(base * 0.95), high: Math.round(base * 1.05), samples: 0 };
  }
  const mid = prices[Math.floor(prices.length / 2)];
  return { suggested: mid, low: prices[0], high: prices[prices.length - 1], samples: prices.length };
}

/* -------------------------------------------------------------- mutations */

function assertPrice(price) {
  const value = Math.round(Number(price));
  if (!Number.isFinite(value) || value < 1) throw new Error('Enter a valid price');
  return value;
}

/**
 * Put an owned inventory item up for sale.
 * @param {{uid:string, price:number, duration?:string}} input
 */
export function listItem({ uid, price, duration = DEFAULT_DURATION }) {
  const item = getItem(uid);
  if (!item) throw new Error('Item not found');
  if (item.isListed) throw new Error('That item is already listed');
  if (item.tradeLocked && (!item.tradeLockedUntil || item.tradeLockedUntil > Date.now())) {
    throw new Error('That item is trade-locked');
  }
  const skin = getSkinById(item.id);
  if (!skin) throw new Error('Unknown item');

  const value = assertPrice(price);
  const durationMs = LISTING_DURATIONS.find((d) => d.id === duration)?.ms ?? LISTING_DURATIONS[2].ms;
  const now = Date.now();
  const seller = ensureMe();
  const listing = {
    id: `m_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    uid,
    catalogueId: skin.id,
    weapon: skin.weapon,
    finish: skin.finish,
    condition: skin.condition,
    rarity: skin.rarity,
    stattrak: Boolean(item.stattrak),
    floatValue: item.floatValue ?? null,
    stickers: item.stickers || [],
    fairProof: null,
    seller: { ...seller },
    price: value,
    fee: feeOf(value),
    payout: payoutOf(value),
    createdAt: now,
    expiresAt: now + durationMs,
    status: 'active',
    buyerId: null,
    soldAt: null,
    seeded: false,
  };

  listings.unshift(listing);
  updateItem(uid, { isListed: true, price: value });
  persist();
  emit();
  syncFromServer('list', listing);
  return listing;
}

/**
 * Buy a listing. Throws on any failure; the caller rolls back optimistic UI.
 * @param {string} id
 */
export function buyListing(id) {
  const listing = getListing(id);
  if (!listing) throw new Error('That listing is no longer available');
  if (listing.seller.id === ensureMe().id) throw new Error('You cannot buy your own listing');

  const balance = getCrystals();
  if (balance < listing.price) throw new Error('Not enough Crystals');

  // Optimistic: debit, credit the inventory, mark sold. All local and atomic.
  if (!spendCrystals(listing.price)) throw new Error('Not enough Crystals');
  const [added] = addToInventory(listing.catalogueId, 1, {
    obtainedVia: 'purchase',
    stattrak: listing.stattrak,
    floatValue: listing.floatValue ?? undefined,
  });

  listing.status = 'sold';
  listing.buyerId = ensureMe().id;
  listing.soldAt = Date.now();
  persist();

  record({
    type: 'purchase',
    label: `Bought ${listing.weapon} | ${listing.finish} on the market`,
    amount: -listing.price,
    skinId: listing.catalogueId,
  });
  emit();
  syncFromServer('buy', listing);
  return { listing, itemUid: added?.uid ?? null };
}

/** Cancel one of the current user's own listings; the item returns to inventory. */
export function cancelListing(id) {
  const listing = listings.find((l) => l.id === id);
  if (!listing || listing.seller.id !== ensureMe().id) throw new Error('Listing not found');
  if (listing.status !== 'active') throw new Error('That listing is not active');
  listing.status = 'cancelled';
  if (listing.uid) updateItem(listing.uid, { isListed: false, price: null });
  persist();
  emit();
  syncFromServer('cancel', listing);
  return listing;
}

/** Re-price an active listing the user owns. */
export function editListing(id, price) {
  const listing = listings.find((l) => l.id === id);
  if (!listing || listing.seller.id !== ensureMe().id) throw new Error('Listing not found');
  const value = assertPrice(price);
  listing.price = value;
  listing.fee = feeOf(value);
  listing.payout = payoutOf(value);
  if (listing.uid) updateItem(listing.uid, { price: value });
  persist();
  emit();
  syncFromServer('edit', listing);
  return listing;
}

/* ----------------------------------------------------------- server mirror */
/* Best-effort. Runs only when the demo is explicitly pointed at a server; the
   local model already succeeded, so a failure is logged and ignored. */

const API = () => (window.BLAZZER_MARKET?.sync === true ? window.BLAZZER_MARKET : null);

function authHeaders() {
  const token = window.BLAZZER_MARKET?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function syncFromServer(action, listing) {
  const cfg = API();
  if (!cfg) return;
  const opts = { headers: { 'Content-Type': 'application/json', ...authHeaders() } };
  let url = null;
  let body = null;
  if (action === 'list') {
    url = '/api/market/list';
    body = JSON.stringify({
      itemId: listing.uid,
      price: listing.price,
      duration: DEFAULT_DURATION,
      meta: { catalogueId: listing.catalogueId, weapon: listing.weapon, finish: listing.finish, condition: listing.condition, rarity: listing.rarity },
      seller: { id: ensureMe().id, name: ensureMe().name, rating: ensureMe().rating, sales: ensureMe().sales },
    });
  } else if (action === 'buy') {
    url = `/api/market/buy/${listing.id}`;
    opts.headers['Idempotency-Key'] = `buy_${listing.id}_${ensureMe().id}`;
    body = '{}';
  } else if (action === 'cancel') {
    url = `/api/market/cancel/${listing.id}`;
    body = '{}';
  } else if (action === 'edit') {
    url = `/api/market/edit/${listing.id}`;
    body = JSON.stringify({ price: listing.price });
  }
  if (!url) return;
  fetch(url, { ...opts, method: 'POST', body }).catch((err) =>
    console.warn('[market] sync failed:', err.message)
  );
}

/* -------------------------------------------------------------- identifiers */

/** A deterministic 5×5 mirrored identicon, coloured from the seller id. */
function identicon(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue1 = h % 360;
  const hue2 = (h * 47) % 360;
  const random = rng(h || 1);
  const cells = [];
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      if (random() > 0.5) {
        cells.push([x, y], [4 - x, y]);
      }
    }
  }
  const dots = cells
    .map(([x, y]) => `<rect x="${x * 6}" y="${y * 6}" width="6" height="6" rx="1.4"/>`)
    .join('');
  return (
    `<svg class="listing-avatar" viewBox="0 0 30 30" width="28" height="28" aria-hidden="true" focusable="false">` +
    `<defs><linearGradient id="gi${h}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue1} 70% 58%)"/>` +
    `<stop offset="1" stop-color="hsl(${hue2} 70% 42%)"/></linearGradient></defs>` +
    `<rect width="30" height="30" rx="7" fill="url(#gi${h})" opacity="0.28"/>` +
    `<g fill="hsl(${hue1} 80% 70%)">${dots}</g></svg>`
  );
}

function starsMarkup(rating) {
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
  return (
    '<span class="listing-stars" aria-hidden="true">' +
    '<span class="listing-stars-base">★★★★★</span>' +
    `<span class="listing-stars-fill" style="width:${pct}%">★★★★★</span>` +
    '</span>'
  );
}

/* ------------------------------------------------------------------ cards */

/**
 * Human expiry label, e.g. "Ends in 6h 12m". The label is precise to the
 * minute on purpose: seeds are spaced at least 61s apart, so minute precision
 * is exactly what guarantees no two badges ever read the same.
 */
export function endsLabel(expiresAt) {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'Ended';
  const m = Math.floor(ms / 60_000);
  if (m >= 1440) return `Ends in ${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  if (m >= 60) return `Ends in ${Math.floor(m / 60)}h ${m % 60}m`;
  return `Ends in ${Math.max(1, m)}m`;
}

/**
 * Build one marketplace card: the shared catalogue card plus the seller row
 * and the time-sensitive badges the market needs.
 */
export function createListingCard(listing) {
  const skin = getSkinById(listing.catalogueId);
  const card = createSkinCard(skin || {
    id: listing.catalogueId,
    weapon: listing.weapon,
    finish: listing.finish,
    condition: listing.condition,
    rarity: listing.rarity,
    price: listing.price,
    image: '',
  });
  card.classList.add('listing-card');
  card.dataset.listingId = listing.id;
  if (listing.stattrak) card.classList.add('is-stattrak');
  card.setAttribute(
    'aria-label',
    `${listing.weapon} | ${listing.finish}, ${listing.condition}, ${formatCrystals(listing.price)} Crystals, sold by ${listing.seller.name}`
  );

  // Override the price with the listing price.
  const priceEl = card.querySelector('.skin-price');
  if (priceEl) priceEl.innerHTML = `${formatCrystals(listing.price)} ${crystalIcon(13)}`;

  const thumb = card.querySelector('.skin-thumb');

  // Top-right badges: "Just listed" wins over "Ends in …".
  const age = Date.now() - listing.createdAt;
  const left = listing.expiresAt - Date.now();
  const badges = document.createElement('div');
  badges.className = 'listing-badges';
  if (age < 30 * 60 * 1000) {
    badges.innerHTML = '<span class="listing-badge is-new">Just listed</span>';
  } else if (left < 8 * 60 * 60 * 1000) {
    badges.innerHTML = `<span class="listing-badge is-ending">${endsLabel(listing.expiresAt)}</span>`;
  }
  if (badges.childElementCount) thumb.append(badges);

  if (listing.stattrak) {
    const st = document.createElement('span');
    st.className = 'listing-stattrak';
    st.textContent = 'StatTrak™';
    thumb.append(st);
  }

  // Seller row at the foot of the card.
  const seller = document.createElement('div');
  seller.className = 'listing-seller';
  seller.innerHTML =
    identicon(listing.seller.id) +
    '<span class="listing-seller-meta">' +
    `<span class="listing-seller-name"></span>` +
    `<span class="listing-seller-rating">${starsMarkup(listing.seller.rating)}<span class="listing-rating-num">${listing.seller.rating.toFixed(1)}</span></span>` +
    '</span>';
  seller.querySelector('.listing-seller-name').textContent = listing.seller.name;
  card.append(seller);

  return card;
}

/* --------------------------------------------------------------- filtering */

function matches(listing) {
  if (state.rarities.size && !state.rarities.has(listing.rarity)) return false;
  if (state.rarity !== 'all' && listing.rarity !== state.rarity) return false;
  if (state.wears.size && !state.wears.has(listing.condition)) return false;
  if (state.categories.size && !state.categories.has(categoryOf(listing.weapon))) return false;
  if (state.stattrakOnly && !listing.stattrak) return false;
  if (state.ratingMin && listing.seller.rating < state.ratingMin) return false;
  if (state.priceMin && listing.price < state.priceMin) return false;
  if (state.priceMax && listing.price > state.priceMax) return false;
  if (state.q) {
    const q = state.q.trim().toLowerCase();
    if (q && !`${listing.weapon} ${listing.finish} ${listing.condition}`.toLowerCase().includes(q)) return false;
  }
  return true;
}

const featuredIndex = new Map(SKINS.map((s, i) => [s.id, i]));

function filtered() {
  const rows = getListings().filter(matches);
  const byName = (a, b) =>
    `${a.weapon} ${a.finish}`.localeCompare(`${b.weapon} ${b.finish}`);
  const sorters = {
    featured: (a, b) => (featuredIndex.get(a.catalogueId) ?? 99) - (featuredIndex.get(b.catalogueId) ?? 99) || b.createdAt - a.createdAt,
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
    name: byName,
  };
  return [...rows].sort(sorters[state.sort] || sorters.featured);
}

/* --------------------------------------------------------------- rendering */

function emptyMarkup() {
  const anyFilters = state.rarities.size || state.categories.size || state.wears.size || state.stattrakOnly || state.ratingMin || state.priceMin || state.priceMax || state.q || state.rarity !== 'all';
  return anyFilters
    ? '<span class="empty-mark" aria-hidden="true">⌕</span>' +
        '<p class="empty-title">No listings match those filters</p>' +
        '<p class="empty-copy">Try clearing a filter or widening the price range.</p>' +
        '<button class="btn btn-ghost" type="button" data-market-reset>Clear all filters</button>'
    : '<span class="empty-mark" aria-hidden="true">✦</span>' +
        '<p class="empty-title">Nothing is listed right now</p>' +
        '<p class="empty-copy">Check back soon, or list something of your own.</p>';
}

function renderGrid() {
  if (!els?.grid) return;
  const list = filtered();
  const virtual = list.length > VIRTUAL_THRESHOLD;
  els.grid.classList.toggle('is-virtual', virtual);

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = emptyMarkup();
    els.grid.replaceChildren(empty);
    els.count && (els.count.textContent = '0 listings');
    return;
  }

  els.count && (els.count.textContent = `${list.length} listing${list.length === 1 ? '' : 's'}`);

  if (!virtual) {
    els.grid.style.removeProperty('grid-auto-rows');
    els.grid.replaceChildren(...list.map(createListingCard));
    hydrateCrystalIcons(els.grid);
    return;
  }

  measure(list[0]);
  renderWindow(list);
  hydrateCrystalIcons(els.grid);
}

/** Measure the grid geometry once per render pass (cheap; one probe card). */
function measure(sample) {
  const probe = createListingCard(sample);
  probe.classList.add('market-probe');
  probe.setAttribute('aria-hidden', 'true');
  els.grid.append(probe);
  const styles = getComputedStyle(els.grid);
  const cols = Math.max(1, styles.gridTemplateColumns.split(' ').filter(Boolean).length);
  const rect = probe.getBoundingClientRect();
  const rowGap = Number.parseFloat(styles.rowGap) || 0;
  const cardHeight = Math.max(80, rect.height);
  probe.remove();
  els.grid.style.setProperty('grid-auto-rows', `${cardHeight}px`);
  lastWidth = els.grid.getBoundingClientRect().width;
  layout = {
    cols,
    rowHeight: cardHeight + rowGap,
    gridTop: els.grid.getBoundingClientRect().top + window.scrollY,
  };
}

function renderWindow(list) {
  if (!layout) return;
  const { cols, rowHeight, gridTop } = layout;
  const totalRows = Math.ceil(list.length / cols);
  const viewport = window.innerHeight || 800;
  const scrolled = Math.max(0, window.scrollY - gridTop);
  const firstRow = Math.max(0, Math.floor(scrolled / rowHeight) - WINDOW_BUFFER);
  const rowsOnScreen = Math.ceil(viewport / rowHeight) + WINDOW_BUFFER * 2;
  const lastRow = Math.min(totalRows, firstRow + rowsOnScreen);

  const start = firstRow * cols;
  const end = Math.min(list.length, lastRow * cols);

  const frag = document.createDocumentFragment();

  const top = document.createElement('div');
  top.className = 'market-spacer';
  top.style.height = `${firstRow * rowHeight}px`;
  if (firstRow > 0) frag.append(top);

  list.slice(start, end).forEach((listing) => frag.append(createListingCard(listing)));

  const bottomRows = totalRows - lastRow;
  if (bottomRows > 0) {
    const bottom = document.createElement('div');
    bottom.className = 'market-spacer';
    bottom.style.height = `${bottomRows * rowHeight}px`;
    frag.append(bottom);
  }

  els.grid.replaceChildren(frag);
}

function onScroll() {
  if (!layout || !els?.grid.classList.contains('is-virtual')) return;
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (els.grid.offsetParent === null) return; // market view hidden
    renderWindow(filtered());
  });
}

/* ------------------------------------------------------------------ filters */

const chip = (label, value, group, color = null) =>
  `<button class="mf-chip" type="button" data-mf-chip="${value}" data-mf-group="${group}"${color ? ` style="--chip:${color}"` : ''}>${label}</button>`;

function buildDrawer() {
  if (!els.drawer) return;
  const max = maxPriceOf();
  if (!state.priceMax) state.priceMax = max;
  els.drawer.innerHTML = `
    <div class="mf-head">
      <span class="mf-title">Filters</span>
      <button class="mf-close" type="button" data-mf-close aria-label="Close filters">✕</button>
    </div>
    <div class="mf-group">
      <p class="mf-label">Price (Crystals)</p>
      <div class="mf-range">
        <input type="range" min="0" max="${max}" step="10" value="${state.priceMin}" data-mf-price-min aria-label="Minimum price" />
        <input type="range" min="0" max="${max}" step="10" value="${state.priceMax}" data-mf-price-max aria-label="Maximum price" />
      </div>
      <div class="mf-range-labels"><span data-mf-price-min-label>0</span><span data-mf-price-max-label>${formatCrystals(state.priceMax)}</span></div>
    </div>
    <div class="mf-group">
      <p class="mf-label">Rarity</p>
      <div class="mf-chips">${RARITY_ORDER.map((r) => chip(r, r, 'rarities', RARITIES[r])).join('')}</div>
    </div>
    <div class="mf-group">
      <p class="mf-label">Weapon</p>
      <div class="mf-chips">${CATEGORIES.map((c) => chip(c.label, c.id, 'categories')).join('')}</div>
    </div>
    <div class="mf-group">
      <p class="mf-label">Wear</p>
      <div class="mf-chips">${WEAR_ORDER.map((w) => chip(w, w, 'wears')).join('')}</div>
    </div>
    <div class="mf-group">
      <p class="mf-label">Special</p>
      <div class="mf-chips">
        <button class="mf-chip" type="button" data-mf-toggle="stattrakOnly">StatTrak only</button>
      </div>
    </div>
    <div class="mf-group">
      <p class="mf-label">Seller rating</p>
      <div class="mf-chips" data-mf-rating>
        ${[0, 3, 3.5, 4, 4.5, 5].map((v) => `<button class="mf-chip" type="button" data-mf-rating-val="${v}">${v === 0 ? 'Any' : `${v}★+`}</button>`).join('')}
      </div>
    </div>
    <button class="btn btn-ghost mf-clear" type="button" data-mf-clear>Clear all</button>`;
}

function syncDrawer() {
  if (!els?.drawer) return;
  els.drawer.querySelectorAll('[data-mf-chip]').forEach((el) => {
    const on = state[el.dataset.mfGroup]?.has(el.dataset.mfChip);
    el.classList.toggle('is-active', Boolean(on));
    el.setAttribute('aria-pressed', String(Boolean(on)));
  });
  els.drawer.querySelectorAll('[data-mf-toggle]').forEach((el) => {
    const on = Boolean(state[el.dataset.mfToggle]);
    el.classList.toggle('is-active', on);
    el.setAttribute('aria-pressed', String(on));
  });
  els.drawer.querySelectorAll('[data-mf-rating-val]').forEach((el) => {
    const on = Number(el.dataset.mfRatingVal) === state.ratingMin;
    el.classList.toggle('is-active', on);
  });
  const min = els.drawer.querySelector('[data-mf-price-min]');
  const max = els.drawer.querySelector('[data-mf-price-max]');
  if (min) min.value = String(state.priceMin);
  if (max) max.value = String(state.priceMax);
  const minLabel = els.drawer.querySelector('[data-mf-price-min-label]');
  const maxLabel = els.drawer.querySelector('[data-mf-price-max-label]');
  if (minLabel) minLabel.textContent = formatCrystals(state.priceMin);
  if (maxLabel) maxLabel.textContent = formatCrystals(state.priceMax);
}

function activeFilterCount() {
  let n = 0;
  n += state.rarities.size;
  n += state.categories.size;
  n += state.wears.size;
  if (state.stattrakOnly) n += 1;
  if (state.ratingMin) n += 1;
  if (state.priceMin || (state.priceMax && state.priceMax < maxPriceOf())) n += 1;
  if (state.rarity !== 'all') n += 1;
  return n;
}

function syncFilterBadge() {
  const count = activeFilterCount();
  if (!els.filterCount) return;
  els.filterCount.hidden = count === 0;
  els.filterCount.textContent = String(count);
}

/* -------------------------------------------------- URL + storage syncing */

function syncUrl() {
  try {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.sort !== 'featured') params.set('sort', state.sort);
    if (state.rarity !== 'all') params.set('rar', state.rarity);
    if (state.rarities.size) params.set('r', [...state.rarities].join(','));
    if (state.categories.size) params.set('c', [...state.categories].join(','));
    if (state.wears.size) params.set('w', [...state.wears].join(','));
    if (state.stattrakOnly) params.set('st', '1');
    if (state.ratingMin) params.set('rt', String(state.ratingMin));
    if (state.priceMin) params.set('pmin', String(state.priceMin));
    if (state.priceMax && state.priceMax < maxPriceOf()) params.set('pmax', String(state.priceMax));
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
    window.history.replaceState(null, '', url);
  } catch {
    /* history unavailable */
  }
  writeJson(FILTERS_KEY, serialise());
}

function serialise() {
  return {
    q: state.q,
    sort: state.sort,
    rarity: state.rarity,
    rarities: [...state.rarities],
    categories: [...state.categories],
    wears: [...state.wears],
    stattrakOnly: state.stattrakOnly,
    ratingMin: state.ratingMin,
    priceMin: state.priceMin,
    priceMax: state.priceMax,
  };
}

function apply(partial) {
  Object.assign(state, partial);
  renderGrid();
  syncDrawer();
  syncFilterBadge();
  syncUrl();
}

function restore() {
  // URL first (shareable), then the last-used persisted state as a fallback.
  let saved = null;
  try {
    const params = new URLSearchParams(window.location.search);
    if ([...params.keys()].length) {
      saved = {
        q: params.get('q') || '',
        sort: params.get('sort') || 'featured',
        rarity: params.get('rar') || 'all',
        rarities: new Set((params.get('r') || '').split(',').filter(Boolean)),
        categories: new Set((params.get('c') || '').split(',').filter(Boolean)),
        wears: new Set((params.get('w') || '').split(',').filter(Boolean)),
        stattrakOnly: params.get('st') === '1',
        ratingMin: Number(params.get('rt')) || 0,
        priceMin: Number(params.get('pmin')) || 0,
        priceMax: Number(params.get('pmax')) || 0,
      };
    }
  } catch {
    saved = null;
  }
  if (!saved) saved = readJson(FILTERS_KEY, null);
  if (!saved) return;
  state.q = saved.q || '';
  state.sort = saved.sort || 'featured';
  state.rarity = saved.rarity || 'all';
  state.rarities = new Set(saved.rarities || []);
  state.categories = new Set(saved.categories || []);
  state.wears = new Set(saved.wears || []);
  state.stattrakOnly = Boolean(saved.stattrakOnly);
  state.ratingMin = Number(saved.ratingMin) || 0;
  state.priceMin = Number(saved.priceMin) || 0;
  // Keep the computed ceiling when nothing narrower was saved.
  if (Number(saved.priceMax) > 0) state.priceMax = Number(saved.priceMax);

  // Reflect restored state in the toolbar controls.
  if (els?.search) els.search.value = state.q;
  if (els?.rarity) els.rarity.value = state.rarity;
  if (els?.sort) els.sort.value = state.sort;
}

/* ------------------------------------------------------------------- drawer UI */

function setDrawer(open) {
  if (!els?.drawer) return;
  // The class drives visibility *and* motion, so the drawer can transition.
  els.drawer.hidden = false;
  els.drawer.classList.toggle('is-open', open);
  els.toggle?.setAttribute('aria-expanded', String(open));
}

/* --------------------------------------------------------------- mutations UI */

function debounced(fn, ms = 200) {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(fn, ms);
}

function wire() {
  // Toolbar (search / rarity / sort) is owned by marketFilters.js.
  initMarketToolbar({
    onSearch: (value) => debounced(() => apply({ q: value })),
    onRarity: (value) => apply({ rarity: value }),
    onSort: (value) => apply({ sort: value }),
  });

  els.toggle?.addEventListener('click', () => setDrawer(!els.drawer.classList.contains('is-open')));
  els.drawer?.addEventListener('click', (event) => {
    if (event.target.closest('[data-mf-close]')) return setDrawer(false);
    if (event.target.closest('[data-mf-clear]')) return clearAll();
    const rating = event.target.closest('[data-mf-rating-val]');
    if (rating) return apply({ ratingMin: Number(rating.dataset.mfRatingVal) });
    const toggle = event.target.closest('[data-mf-toggle]');
    if (toggle) return apply({ [toggle.dataset.mfToggle]: !state[toggle.dataset.mfToggle] });
    const chipEl = event.target.closest('[data-mf-chip]');
    if (chipEl) {
      const bucket = chipEl.dataset.mfGroup;
      const value = chipEl.dataset.mfChip;
      if (state[bucket].has(value)) state[bucket].delete(value);
      else state[bucket].add(value);
      return apply({});
    }
    return undefined;
  });

  // Price range: debounced 200ms so dragging does not thrash the grid.
  els.drawer?.addEventListener('input', (event) => {
    const el = event.target;
    if (el.matches('[data-mf-price-min]')) {
      const value = Math.min(Number(el.value), state.priceMax - 10);
      el.value = String(value);
      state.priceMin = Math.max(0, value);
      els.drawer.querySelector('[data-mf-price-min-label]').textContent = formatCrystals(state.priceMin);
      debounced(() => apply({}));
    } else if (el.matches('[data-mf-price-max]')) {
      const value = Math.max(Number(el.value), state.priceMin + 10);
      el.value = String(value);
      state.priceMax = value;
      els.drawer.querySelector('[data-mf-price-max-label]').textContent = formatCrystals(state.priceMax);
      debounced(() => apply({}));
    }
  });

  // Grid: click a card to open the buy modal; reset button on the empty state.
  els.grid?.addEventListener('click', (event) => {
    if (event.target.closest('[data-market-reset]')) return clearAll();
    const card = event.target.closest('.listing-card');
    if (card) openBuyModal(card.dataset.listingId);
    return undefined;
  });
  els.grid?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.listing-card');
    if (!card) return;
    event.preventDefault();
    openBuyModal(card.dataset.listingId);
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    layout = null;
    renderGrid();
  });

  if ('ResizeObserver' in window) {
    // Only react to width changes: re-rendering on height changes (which our
    // own spacers cause) would loop.
    ro = new ResizeObserver((entries) => {
      if (!els.grid.classList.contains('is-virtual')) return;
      const width = entries[0]?.contentRect?.width;
      if (!width || Math.abs(width - lastWidth) < 1) return;
      layout = null;
      renderGrid();
    });
    ro.observe(els.grid);
  }
}

function clearAll() {
  state.q = '';
  state.sort = 'featured';
  state.rarity = 'all';
  state.rarities.clear();
  state.categories.clear();
  state.wears.clear();
  state.stattrakOnly = false;
  state.ratingMin = 0;
  state.priceMin = 0;
  state.priceMax = maxPriceOf();
  if (els?.search) els.search.value = '';
  if (els?.rarity) els.rarity.value = 'all';
  if (els?.sort) els.sort.value = 'featured';
  renderGrid();
  syncDrawer();
  syncFilterBadge();
  syncUrl();
}

/* --------------------------------------------------------------------- init */

export function initMarketplace() {
  const grid = document.querySelector('[data-market-grid]');
  if (!grid || grid.dataset.marketReady === '1') return;
  grid.dataset.marketReady = '1';

  els = {
    grid,
    count: document.querySelector('[data-market-count]'),
    search: document.querySelector('[data-filter-search]'),
    rarity: document.querySelector('[data-filter-rarity]'),
    sort: document.querySelector('[data-filter-sort]'),
    toggle: document.querySelector('[data-market-filter-toggle]'),
    filterCount: document.querySelector('[data-market-filter-count]'),
    drawer: document.querySelector('[data-market-filters]'),
  };

  ensureMe();
  buildDrawer();
  restore();
  wire();
  renderGrid();
  syncDrawer();
  syncFilterBadge();
  initMyListings();

  // React to inventory changes (a listed item gets an isListed flag) and to
  // market mutations from any of the sell/buy/cancel flows.
  onInventoryChange(() => refreshMyListings());
  onMarketChange(() => {
    refreshMyListings();
  });

  return {
    render: renderGrid,
    openFilters: () => setDrawer(true),
  };
}

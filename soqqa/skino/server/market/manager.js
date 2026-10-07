/* ============================================================================
   BLAZZER — marketplace manager (Stage 3.2)
   The only place a market listing is created, sold, cancelled or re-priced.
   Every mutation that moves value or ownership runs inside the project's
   pessimistic item/user locks (server/utils/locking.js) and re-reads the
   listing, the item and the wallet *inside* the lock, so a racing buyer or a
   cancel-during-purchase can never double-spend or half-settle.

   A purchase settles four things in one critical section:

     buyer  : -price
     seller : +price - fee
     system : +fee                      (a tracked platform account)
     listing: active -> sold, item -> buyer (isListed cleared, provenance kept)

   Errors are thrown as { status, message } and mapped straight to HTTP codes.
   ========================================================================= */

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { marketStore, STARTER_WALLET } from './store.js';
import { suggestPrice } from './pricing.js';
import { inventoryStore } from '../inventory/store.js';
import { isTradeLocked } from '../inventory/manager.js';
import { logTransfer, TRANSFER_REASONS } from '../utils/audit.js';
import { withLocks } from '../utils/locking.js';

/** Platform account that accrues the 7% commission. */
export const SYSTEM_ACCOUNT = '__platform__';

export const COMMISSION = config.market.commission;

/** The durations a seller may choose, in milliseconds. */
export const LISTING_DURATIONS = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const MAX_PAGE_SIZE = config.market.maxPageSize;
const MAX_ACTIVE_LISTINGS = 50; // per seller

const WEAR = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];

/** Weapon buckets — mirror of the client's filter categories. */
const CATEGORIES = [
  { id: 'rifles', test: (w) => /^(AK-47|M4A4|M4A1-S|Galil|FAMAS|SG 553|AUG)/.test(w) },
  { id: 'snipers', test: (w) => /^(AWP|SSG 08|SCAR-20|G3SG1)/.test(w) },
  { id: 'pistols', test: (w) => /^(Desert Eagle|USP-S|Glock-18|P250|Five-SeveN|Tec-9|CZ75|P2000|R8)/.test(w) },
  { id: 'smgs', test: (w) => /^(MP9|MAC-10|UMP-45|P90|MP7|MP5)/.test(w) },
  { id: 'knives', test: (w) => w.startsWith('★') && !/Gloves/.test(w) },
  { id: 'gloves', test: (w) => /Gloves/.test(w) },
];

export function categoryOf(weapon = '') {
  const hit = CATEGORIES.find((c) => c.test(weapon));
  return hit ? hit.id : 'other';
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/* ----------------------------------------------------------------- wallets */

/** The demo balance for a user, seeded on first touch. */
async function walletOf(userId) {
  const stored = await marketStore().getWallet(userId);
  if (stored !== null) return stored;
  await marketStore().setWallet(userId, STARTER_WALLET);
  return STARTER_WALLET;
}

async function credit(userId, amount) {
  const next = (await walletOf(userId)) + amount;
  await marketStore().setWallet(userId, next);
  return next;
}

/* ------------------------------------------------------------------ listing */

/** Mark every active-but-expired listing expired and free its item. */
async function expireStale() {
  let active = [];
  try {
    active = await marketStore().listListings('active');
  } catch {
    return;
  }
  const now = Date.now();
  for (const listing of active) {
    if (listing.expiresAt > now) continue;
    await withLocks([`listing:${listing.id}`, `item:${listing.itemId}`], async () => {
      const fresh = await marketStore().getListing(listing.id);
      if (!fresh || fresh.status !== 'active' || fresh.expiresAt > Date.now()) return;
      fresh.status = 'expired';
      await marketStore().putListing(fresh);
      const item = await inventoryStore().getItem(fresh.itemId);
      if (item && item.userId === fresh.sellerId && item.isListed) {
        item.isListed = false;
        item.price = null;
        item.updatedAt = Date.now();
        await inventoryStore().saveItem(item);
      }
    });
  }
}

/** Public projection of a listing (never leaks internal wallet state). */
export function publicListing(listing) {
  if (!listing) return null;
  return {
    id: listing.id,
    itemId: listing.itemId,
    catalogueId: listing.catalogueId,
    sellerId: listing.sellerId,
    seller: listing.seller,
    price: listing.price,
    fee: listing.fee,
    payout: listing.payout,
    status: listing.status,
    createdAt: listing.createdAt,
    expiresAt: listing.expiresAt,
    soldAt: listing.soldAt ?? null,
    weapon: listing.weapon,
    finish: listing.finish,
    condition: listing.condition,
    rarity: listing.rarity,
    stattrak: Boolean(listing.stattrak),
    floatValue: listing.floatValue ?? null,
    stickers: listing.stickers || [],
    fairProof: listing.fairProof ?? null,
  };
}

function matches(listing, filters, q) {
  if (filters.rarities?.length && !filters.rarities.includes(listing.rarity)) return false;
  if (filters.wears?.length && !filters.wears.includes(listing.condition)) return false;
  if (filters.categories?.length && !filters.categories.includes(categoryOf(listing.weapon))) return false;
  if (filters.stattrakOnly && !listing.stattrak) return false;
  if (Number.isFinite(filters.priceMin) && listing.price < filters.priceMin) return false;
  if (Number.isFinite(filters.priceMax) && listing.price > filters.priceMax) return false;
  if (Number.isFinite(filters.ratingMin) && (listing.seller?.rating ?? 0) < filters.ratingMin) return false;
  if (q && !`${listing.weapon} ${listing.finish} ${listing.condition}`.toLowerCase().includes(q)) return false;
  return true;
}

const SORTERS = {
  newest: (a, b) => b.createdAt - a.createdAt,
  'price-asc': (a, b) => a.price - b.price,
  'price-desc': (a, b) => b.price - a.price,
  'ending-soon': (a, b) => a.expiresAt - b.expiresAt,
  rating: (a, b) => (b.seller?.rating ?? 0) - (a.seller?.rating ?? 0),
};

/**
 * Browse active listings with filters + pagination.
 *
 * @param {{filters?:object, sort?:string, q?:string, page?:number, pageSize?:number, sellerId?:string}} opts
 */
export async function browse({
  filters = {},
  sort = 'newest',
  q = '',
  page = 1,
  pageSize = 24,
  sellerId = null,
} = {}) {
  await expireStale();
  const all = await marketStore().listListings('active');
  const query = String(q || '').trim().toLowerCase();
  let rows = all.filter((listing) => matches(listing, filters, query));
  if (sellerId) rows = rows.filter((listing) => listing.sellerId === sellerId);

  rows.sort(SORTERS[sort] || SORTERS.newest);

  const size = Math.min(Math.max(Number(pageSize) || 24, 1), MAX_PAGE_SIZE);
  const current = Math.max(Number(page) || 1, 1);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);

  return {
    listings: slice.map(publicListing),
    total: rows.length,
    page: current,
    pageSize: size,
    hasMore: start + size < rows.length,
  };
}

/** One listing's detail, refreshing expiry first. */
export async function getListing(id) {
  await expireStale();
  const listing = await marketStore().getListing(id);
  return publicListing(listing);
}

/** A seller's own active listings. */
export async function myListings(sellerId) {
  await expireStale();
  const all = await marketStore().listListings('active');
  return all
    .filter((listing) => listing.sellerId === sellerId)
    .sort((a, b) => a.expiresAt - b.expiresAt)
    .map(publicListing);
}

/**
 * Put one owned item up for sale.
 *
 * @param {object} input
 * @param {string} input.sellerId
 * @param {string} input.itemId        inventory item uid
 * @param {number} input.price
 * @param {string} input.duration      one of LISTING_DURATIONS
 * @param {object} [input.meta]        catalogue metadata (weapon, finish, …)
 */
export async function list({ sellerId, itemId, price, duration = '24h', meta = {}, seller = null }) {
  const value = Math.round(Number(price));
  if (!Number.isFinite(value) || value < config.market.minPrice || value > config.market.maxPrice) {
    throw httpError(422, `Price must be between ${config.market.minPrice} and ${config.market.maxPrice}`);
  }
  const durationMs = LISTING_DURATIONS[duration];
  if (!durationMs) throw httpError(422, 'Unknown listing duration');

  return withLocks([`user:${sellerId}`, `item:${itemId}`], async () => {
    const active = await marketStore().listListings('active');
    if (active.filter((l) => l.sellerId === sellerId).length >= MAX_ACTIVE_LISTINGS) {
      throw httpError(409, `You can have at most ${MAX_ACTIVE_LISTINGS} active listings`);
    }

    const item = await inventoryStore().getItem(itemId);
    if (!item || item.userId !== sellerId) throw httpError(404, 'Item not found');
    if (item.isListed) throw httpError(409, 'Item is already listed');
    if (isTradeLocked(item)) throw httpError(409, 'Item is trade-locked');

    const now = Date.now();
    const fee = Math.round(value * COMMISSION);
    const listing = {
      id: `m_${randomUUID()}`,
      itemId,
      catalogueId: meta.catalogueId || item.itemId,
      sellerId,
      seller: seller || { id: sellerId, name: 'You', rating: 5, sales: 0 },
      price: value,
      fee,
      payout: value - fee,
      status: 'active',
      createdAt: now,
      expiresAt: now + durationMs,
      buyerId: null,
      soldAt: null,
      weapon: meta.weapon || '',
      finish: meta.finish || '',
      condition: meta.condition || '',
      rarity: meta.rarity || 'Consumer',
      stattrak: Boolean(item.stattrak),
      floatValue: item.floatValue ?? null,
      stickers: Array.isArray(item.stickers) ? item.stickers : [],
      fairProof: item.fairProof ?? null,
    };

    await marketStore().putListing(listing);
    item.isListed = true;
    item.price = value;
    item.updatedAt = now;
    await inventoryStore().saveItem(item);
    return publicListing(listing);
  });
}

/**
 * Purchase a listing. Atomic; idempotent when `idempotencyKey` is supplied.
 */
export async function buy({ buyerId, listingId, idempotencyKey = null }) {
  const preview = await marketStore().getListing(listingId);
  if (!preview) throw httpError(404, 'Listing not found');

  const key = idempotencyKey ? `buy:${buyerId}:${idempotencyKey}` : null;
  if (key) {
    const cached = await marketStore().getIdempotency(key);
    if (cached) return cached;
  }

  return withLocks(
    [`listing:${listingId}`, `item:${preview.itemId}`, `user:${buyerId}`, `user:${preview.sellerId}`],
    async () => {
      if (key) {
        const cached = await marketStore().getIdempotency(key);
        if (cached) return cached;
      }

      const listing = await marketStore().getListing(listingId);
      if (!listing) throw httpError(404, 'Listing not found');
      if (listing.status === 'sold') throw httpError(409, 'This listing was already sold');
      if (listing.status !== 'active') throw httpError(409, 'This listing is no longer available');
      if (listing.expiresAt <= Date.now()) {
        listing.status = 'expired';
        await marketStore().putListing(listing);
        throw httpError(410, 'This listing has expired');
      }
      if (listing.sellerId === buyerId) throw httpError(403, 'You cannot buy your own listing');

      const item = await inventoryStore().getItem(listing.itemId);
      if (!item || item.userId !== listing.sellerId) {
        listing.status = 'cancelled';
        await marketStore().putListing(listing);
        throw httpError(409, 'This item is no longer available');
      }

      const balance = await walletOf(buyerId);
      if (balance < listing.price) {
        throw httpError(402, 'Insufficient Crystals');
      }

      // ---- settle ----------------------------------------------------------
      await marketStore().setWallet(buyerId, balance - listing.price);
      await credit(listing.sellerId, listing.payout);
      await credit(SYSTEM_ACCOUNT, listing.fee);

      item.userId = buyerId;
      item.isListed = false;
      item.price = null;
      item.updatedAt = Date.now();
      await inventoryStore().saveItem(item);

      listing.status = 'sold';
      listing.buyerId = buyerId;
      listing.soldAt = Date.now();
      await marketStore().putListing(listing);

      await marketStore().appendSale({
        itemId: listing.catalogueId,
        listingId,
        price: listing.price,
        at: listing.soldAt,
      });

      await logTransfer({
        itemId: listing.itemId,
        fromUserId: listing.sellerId,
        toUserId: buyerId,
        reason: TRANSFER_REASONS.BUY,
        meta: { listingId, price: listing.price, fee: listing.fee, payout: listing.payout },
      });

      const result = {
        ok: true,
        listing: publicListing(listing),
        itemId: listing.itemId,
        catalogueId: listing.catalogueId,
        price: listing.price,
        fee: listing.fee,
        payout: listing.payout,
        balance: balance - listing.price,
      };
      if (key) await marketStore().putIdempotency(key, result);
      return result;
    }
  );
}

/** Cancel one of the caller's own listings. */
export async function cancel({ sellerId, listingId }) {
  const preview = await marketStore().getListing(listingId);
  if (!preview) throw httpError(404, 'Listing not found');

  return withLocks([`listing:${listingId}`, `item:${preview.itemId}`], async () => {
    const listing = await marketStore().getListing(listingId);
    if (!listing || listing.sellerId !== sellerId) throw httpError(404, 'Listing not found');
    if (listing.status !== 'active') throw httpError(409, 'This listing is not active');

    listing.status = 'cancelled';
    await marketStore().putListing(listing);

    const item = await inventoryStore().getItem(listing.itemId);
    if (item && item.userId === sellerId && item.isListed) {
      item.isListed = false;
      item.price = null;
      item.updatedAt = Date.now();
      await inventoryStore().saveItem(item);
    }
    return { ok: true, id: listing.id };
  });
}

/** Re-price an active listing the caller owns. */
export async function edit({ sellerId, listingId, price }) {
  const value = Math.round(Number(price));
  if (!Number.isFinite(value) || value < config.market.minPrice || value > config.market.maxPrice) {
    throw httpError(422, `Price must be between ${config.market.minPrice} and ${config.market.maxPrice}`);
  }
  return withLocks([`listing:${listingId}`], async () => {
    const listing = await marketStore().getListing(listingId);
    if (!listing || listing.sellerId !== sellerId) throw httpError(404, 'Listing not found');
    if (listing.status !== 'active') throw httpError(409, 'This listing is not active');
    listing.price = value;
    listing.fee = Math.round(value * COMMISSION);
    listing.payout = value - listing.fee;
    await marketStore().putListing(listing);

    const item = await inventoryStore().getItem(listing.itemId);
    if (item && item.userId === sellerId && item.isListed) {
      item.price = value;
      item.updatedAt = Date.now();
      await inventoryStore().saveItem(item);
    }
    return publicListing(listing);
  });
}

/** Suggested price for a catalogue item, plus the seller's current balance. */
export async function suggest({ catalogueId, value = 0 }) {
  return suggestPrice(catalogueId, value);
}

/** The caller's demo wallet balance (used by the buy confirmation). */
export async function balanceOf(userId) {
  return walletOf(userId);
}

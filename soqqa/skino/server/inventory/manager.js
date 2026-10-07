/* ============================================================================
   BLAZZER — inventory manager
   The only place that mutates owned items. Every write goes through a lock,
   re-checks ownership at the point of mutation, and leaves an audit trail.
   Item instances (one row = one physical skin) are what make trading, gifting
   and upgrading possible later.

   Errors are thrown as { status, message } so the route layer can map them to
   HTTP codes without guessing.
   ========================================================================= */

import { randomUUID } from 'node:crypto';
import { inventoryStore } from './store.js';
import { logTransfer, TRANSFER_REASONS } from '../utils/audit.js';
import { withLocks } from '../utils/locking.js';

/** Items received via trade/gift stay locked for 7 days (anti-fraud). */
export const TRADE_LOCK_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard ceiling on items per side of a trade. */
export const MAX_TRADE_ITEMS = 20;

const SORTS = {
  newest: (a, b) => b.obtainedAt - a.obtainedAt || (a.id < b.id ? 1 : -1),
  oldest: (a, b) => a.obtainedAt - b.obtainedAt || (a.id < b.id ? -1 : 1),
  'value-desc': (a, b) => (b.value || 0) - (a.value || 0) || b.obtainedAt - a.obtainedAt,
  'value-asc': (a, b) => (a.value || 0) - (b.value || 0) || b.obtainedAt - a.obtainedAt,
};

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** True while an item is still inside its 7-day post-trade lock window. */
export function isTradeLocked(item) {
  if (!item) return false;
  if (!item.tradeLocked) return false;
  if (item.tradeLockedUntil && item.tradeLockedUntil <= Date.now()) return false;
  return true;
}

/** An item can only leave the inventory if it is neither listed nor locked. */
export function isTransferable(item) {
  return Boolean(item) && !item.isListed && !isTradeLocked(item);
}

/**
 * List a user's inventory, newest-first by default, with cursor pagination.
 *
 * @param {string} userId
 * @param {{limit?:number, cursor?:string|null, sort?:string}} [opts]
 * @returns {Promise<{items:object[], count:number, nextCursor:string|null}>}
 */
export async function listInventory(userId, { limit = 50, cursor = null, sort = 'newest' } = {}) {
  const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const all = await inventoryStore().listItemsByUser(userId);
  const sorted = all.sort(SORTS[sort] || SORTS.newest);

  let start = 0;
  if (cursor) {
    const index = sorted.findIndex((item) => item.id === cursor);
    if (index >= 0) start = index + 1;
  }
  const slice = sorted.slice(start, start + size);
  const nextCursor = start + size < sorted.length ? slice[slice.length - 1]?.id ?? null : null;
  return { items: slice, count: sorted.length, nextCursor };
}

/** Fetch one owned item, or null when it is not the caller's. */
export async function getItem(userId, id) {
  const item = await inventoryStore().getItem(id);
  if (!item || item.userId !== userId) return null;
  return item;
}

/**
 * Grant one item to a user (games, purchases, trades, gifts all funnel here).
 *
 * @param {string} userId
 * @param {object} input
 * @param {string} input.itemId       catalogue skin id
 * @param {number} [input.value]      catalogue value snapshot
 * @param {string} [input.obtainedVia]
 * @param {boolean} [input.stattrak]
 * @param {number|null} [input.floatValue]
 * @param {object|null} [input.fairProof]
 * @param {string|null} [input.ip]
 */
export async function grantItem(userId, input = {}) {
  const itemId = String(input.itemId || '').trim();
  if (!itemId) throw httpError(422, 'itemId is required');

  const now = Date.now();
  const item = {
    id: `i_${randomUUID()}`,
    userId,
    itemId,
    value: Math.max(0, Math.round(Number(input.value) || 0)),
    obtainedAt: now,
    obtainedVia: input.obtainedVia || 'purchase',
    stickers: [],
    stattrak: Boolean(input.stattrak),
    floatValue: Number.isFinite(input.floatValue) ? input.floatValue : null,
    isListed: false,
    price: null,
    tradeLocked: false,
    tradeLockedUntil: null,
    fairProof: input.fairProof || null,
    createdAt: now,
    updatedAt: now,
  };

  return withLocks([`user:${userId}`, `item:${item.id}`], async () => {
    await inventoryStore().saveItem(item);
    await logTransfer({
      itemId: item.id,
      fromUserId: null,
      toUserId: userId,
      reason: TRANSFER_REASONS.GRANT,
      ip: input.ip || null,
      meta: { itemId, obtainedVia: item.obtainedVia },
    });
    return item;
  });
}

/**
 * Remove one item from a user's inventory. Refuses when the item is listed or
 * still trade-locked. Ownership is re-checked *inside* the lock so a racing
 * transfer cannot slip through.
 */
export async function removeItem(userId, { id, ip = null, reason = TRANSFER_REASONS.REMOVE } = {}) {
  if (!id) throw httpError(422, 'id is required');

  return withLocks([`user:${userId}`, `item:${id}`], async () => {
    const item = await inventoryStore().getItem(id);
    if (!item || item.userId !== userId) throw httpError(404, 'Item not found');
    if (item.isListed) throw httpError(409, 'Item is listed for sale');
    if (isTradeLocked(item)) throw httpError(409, 'Item is trade-locked');

    await inventoryStore().deleteItem(id);
    await logTransfer({
      itemId: id,
      fromUserId: userId,
      toUserId: null,
      reason,
      ip,
      meta: { itemId: item.itemId },
    });
    return item;
  });
}

/** Collapse instances into `{ itemId, qty, value }` stacks for the UI. */
export async function stackInventory(userId) {
  const items = await inventoryStore().listItemsByUser(userId);
  const stacks = new Map();
  for (const item of items) {
    const entry = stacks.get(item.itemId) || { itemId: item.itemId, qty: 0, value: 0 };
    entry.qty += 1;
    entry.value += item.value || 0;
    stacks.set(item.itemId, entry);
  }
  return [...stacks.values()];
}

/** Total Crystals value of a user's inventory (sum of value snapshots). */
export async function inventoryValue(userId) {
  const items = await inventoryStore().listItemsByUser(userId);
  return items.reduce((sum, item) => sum + (item.value || 0), 0);
}

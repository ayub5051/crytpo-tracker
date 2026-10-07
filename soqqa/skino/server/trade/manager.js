/* ============================================================================
   BLAZZER — trade manager (Stage 3.3)
   Peer-to-peer item swaps. No currency changes hands — only items move.

   Lifecycle:
     create    -> pending (initiator's items pre-filled)
     receiver  -> claims a side by opening the link
     confirm   -> each side locks itself (initiatorConfirmed/receiverConfirmed)
     ready     -> both sides confirmed
     final     -> each party confirms the "cannot be undone" modal
     execute   -> atomic swap, items trade-locked for 7 days, status completed
     cancel    -> either party, before completion; items stay put

   Every mutation holds the project's per-item/user locks and re-reads the
   trade *and* every item inside the lock, so a trade can never swap an item
   that was sold, gifted or already traded away in the meantime.
   ========================================================================= */

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { tradeStore } from './store.js';
import { publishTradeChange } from './realtime.js';
import { inventoryStore } from '../inventory/store.js';
import { isTransferable } from '../inventory/manager.js';
import { logTransfer, TRANSFER_REASONS } from '../utils/audit.js';
import { withLocks } from '../utils/locking.js';

export const TRADE_TTL_MS = config.trade.ttlMs;
export const MAX_TRADE_ITEMS = config.trade.maxItemsPerSide;
const TRADE_LOCK_MS = 7 * 24 * 60 * 60 * 1000;

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

/** A short, human-shareable id (base36, collision-checked by the caller). */
function shortCode() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Snapshot an owned item so the page renders even if it later disappears. */
function snapshot(item) {
  return {
    uid: item.id,
    catalogueId: item.itemId,
    value: item.value || 0,
    stattrak: Boolean(item.stattrak),
    floatValue: item.floatValue ?? null,
    stickers: Array.isArray(item.stickers) ? item.stickers : [],
    obtainedAt: item.obtainedAt,
  };
}

/* ------------------------------------------------------------- projections */

export function publicTrade(trade, viewerId = null) {
  if (!trade) return null;
  const role =
    viewerId && viewerId === trade.initiatorId
      ? 'initiator'
      : viewerId && viewerId === trade.receiverId
        ? 'receiver'
        : 'observer';
  return {
    id: trade.id,
    status: trade.status,
    role,
    initiator: trade.initiator,
    receiver: trade.receiver,
    initiatorItems: trade.initiatorItems || [],
    receiverItems: trade.receiverItems || [],
    initiatorConfirmed: Boolean(trade.initiatorConfirmed),
    receiverConfirmed: Boolean(trade.receiverConfirmed),
    initiatorFinalConfirmed: Boolean(trade.initiatorFinalConfirmed),
    receiverFinalConfirmed: Boolean(trade.receiverFinalConfirmed),
    initiatorTotal: (trade.initiatorItems || []).reduce((n, i) => n + (i.value || 0), 0),
    receiverTotal: (trade.receiverItems || []).reduce((n, i) => n + (i.value || 0), 0),
    createdAt: trade.createdAt,
    expiresAt: trade.expiresAt,
    completedAt: trade.completedAt ?? null,
    cancelReason: trade.cancelReason ?? null,
  };
}

/* ------------------------------------------------------------------ expiry */

async function expireIfStale(trade) {
  if (!trade || trade.status === 'completed' || trade.status === 'cancelled') return trade;
  if (trade.status === 'expired') return trade;
  if (trade.expiresAt > Date.now()) return trade;
  return withLocks([`trade:${trade.id}`], async () => {
    const fresh = await tradeStore().get(trade.id);
    if (!fresh || fresh.expiresAt > Date.now() || fresh.status === 'completed') return fresh;
    fresh.status = 'expired';
    await tradeStore().put(fresh);
    publishTradeChange(fresh, 'expired');
    return fresh;
  });
}

/* -------------------------------------------------------------- mutations */

/**
 * Create a draft trade with the initiator's items.
 *
 * @param {{initiatorId:string, initiatorName?:string, items:string[], ip?:string}} input
 */
export async function create({ initiatorId, initiatorName = 'You', items = [], ip = null }) {
  const uids = [...new Set(items)].slice(0, MAX_TRADE_ITEMS);
  if (!uids.length) throw httpError(422, 'Select at least one item to trade');

  const resolved = await withLocks(uids.map((uid) => `item:${uid}`), async () =>
    Promise.all(
      uids.map(async (uid) => {
        const item = await inventoryStore().getItem(uid);
        if (!item || item.userId !== initiatorId) throw httpError(404, 'Item not found');
        if (!isTransferable(item)) throw httpError(409, 'Item is listed or trade-locked');
        return item;
      })
    )
  );

  const now = Date.now();
  let id = shortCode();
  while (await tradeStore().get(id)) id = shortCode();

  const trade = {
    id,
    initiatorId,
    initiator: { id: initiatorId, name: initiatorName },
    receiverId: null,
    receiver: null,
    initiatorItems: resolved.map(snapshot),
    receiverItems: [],
    initiatorConfirmed: false,
    receiverConfirmed: false,
    initiatorFinalConfirmed: false,
    receiverFinalConfirmed: false,
    status: 'pending',
    createdAt: now,
    expiresAt: now + TRADE_TTL_MS,
    completedAt: null,
    cancelReason: null,
  };

  await tradeStore().put(trade);
  publishTradeChange(trade, 'created');
  return publicTrade(trade, initiatorId);
}

/** Read a trade, claiming the receiver side on first open by a non-initiator. */
export async function getState(id, viewerId = null) {
  let trade = await tradeStore().get(id);
  if (!trade) throw httpError(404, 'Trade not found');
  trade = await expireIfStale(trade);

  if (viewerId && !trade.receiverId && viewerId !== trade.initiatorId && trade.status !== 'expired') {
    trade = await withLocks([`trade:${trade.id}`], async () => {
      const fresh = await tradeStore().get(trade.id);
      if (fresh.receiverId || fresh.status === 'expired') return fresh;
      fresh.receiverId = viewerId;
      fresh.receiver = { id: viewerId, name: 'Trader' };
      await tradeStore().put(fresh);
      publishTradeChange(fresh, 'updated');
      return fresh;
    });
  }

  return publicTrade(trade, viewerId);
}

/** Resolve which side a user may edit, or throw. */
function sideOf(trade, userId) {
  if (userId === trade.initiatorId) return 'initiator';
  if (userId === trade.receiverId) return 'receiver';
  throw httpError(403, 'This trade is not yours');
}

async function loadEditable(id, userId) {
  const trade = await tradeStore().get(id);
  if (!trade) throw httpError(404, 'Trade not found');
  if (trade.status !== 'pending') throw httpError(409, 'This trade can no longer be edited');
  const side = sideOf(trade, userId);
  return { trade, side };
}

/** Add one owned item to the caller's side. */
export async function addItem({ userId, id, uid }) {
  const { trade, side } = await loadEditable(id, userId);
  const key = `${side}Items`;
  const list = trade[key];
  if (list.some((entry) => entry.uid === uid)) return publicTrade(trade, userId);
  if (list.length >= MAX_TRADE_ITEMS) throw httpError(409, `At most ${MAX_TRADE_ITEMS} items per side`);

  return withLocks([`trade:${id}`, `item:${uid}`], async () => {
    const fresh = await tradeStore().get(id);
    const item = await inventoryStore().getItem(uid);
    if (!item || item.userId !== userId) throw httpError(404, 'Item not found');
    if (!isTransferable(item)) throw httpError(409, 'Item is listed or trade-locked');
    if (fresh[key].length >= MAX_TRADE_ITEMS) throw httpError(409, `At most ${MAX_TRADE_ITEMS} items per side`);

    fresh[key] = [...fresh[key], snapshot(item)];
    fresh.initiatorConfirmed = side === 'initiator' ? false : fresh.initiatorConfirmed;
    fresh.receiverConfirmed = side === 'receiver' ? false : fresh.receiverConfirmed;
    await tradeStore().put(fresh);
    publishTradeChange(fresh, 'updated');
    return publicTrade(fresh, userId);
  });
}

/** Remove one item from the caller's side. */
export async function removeItem({ userId, id, uid }) {
  await loadEditable(id, userId);
  return withLocks([`trade:${id}`], async () => {
    const fresh = await tradeStore().get(id);
    const side = sideOf(fresh, userId);
    const key = `${side}Items`;
    fresh[key] = fresh[key].filter((entry) => entry.uid !== uid);
    // Editing a side invalidates that side's confirmation.
    if (side === 'initiator') {
      fresh.initiatorConfirmed = false;
      fresh.initiatorFinalConfirmed = false;
    } else {
      fresh.receiverConfirmed = false;
      fresh.receiverFinalConfirmed = false;
    }
    if (fresh.status === 'ready') fresh.status = 'pending';
    await tradeStore().put(fresh);
    publishTradeChange(fresh, 'updated');
    return publicTrade(fresh, userId);
  });
}

/** First confirmation — locks the caller's side. */
export async function confirm({ userId, id }) {
  return withLocks([`trade:${id}`], async () => {
    const trade = await tradeStore().get(id);
    if (!trade) throw httpError(404, 'Trade not found');
    if (trade.status === 'completed' || trade.status === 'cancelled' || trade.status === 'expired') {
      throw httpError(409, 'This trade is closed');
    }
    const side = sideOf(trade, userId);
    const own = side === 'initiator' ? trade.initiatorItems : trade.receiverItems;
    if (!own.length) throw httpError(409, 'Add at least one item to your side first');

    if (side === 'initiator') trade.initiatorConfirmed = true;
    else trade.receiverConfirmed = true;

    trade.status = trade.initiatorConfirmed && trade.receiverConfirmed ? 'ready' : 'pending';
    await tradeStore().put(trade);
    publishTradeChange(trade, trade.status === 'ready' ? 'ready' : 'confirmed');
    return publicTrade(trade, userId);
  });
}

/** Second (final) confirmation — both are needed before execute(). */
export async function finalConfirm({ userId, id }) {
  return withLocks([`trade:${id}`], async () => {
    const trade = await tradeStore().get(id);
    if (!trade) throw httpError(404, 'Trade not found');
    if (trade.status !== 'ready') throw httpError(409, 'Both sides must confirm first');
    const side = sideOf(trade, userId);
    if (side === 'initiator') trade.initiatorFinalConfirmed = true;
    else trade.receiverFinalConfirmed = true;
    await tradeStore().put(trade);
    publishTradeChange(trade, 'confirmed');
    return publicTrade(trade, userId);
  });
}

/**
 * Execute the atomic swap. Requires both final confirmations. Idempotent: a
 * second call on a completed trade returns the completed trade unchanged.
 */
export async function execute({ userId, id, ip = null }) {
  const preview = await tradeStore().get(id);
  if (!preview) throw httpError(404, 'Trade not found');
  if (preview.status === 'completed') return publicTrade(preview, userId);
  if (preview.status !== 'ready') throw httpError(409, 'This trade is not ready to execute');
  sideOf(preview, userId); // only a party may trigger it
  if (!preview.initiatorFinalConfirmed || !preview.receiverFinalConfirmed) {
    throw httpError(409, 'Both parties must give final confirmation');
  }

  const allUids = [...preview.initiatorItems, ...preview.receiverItems].map((i) => i.uid);

  return withLocks([`trade:${id}`, ...allUids.map((uid) => `item:${uid}`)], async () => {
    const trade = await tradeStore().get(id);
    if (trade.status === 'completed') return publicTrade(trade, userId);
    if (trade.status !== 'ready') throw httpError(409, 'This trade is not ready to execute');
    if (trade.expiresAt <= Date.now()) {
      trade.status = 'expired';
      await tradeStore().put(trade);
      publishTradeChange(trade, 'expired');
      throw httpError(410, 'This trade has expired');
    }

    // Re-validate every item is still where the trade expects it to be.
    const missing = [];
    for (const side of ['initiator', 'receiver']) {
      const ownerId = side === 'initiator' ? trade.initiatorId : trade.receiverId;
      for (const entry of trade[`${side}Items`]) {
        const item = await inventoryStore().getItem(entry.uid);
        if (!item || item.userId !== ownerId || !isTransferable(item)) {
          missing.push({ side, uid: entry.uid });
        }
      }
    }
    if (missing.length) {
      // Drop the offending items, unlock the trade and tell both parties.
      const gone = new Set(missing.map((m) => m.uid));
      trade.initiatorItems = trade.initiatorItems.filter((i) => !gone.has(i.uid));
      trade.receiverItems = trade.receiverItems.filter((i) => !gone.has(i.uid));
      trade.initiatorConfirmed = false;
      trade.receiverConfirmed = false;
      trade.initiatorFinalConfirmed = false;
      trade.receiverFinalConfirmed = false;
      trade.status = 'pending';
      await tradeStore().put(trade);
      publishTradeChange(trade, 'updated');
      throw httpError(409, 'Some items are no longer available; they were removed from the trade', { missing });
    }

    const lockUntil = Date.now() + TRADE_LOCK_MS;
    const move = async (entries, toUserId, fromUserId) => {
      for (const entry of entries) {
        const item = await inventoryStore().getItem(entry.uid);
        item.userId = toUserId;
        item.tradeLocked = true;
        item.tradeLockedUntil = lockUntil;
        item.updatedAt = Date.now();
        await inventoryStore().saveItem(item);
        await logTransfer({
          itemId: entry.uid,
          fromUserId,
          toUserId,
          reason: TRANSFER_REASONS.TRADE,
          ip,
          meta: { tradeId: trade.id },
        });
      }
    };

    await move(trade.initiatorItems, trade.receiverId, trade.initiatorId);
    await move(trade.receiverItems, trade.initiatorId, trade.receiverId);

    trade.status = 'completed';
    trade.completedAt = Date.now();
    await tradeStore().put(trade);
    publishTradeChange(trade, 'completed');
    return publicTrade(trade, userId);
  });
}

/** Cancel a trade before completion. */
export async function cancel({ userId, id, reason = null }) {
  return withLocks([`trade:${id}`], async () => {
    const trade = await tradeStore().get(id);
    if (!trade) throw httpError(404, 'Trade not found');
    if (trade.status === 'completed') throw httpError(409, 'A completed trade cannot be cancelled');
    sideOf(trade, userId);
    trade.status = 'cancelled';
    trade.cancelReason = reason ? String(reason).slice(0, 200) : null;
    await tradeStore().put(trade);
    publishTradeChange(trade, 'cancelled');
    return publicTrade(trade, userId);
  });
}

/** The caller's trades, newest first. */
export async function history(userId, limit = 50) {
  const rows = await tradeStore().byUser(userId);
  return rows
    .map((t) => ({
      ...publicTrade(t, userId),
      other:
        t.initiatorId === userId
          ? t.receiver || { id: t.receiverId, name: 'Unclaimed' }
          : t.initiator,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

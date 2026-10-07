/* ============================================================================
   BLAZZER — item transfer audit trail
   Every movement of an item (granted, removed, sold, bought, traded, gifted,
   upgraded) is written to an append-only ledger: who, what, when, from where.
   This is the compliance backbone of the secondary market — it makes double
   spends provable and fraud disputes answerable. Writes are best-effort: an
   audit failure must never break a legitimate transfer.
   ========================================================================= */

import { randomUUID } from 'node:crypto';
import { inventoryStore } from '../inventory/store.js';

export const TRANSFER_REASONS = {
  GRANT: 'grant',
  REMOVE: 'remove',
  SELL: 'sell',
  BUY: 'buy',
  TRADE: 'trade',
  GIFT: 'gift',
  UPGRADE: 'upgrade',
};

/**
 * Append a transfer record. Never throws — a broken audit sink must not stop a
 * user's action.
 *
 * @param {object} entry
 * @param {string} entry.itemId        InventoryItem id
 * @param {string|null} [entry.fromUserId]
 * @param {string|null} [entry.toUserId]
 * @param {string} entry.reason        one of TRANSFER_REASONS
 * @param {string|null} [entry.ip]
 * @param {object} [entry.meta]
 */
export async function logTransfer({
  itemId,
  fromUserId = null,
  toUserId = null,
  reason,
  ip = null,
  meta = {},
}) {
  const entry = {
    id: `x_${randomUUID()}`,
    itemId,
    fromUserId,
    toUserId,
    reason: reason || TRANSFER_REASONS.REMOVE,
    ip,
    meta,
    createdAt: Date.now(),
  };
  try {
    await inventoryStore().appendTransfer(entry);
  } catch (err) {
    console.warn('[inventory:audit] write failed:', err.message);
  }
  return entry;
}

/**
 * Read recent transfers, optionally filtered by item or party.
 * @param {{itemId?:string, userId?:string}} [filter]
 * @param {number} [limit]
 */
export async function listTransfers(filter = {}, limit = 100) {
  try {
    return await inventoryStore().listTransfers(filter, limit);
  } catch {
    return [];
  }
}

/** Convenience: the provenance chain for one item, oldest first. */
export async function itemHistory(itemId, limit = 50) {
  const rows = await listTransfers({ itemId }, limit);
  return rows.slice().reverse();
}

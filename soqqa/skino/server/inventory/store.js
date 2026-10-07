/* ============================================================================
   BLAZZER — inventory persistence
   Owned item instances and the transfer audit ledger must survive restarts.
   Two interchangeable backends, chosen once at boot:

     - PrismaBackend : used automatically when Postgres is enabled AND the
                       inventory models are generated (see schema.prisma).
     - FileBackend   : a dependency-free, atomically-written JSON file. This is
                       the default so the feature works with zero infrastructure.

   Later Stage 3 sub-stages (market, trade, upgrade, gift) add their own
   collections to the same file shape — the surface below is intentionally the
   lowest common denominator (one item = one instance).
   ========================================================================= */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../store/db.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'items.json');

const MAX_TRANSFERS = 5000;

/* ------------------------------------------------------------------ helpers */

/** Normalise a stored row into the shape the manager expects (ms timestamps). */
function normaliseItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    itemId: row.itemId,
    value: row.value ?? 0,
    obtainedAt: row.obtainedAt ?? Date.now(),
    obtainedVia: row.obtainedVia || 'purchase',
    stickers: Array.isArray(row.stickers) ? row.stickers : [],
    stattrak: Boolean(row.stattrak),
    floatValue: row.floatValue ?? null,
    isListed: Boolean(row.isListed),
    price: row.price ?? null,
    tradeLocked: Boolean(row.tradeLocked),
    tradeLockedUntil: row.tradeLockedUntil ?? null,
    fairProof: row.fairProof ?? null,
    createdAt: row.createdAt ?? Date.now(),
    updatedAt: row.updatedAt ?? Date.now(),
  };
}

/* ------------------------------------------------------------------ backends */

class FileBackend {
  constructor() {
    this.data = { items: {}, transfers: [] };
    this.writeTimer = 0;
    // Best-effort synchronous flush if the process is torn down mid-debounce.
    process.on('exit', () => this.flushSync());
  }

  name() {
    return 'file';
  }

  async init() {
    try {
      const raw = await fsp.readFile(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = {
        items: parsed.items || {},
        transfers: Array.isArray(parsed.transfers) ? parsed.transfers : [],
      };
    } catch {
      this.data = { items: {}, transfers: [] }; // first run
    }
  }

  async getItem(id) {
    return this.data.items[id] || null;
  }

  async saveItem(item) {
    this.data.items[item.id] = item;
    this.scheduleFlush();
  }

  async deleteItem(id) {
    delete this.data.items[id];
    this.scheduleFlush();
  }

  async listItemsByUser(userId) {
    return Object.values(this.data.items).filter((item) => item.userId === userId);
  }

  async appendTransfer(entry) {
    this.data.transfers.unshift(entry);
    if (this.data.transfers.length > MAX_TRANSFERS) this.data.transfers.length = MAX_TRANSFERS;
    this.scheduleFlush();
  }

  async listTransfers({ itemId, userId } = {}, limit = 100) {
    return this.data.transfers
      .filter((t) => (!itemId || t.itemId === itemId) && (!userId || t.toUserId === userId || t.fromUserId === userId))
      .slice(0, limit);
  }

  scheduleFlush() {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = 0;
      this.flush().catch((err) => console.warn('[inventory] persist failed:', err.message));
    }, 250);
    this.writeTimer.unref?.();
  }

  async flush() {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.data), 'utf8');
    await fsp.rename(tmp, DATA_FILE); // atomic on the same filesystem
  }

  flushSync() {
    if (!this.data) return;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data), 'utf8');
    } catch {
      /* nothing we can do at exit */
    }
  }
}

class PrismaBackend {
  constructor(db) {
    this.db = db;
  }

  name() {
    return 'postgres';
  }

  async init() {
    await this.db.$connect?.();
  }

  async getItem(id) {
    return normaliseItem(await this.db.inventoryItem.findUnique({ where: { id } }));
  }

  async saveItem(item) {
    const payload = {
      userId: item.userId,
      itemId: item.itemId,
      value: item.value ?? 0,
      obtainedVia: item.obtainedVia || 'purchase',
      stickers: item.stickers ?? [],
      stattrak: Boolean(item.stattrak),
      floatValue: item.floatValue ?? null,
      isListed: Boolean(item.isListed),
      price: item.price ?? null,
      tradeLocked: Boolean(item.tradeLocked),
      tradeLockedUntil: item.tradeLockedUntil ? new Date(item.tradeLockedUntil) : null,
      fairProof: item.fairProof ?? null,
    };
    await this.db.inventoryItem.upsert({
      where: { id: item.id },
      create: { id: item.id, obtainedAt: new Date(item.obtainedAt ?? Date.now()), ...payload },
      update: payload,
    });
  }

  async deleteItem(id) {
    await this.db.inventoryItem.delete({ where: { id } }).catch(() => {});
  }

  async listItemsByUser(userId) {
    const rows = await this.db.inventoryItem.findMany({
      where: { userId },
      orderBy: [{ obtainedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(normaliseItem);
  }

  async appendTransfer(entry) {
    await this.db.transferAudit.create({
      data: {
        id: entry.id,
        itemId: entry.itemId,
        fromUserId: entry.fromUserId || null,
        toUserId: entry.toUserId || null,
        reason: entry.reason,
        ip: entry.ip || null,
        meta: entry.meta || {},
        createdAt: new Date(entry.createdAt),
      },
    });
  }

  async listTransfers({ itemId, userId } = {}, limit = 100) {
    const where = {};
    if (itemId) where.itemId = itemId;
    if (userId) where.OR = [{ toUserId: userId }, { fromUserId: userId }];
    const rows = await this.db.transferAudit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      fromUserId: r.fromUserId,
      toUserId: r.toUserId,
      reason: r.reason,
      ip: r.ip,
      meta: r.meta,
      createdAt: r.createdAt.getTime(),
    }));
  }

  async flush() {
    /* writes are immediate */
  }
}

/* --------------------------------------------------------------- singleton */

let backend = null;

/** Pick a backend once at boot; falls back to the file store on any doubt. */
export async function initInventoryStore() {
  const db = getDb();
  if (db?.inventoryItem && db?.transferAudit) {
    try {
      backend = new PrismaBackend(db);
      await backend.init();
      console.log('[inventory] persistence: postgres');
      return backend;
    } catch (err) {
      console.warn('[inventory] postgres backend failed, using file store:', err.message);
    }
  }
  backend = new FileBackend();
  await backend.init();
  console.log('[inventory] persistence: file');
  return backend;
}

export function inventoryStore() {
  if (!backend) throw new Error('inventory store not initialised — call initInventoryStore()');
  return backend;
}

export async function closeInventoryStore() {
  try {
    await backend?.flush();
  } catch {
    /* best effort */
  }
}

export const MAX_TRANSFER_ROWS = MAX_TRANSFERS;

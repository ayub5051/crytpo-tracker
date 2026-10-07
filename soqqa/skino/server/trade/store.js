/* ============================================================================
   BLAZZER — trade persistence (Stage 3.3)
   One collection: every trade, keyed by id. Like the inventory and market
   stores this is an atomically-written JSON file so trading works with zero
   infrastructure; the SQL table in server/db/migrations/0003_stage3_trade.sql
   mirrors it for Postgres deployments.

   A trade is small (two id arrays + flags), so the whole map is kept in memory
   and flushed on a debounce — reads are free and the write is atomic.
   ========================================================================= */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'trades.json');

/** Keep the file from growing without bound in a long-running demo. */
const MAX_TRADES = 2000;

class FileBackend {
  constructor() {
    this.data = { trades: {} };
    this.writeTimer = 0;
    process.on('exit', () => this.flushSync());
  }

  name() {
    return 'file';
  }

  async init() {
    try {
      const parsed = JSON.parse(await fsp.readFile(DATA_FILE, 'utf8'));
      this.data = { trades: parsed.trades || {} };
    } catch {
      this.data = { trades: {} }; // first run
    }
  }

  async get(id) {
    return this.data.trades[id] || null;
  }

  async put(trade) {
    this.data.trades[trade.id] = trade;
    this.trim();
    this.scheduleFlush();
  }

  async byUser(userId) {
    return Object.values(this.data.trades).filter(
      (t) => t.initiatorId === userId || t.receiverId === userId
    );
  }

  trim() {
    const all = Object.values(this.data.trades);
    if (all.length <= MAX_TRADES) return;
    // Drop the oldest finished trades first; never drop an active one.
    all
      .filter((t) => t.status === 'completed' || t.status === 'cancelled' || t.status === 'expired')
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, all.length - MAX_TRADES)
      .forEach((t) => delete this.data.trades[t.id]);
  }

  scheduleFlush() {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = 0;
      this.flush().catch((err) => console.warn('[trade] persist failed:', err.message));
    }, 250);
    this.writeTimer.unref?.();
  }

  async flush() {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.data), 'utf8');
    await fsp.rename(tmp, DATA_FILE);
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

let backend = null;

export async function initTradeStore() {
  if (backend) return backend;
  backend = new FileBackend();
  await backend.init();
  console.log('[trade] persistence: file');
  return backend;
}

export function tradeStore() {
  if (!backend) throw new Error('trade store not initialised — call initTradeStore()');
  return backend;
}

export async function closeTradeStore() {
  try {
    await backend?.flush();
  } catch {
    /* best effort */
  }
  backend = null;
}

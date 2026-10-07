/* ============================================================================
   BLAZZER — market persistence (Stage 3.2)
   The secondary market needs four durable collections:

     listings     one row per listing (active | sold | cancelled | expired)
     wallets      a demo-only Crystal balance per user, so a purchase has two
                  sides to settle (the file client is authoritative in the
                  browser; this is the server-side ledger the API settles)
     sales        the last N completed sales, the raw material for the
                  "suggested price" estimator (server/market/pricing.js)
     idempotency  a short-lived key -> result map so a retried purchase can
                  never charge twice (the classic network-retry double-buy)

   Like the inventory store, this is an atomically-written JSON file so the
   market works with zero infrastructure. The SQL tables in
   server/db/migrations/0002_stage3_market.sql mirror it for Postgres deploys.
   ========================================================================= */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'market.json');

const MAX_SALES = 2000; // enough history for a stable median
const MAX_IDEMPOTENCY = 1000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** The demo starting balance, matching the client's STARTING_CRYSTALS. */
export const STARTER_WALLET = 2500;

/* ------------------------------------------------------------------ backend */

class FileBackend {
  constructor() {
    this.data = { listings: {}, wallets: {}, sales: [], idempotency: {} };
    this.writeTimer = 0;
    process.on('exit', () => this.flushSync());
  }

  name() {
    return 'file';
  }

  async init() {
    try {
      const parsed = JSON.parse(await fsp.readFile(DATA_FILE, 'utf8'));
      this.data = {
        listings: parsed.listings || {},
        wallets: parsed.wallets || {},
        sales: Array.isArray(parsed.sales) ? parsed.sales : [],
        idempotency: parsed.idempotency || {},
      };
    } catch {
      this.data = { listings: {}, wallets: {}, sales: [], idempotency: {} }; // first run
    }
  }

  /* ------------------------------------------------------------ listings */

  async getListing(id) {
    return this.data.listings[id] || null;
  }

  async putListing(listing) {
    this.data.listings[listing.id] = listing;
    this.scheduleFlush();
  }

  async listListings(status) {
    const all = Object.values(this.data.listings);
    return status ? all.filter((l) => l.status === status) : all;
  }

  /* ------------------------------------------------------ demo wallets */

  async getWallet(userId) {
    return Number.isFinite(this.data.wallets[userId]) ? this.data.wallets[userId] : null;
  }

  async setWallet(userId, value) {
    this.data.wallets[userId] = Math.max(0, Math.round(value));
    this.scheduleFlush();
  }

  /* -------------------------------------------------------------- sales */

  async appendSale(sale) {
    this.data.sales.unshift(sale);
    if (this.data.sales.length > MAX_SALES) this.data.sales.length = MAX_SALES;
    this.scheduleFlush();
  }

  async recentSales(itemId, limit = 20) {
    return this.data.sales.filter((s) => s.itemId === itemId).slice(0, limit);
  }

  /* -------------------------------------------------------- idempotency */

  async getIdempotency(key) {
    const hit = this.data.idempotency[key];
    if (!hit) return null;
    if (Date.now() - hit.at > IDEMPOTENCY_TTL_MS) {
      delete this.data.idempotency[key];
      return null;
    }
    return hit.result;
  }

  async putIdempotency(key, result) {
    this.data.idempotency[key] = { at: Date.now(), result };
    const keys = Object.keys(this.data.idempotency);
    if (keys.length > MAX_IDEMPOTENCY) {
      // Drop the oldest quarter to keep the map bounded.
      keys
        .sort((a, b) => this.data.idempotency[a].at - this.data.idempotency[b].at)
        .slice(0, Math.ceil(keys.length / 4))
        .forEach((k) => delete this.data.idempotency[k]);
    }
    this.scheduleFlush();
  }

  /* -------------------------------------------------------------- flush */

  scheduleFlush() {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = 0;
      this.flush().catch((err) => console.warn('[market] persist failed:', err.message));
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

/* --------------------------------------------------------------- singleton */

let backend = null;

/** Initialise the market store. Idempotent; safe without any database. */
export async function initMarketStore() {
  if (backend) return backend;
  backend = new FileBackend();
  await backend.init();
  console.log('[market] persistence: file');
  return backend;
}

export function marketStore() {
  if (!backend) throw new Error('market store not initialised — call initMarketStore()');
  return backend;
}

export async function closeMarketStore() {
  try {
    await backend?.flush();
  } catch {
    /* best effort */
  }
  backend = null;
}

export const MARKET_LIMITS = { MAX_SALES, IDEMPOTENCY_TTL_MS };

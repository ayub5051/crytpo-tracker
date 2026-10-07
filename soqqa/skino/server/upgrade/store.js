/* ============================================================================
   BLAZZER — Upgrade persistence (Stage 3.4)
   An Upgrade moves real inventory items, so it needs two durable collections:

     history      one row per settled Upgrade — the stake, the target, the
                  chance, the outcome and the fair proof that produced it
     idempotency  a short-lived key -> result map, so a retried PLAY can never
                  consume the same stake twice (the classic network-retry
                  double-spend, which here would destroy items)

   Like the inventory and market stores, this is an atomically-written JSON file
   so Upgrade works with zero infrastructure. The SQL tables in
   server/db/migrations/0004_stage3_upgrade.sql mirror it for Postgres deploys.
   ========================================================================= */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'upgrade.json');

const MAX_HISTORY = 5000; // global ring, oldest trimmed first
const MAX_IDEMPOTENCY = 1000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ backend */

class FileBackend {
  constructor() {
    this.data = { history: [], idempotency: {} };
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
        history: Array.isArray(parsed.history) ? parsed.history : [],
        idempotency: parsed.idempotency || {},
      };
    } catch {
      this.data = { history: [], idempotency: {} }; // first run
    }
  }

  /* ------------------------------------------------------------ history */

  async appendHistory(entry) {
    this.data.history.unshift(entry);
    if (this.data.history.length > MAX_HISTORY) this.data.history.length = MAX_HISTORY;
    this.scheduleFlush();
  }

  async listHistory(userId, limit = 25) {
    return this.data.history.filter((row) => row.userId === userId).slice(0, limit);
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
      this.flush().catch((err) => console.warn('[upgrade] persist failed:', err.message));
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

/** Initialise the Upgrade store. Idempotent; safe without any database. */
export async function initUpgradeStore() {
  if (backend) return backend;
  backend = new FileBackend();
  await backend.init();
  console.log('[upgrade] persistence: file');
  return backend;
}

export function upgradeStore() {
  if (!backend) throw new Error('upgrade store not initialised — call initUpgradeStore()');
  return backend;
}

export async function closeUpgradeStore() {
  try {
    await backend?.flush();
  } catch {
    /* best effort */
  }
  backend = null;
}

export const UPGRADE_LIMITS = { MAX_HISTORY, IDEMPOTENCY_TTL_MS };

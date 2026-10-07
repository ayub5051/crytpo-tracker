/* ============================================================================
   BLAZZER — provably-fair persistence
   Seed state, placed bets and the rotation audit trail must survive restarts.
   Two interchangeable backends:

     - PrismaBackend : used automatically when Postgres is enabled AND the
                       fair models are generated (see server/prisma/schema.prisma).
     - FileBackend   : a dependency-free, atomically-written JSON file. This is
                       the default so the feature works with zero infra.

   Both expose the same six methods, so seed-manager/audit never care which one
   is live.
   ========================================================================= */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../store/db.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'fair.json');

const MAX_BETS_PER_USER = 200;
const MAX_AUDIT = 500;

/* ------------------------------------------------------------------ backends */

class FileBackend {
  constructor() {
    this.data = { seeds: {}, bets: {}, audit: [] };
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
        seeds: parsed.seeds || {},
        bets: parsed.bets || {},
        audit: Array.isArray(parsed.audit) ? parsed.audit : [],
      };
    } catch {
      this.data = { seeds: {}, bets: {}, audit: [] }; // first run
    }
  }

  async getSeed(userId) {
    return this.data.seeds[userId] || null;
  }

  async saveSeed(userId, state) {
    this.data.seeds[userId] = state;
    this.scheduleFlush();
  }

  async appendBet(userId, bet) {
    const list = this.data.bets[userId] || [];
    list.unshift(bet);
    if (list.length > MAX_BETS_PER_USER) list.length = MAX_BETS_PER_USER;
    this.data.bets[userId] = list;
    this.scheduleFlush();
  }

  async listBets(userId, { limit = 50, before = null } = {}) {
    const list = this.data.bets[userId] || [];
    const filtered = before ? list.filter((b) => b.createdAt < before) : list;
    return filtered.slice(0, limit);
  }

  async appendAudit(entry) {
    this.data.audit.unshift(entry);
    if (this.data.audit.length > MAX_AUDIT) this.data.audit.length = MAX_AUDIT;
    this.scheduleFlush();
  }

  async listAudit(userId, limit = 50) {
    return this.data.audit.filter((a) => a.userId === userId).slice(0, limit);
  }

  scheduleFlush() {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = 0;
      this.flush().catch((err) => console.warn('[fair] persist failed:', err.message));
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

  async getSeed(userId) {
    const row = await this.db.fairSeed.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      serverSeedEnc: row.serverSeedEnc,
      serverSeedHash: row.serverSeedHash,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
      createdAt: row.createdAt?.getTime?.() ?? Date.now(),
      rotatedAt: row.rotatedAt ? row.rotatedAt.getTime() : null,
    };
  }

  async saveSeed(userId, state) {
    const payload = {
      serverSeedEnc: state.serverSeedEnc,
      serverSeedHash: state.serverSeedHash,
      clientSeed: state.clientSeed,
      nonce: state.nonce,
      rotatedAt: state.rotatedAt ? new Date(state.rotatedAt) : null,
    };
    await this.db.fairSeed.upsert({
      where: { userId },
      create: { userId, ...payload },
      update: payload,
    });
  }

  async appendBet(userId, bet) {
    await this.db.fairBet.create({
      data: {
        id: bet.id,
        userId,
        game: bet.game,
        nonce: bet.nonce,
        amount: bet.amount ?? 0,
        serverSeedHash: bet.serverSeedHash,
        clientSeed: bet.clientSeed,
        outcome: bet.outcome,
        createdAt: new Date(bet.createdAt),
      },
    });
  }

  async listBets(userId, { limit = 50, before = null } = {}) {
    const rows = await this.db.fairBet.findMany({
      where: { userId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      game: r.game,
      nonce: r.nonce,
      amount: r.amount,
      serverSeedHash: r.serverSeedHash,
      clientSeed: r.clientSeed,
      outcome: r.outcome,
      createdAt: r.createdAt.getTime(),
    }));
  }

  async appendAudit(entry) {
    await this.db.fairAudit.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        ip: entry.ip || null,
        meta: entry.meta || {},
        createdAt: new Date(entry.createdAt),
      },
    });
  }

  async listAudit(userId, limit = 50) {
    const rows = await this.db.fairAudit.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      userId: r.userId,
      action: r.action,
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
export async function initFairStore() {
  const db = getDb();
  if (db?.fairSeed && db?.fairBet && db?.fairAudit) {
    try {
      backend = new PrismaBackend(db);
      await backend.init();
      console.log('[fair] persistence: postgres');
      return backend;
    } catch (err) {
      console.warn('[fair] postgres backend failed, using file store:', err.message);
    }
  }
  backend = new FileBackend();
  await backend.init();
  console.log('[fair] persistence: file');
  return backend;
}

export function fairStore() {
  if (!backend) throw new Error('fair store not initialised — call initFairStore()');
  return backend;
}

export async function closeFairStore() {
  try {
    await backend?.flush();
  } catch {
    /* best effort */
  }
}

export const FAIR_BET_LIMIT = MAX_BETS_PER_USER;

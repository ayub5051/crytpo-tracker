/* ============================================================================
   BLAZZER — server configuration
   A single, env-driven source of truth. Every secret and tunable comes from the
   environment (see .env.example); nothing is hardcoded. Strings are coerced to
   booleans/ints/lists once, here, so the rest of the server never re-parses.
   ========================================================================= */

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '..'); // the static site root (skino/)
console.log('[config] dirname:', dirname);
console.log('[config] root:', root);
console.log('[config] index.html exists:', fs.existsSync(path.join(root, 'index.html')));
function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function toList(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

const env = process.env.NODE_ENV || 'development';

export const config = {
  env,
  isProd: env === 'production',
  port: toInt(process.env.PORT, 8787),
  host: process.env.HOST || '0.0.0.0',
  trustProxy: toBool(process.env.TRUST_PROXY, true),

  root,
  publicDir: root,

  corsOrigins: toList(process.env.CORS_ORIGINS),

  jwt: {
    secret: process.env.JWT_SECRET || '',
    issuer: 'blazzer',
    audience: 'blazzer-client',
    guestTtl: '2h',
    userTtl: '15m',
  },

  // Shared secret for internal ingestion (game services -> feed).
  serviceKey: process.env.LIVE_SERVICE_KEY || '',

  redis: { url: process.env.REDIS_URL || '' },

  database: {
    enabled: toBool(process.env.DATABASE_ENABLED, false),
    url: process.env.DATABASE_URL || '',
  },

  live: {
    path: '/live',

    keepLast: toInt(process.env.LIVE_KEEP_LAST, 500), // Redis ring buffer size
    visibleCap: 20, // cards actually shown
    domCap: 30, // hard ceiling on live DOM nodes
    bigWin: toInt(process.env.LIVE_BIG_WIN, 10_000),
    hugeWin: toInt(process.env.LIVE_HUGE_WIN, 100_000),
    mergeWindowMs: toInt(process.env.LIVE_MERGE_MS, 2_000),
    domThrottleMs: 200, // client render budget

    retentionMs: toInt(process.env.LIVE_RETENTION_MS, 24 * 60 * 60 * 1000),
    cleanupIntervalMs: toInt(process.env.LIVE_CLEANUP_MS, 15 * 60 * 1000),

    // Demo-only baseline so a quiet dev instance still reads "alive".
    onlineBase: toInt(process.env.LIVE_ONLINE_BASE, 0),

    sources: ['wheel', 'mines', 'case', 'crash', 'trade', 'upgrade'],
    categories: ['skin', 'case', 'crypto', 'sticker'],
    excludedUserIds: toList(process.env.LIVE_EXCLUDED_USERS),
  },

  rate: {
    windowMs: toInt(process.env.RATE_WINDOW_MS, 60_000),
    apiMax: toInt(process.env.RATE_API_MAX, 120),
    tokenMax: toInt(process.env.RATE_TOKEN_MAX, 30),
    ingestMax: toInt(process.env.RATE_INGEST_MAX, 240),
  },

  // Secondary market (Stage 3.2). The commission is the platform's cut of every
  // sale; the rest is paid to the seller as Crystals.
  market: {
    commission: clamp(Number.parseFloat(process.env.MARKET_COMMISSION || '0.07'), 0, 0.5),
    minPrice: toInt(process.env.MARKET_MIN_PRICE, 1),
    maxPrice: toInt(process.env.MARKET_MAX_PRICE, 1_000_000),
    // How many rows a browse page may return in one request.
    maxPageSize: toInt(process.env.MARKET_MAX_PAGE_SIZE, 60),
    rate: {
      windowMs: toInt(process.env.MARKET_RATE_WINDOW_MS, 60 * 60 * 1000),
      listMax: toInt(process.env.MARKET_RATE_LIST, 30),
      buyMax: toInt(process.env.MARKET_RATE_BUY, 60),
      cancelMax: toInt(process.env.MARKET_RATE_CANCEL, 30),
      editMax: toInt(process.env.MARKET_RATE_EDIT, 30),
    },
  },

  // Upgrade (Stage 3.4). The odds band and the house edge are deliberately NOT
  // configured here — they live in js/upgrade-rules.js, which the manager
  // imports directly, so pricing has exactly one source of truth and the odds
  // shown to a player can never drift from the odds they are settled against.
  // Only the rate budgets are environment-tunable.
  upgrade: {
    rate: {
      windowMs: toInt(process.env.UPGRADE_RATE_WINDOW_MS, 60 * 60 * 1000),
      playMax: toInt(process.env.UPGRADE_RATE_PLAY, 120),
      readMax: toInt(process.env.UPGRADE_RATE_READ, 240),
    },
  },

  // Peer-to-peer trading (Stage 3.3). No money changes hands — items only.
  trade: {
    ttlMs: toInt(process.env.TRADE_TTL_MS, 24 * 60 * 60 * 1000),
    maxItemsPerSide: toInt(process.env.TRADE_MAX_ITEMS, 20),
    rate: {
      windowMs: toInt(process.env.TRADE_RATE_WINDOW_MS, 60 * 60 * 1000),
      createMax: toInt(process.env.TRADE_RATE_CREATE, 10),
      itemMax: toInt(process.env.TRADE_RATE_ITEM, 60),
      confirmMax: toInt(process.env.TRADE_RATE_CONFIRM, 20),
      cancelMax: toInt(process.env.TRADE_RATE_CANCEL, 20),
    },
  },
};

/* A weak dev secret keeps local development frictionless; production must
   supply a real one or the process refuses to start. */
if (!config.jwt.secret) {
  if (config.isProd) {
    throw new Error('JWT_SECRET is required in production');
  }
  config.jwt.secret = 'dev-insecure-secret-change-me';
}

/* A dev ingest key keeps the simulator working out of the box; production must
   always provide its own. */
if (!config.serviceKey && !config.isProd) {
  config.serviceKey = 'dev-service-key';
  console.warn('[config] LIVE_SERVICE_KEY unset — defaulting to "dev-service-key" (dev only)');
}

/** Warn (do not crash) about anything missing for a production boot. */
export function assertProdSecrets(log = console) {
  if (!config.isProd) return;
  const missing = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!config.serviceKey) missing.push('LIVE_SERVICE_KEY');
  if (missing.length) {
    log.warn(`[config] missing production secrets: ${missing.join(', ')}`);
  }
}

/* ============================================================================
   BLAZZER — server entry point
   Boots the HTTP API, serves the static client from the same origin, attaches
   the live WebSocket tier, and wires the optional Redis/Postgres layers. Every
   external dependency is optional: the server runs (and the feed works) on a
   plain machine with neither Redis nor Postgres.
   ========================================================================= */

import http from 'node:http';
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import cors from 'cors';

import { assertProdSecrets, config } from './config.js';
import { bus } from './broadcast.js';
import { presence } from './presence.js';
import { dropsStore } from './store/dropsStore.js';
import { closeDb, initDb } from './store/db.js';
import { attachLiveSocket } from './ws/live.js';
import { dropsRouter } from './api/drops.js';
import { stopIngest } from './live/ingest.js';
import { fairRouter } from './api/fair.js';
import { closeFairStore, initFairStore } from './fair/store.js';
import { inventoryRouter } from './api/inventory.js';
import { closeInventoryStore, initInventoryStore } from './inventory/store.js';
import { marketRouter } from './api/market.js';
import { closeMarketStore, initMarketStore } from './market/store.js';
import { tradeRouter } from './api/trade.js';
import { closeTradeStore, initTradeStore } from './trade/store.js';
import { attachTradeRealtime } from './trade/realtime.js';
import { upgradeRouter } from './api/upgrade.js';
import { closeUpgradeStore, initUpgradeStore } from './upgrade/store.js';

assertProdSecrets();

const app = express();
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

app.use(compression());
if (config.corsOrigins.length) {
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
}
app.use(express.json({ limit: '16kb' }));

// Health probe — cheap and unauthenticated.
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    env: config.env,
    drops: dropsStore.backing,
    db: config.database.enabled ? 'postgres' : 'off',
    sockets: presence.count(),
  });
});

// REST API for the live feed, the provably-fair subsystem and the inventory.
app.use('/api', dropsRouter);
app.use('/api', fairRouter);
app.use('/api', inventoryRouter);
app.use('/api', marketRouter);
app.use('/api', tradeRouter);
app.use('/api', upgradeRouter);

// Static client (the site itself).
app.use(
  express.static(config.publicDir, {
    index: 'index.html',
    maxAge: config.isProd ? '1h' : 0,
  })
);

// Unknown API routes must not fall through to the HTML shell.
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// SPA-style fallback so deep links still return the app shell.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (!req.accepts('html')) return next();
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

// Central error handler — keeps async route failures from leaking stack traces.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[blazzer] request error:', err?.message || err);
  res.status(err?.status || 500).json({ error: 'Internal error' });
});

const server = http.createServer(app);
const live = attachLiveSocket(server);
// Trade updates ride the Stage 1 socket tier: parties get a compact frame each
// time a trade they own changes, so an open trade page updates live.
attachTradeRealtime(live.wss);

/* ----------------------------------------------------------- optional Redis */

let redis = null;

async function initRedis() {
  if (!config.redis.url) return null;
  try {
    const { default: Redis } = await import('ioredis');
    const factory = () =>
      new Redis(config.redis.url, {
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
        lazyConnect: false,
      });

    const client = factory();
    await client.ping();
    redis = client;
    dropsStore.attachRedis(client);
    await bus.connect(factory); // adds its own pub + sub connections
    console.log('[redis] connected');
  } catch (err) {
    console.warn('[redis] unavailable, using in-memory stores:', err.message);
    redis = null;
  }
  return redis;
}

/* ------------------------------------------------------------ lifecycle */

const cleanups = [];

async function start() {
  await initRedis();
  await initDb();
  await initFairStore();
  await initInventoryStore();
  await initMarketStore();
  await initTradeStore();
  await initUpgradeStore();

  // Periodic retention cleanup. `.unref()` keeps the timer from pinning the
  // process open during tests.
  const cleanupTimer = setInterval(() => {
    dropsStore.cleanup().catch((err) => console.warn('[cleanup] failed:', err.message));
  }, config.live.cleanupIntervalMs);
  cleanupTimer.unref?.();
  cleanups.push(() => clearInterval(cleanupTimer));

  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  console.log(
    `[blazzer] listening on http://${config.host}:${config.port} ` +
      `(drops: ${dropsStore.backing}, db: ${config.database.enabled ? 'on' : 'off'})`
  );
}

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[blazzer] ${signal} received — shutting down`);

  cleanups.forEach((fn) => fn());
  stopIngest();
  live.close();

  await new Promise((resolve) => server.close(resolve));
  await bus.close();
  await closeFairStore();
  await closeInventoryStore();
  await closeMarketStore();
  await closeTradeStore();
  await closeUpgradeStore();
  await closeDb();
  try {
    await redis?.quit();
  } catch {
    /* already closed */
  }
  presence.clear();
  process.exit(0);
}

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => {
    shutdown(signal).catch((err) => {
      console.error('[blazzer] shutdown error:', err);
      process.exit(1);
    });
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[blazzer] unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[blazzer] uncaught exception:', err);
});

start().catch((err) => {
  console.error('[blazzer] failed to start:', err);
  process.exit(1);
});

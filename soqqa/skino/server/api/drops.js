/* ============================================================================
   BLAZZER — live feed REST API
   Everything the client needs before/without a socket: a handshake token, the
   recent-drops snapshot (REST fallback), live stats, and the internal ingest
   endpoint game services post to. All routes are rate-limited.
   ========================================================================= */

import { Router } from 'express';
import { config } from '../config.js';
import { bearerFrom, issueGuestToken, issueUserToken, requireService, verifyToken } from '../auth.js';
import { dropsStore } from '../store/dropsStore.js';
import { presence } from '../presence.js';
import { ingestDrop } from '../live/ingest.js';
import { apiLimiter, ingestLimiter, tokenLimiter } from '../rateLimit.js';

export const dropsRouter = Router();

/** Wrap an async handler so rejections reach Express instead of going unhandled. */
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Filter names accepted by `?filter=`; matched against drop fields. */
const FILTERS = {
  all: () => true,
  big: (drop) => drop.value >= config.live.bigWin,
  skins: (drop) => drop.category === 'skin',
  cases: (drop) => drop.category === 'case',
  crypto: (drop) => drop.category === 'crypto',
};

function applyFilter(drops, filter) {
  const predicate = FILTERS[filter] || FILTERS.all;
  return drops.filter(predicate);
}

/**
 * GET /api/live/token
 * Mint a short-lived JWT for the WebSocket handshake. Upgrades a valid user
 * bearer, otherwise issues a guest token.
 */
dropsRouter.get('/live/token', tokenLimiter, (req, res) => {
  const bearer = bearerFrom(req);
  let token;
  if (bearer) {
    try {
      const user = verifyToken(bearer);
      token = issueUserToken({ id: user.sub, name: user.name });
    } catch {
      token = issueGuestToken();
    }
  } else {
    token = issueGuestToken();
  }
  res.json({ token, expiresIn: config.jwt.guestTtl, role: 'guest' });
});

/**
 * GET /api/live/drops?filter=all&limit=30
 * Recent drops plus live stats — the REST fallback used on first paint and
 * whenever the socket is offline.
 */
dropsRouter.get(
  '/live/drops',
  apiLimiter,
  asyncRoute(async (req, res) => {
    const filter = FILTERS[req.query.filter] ? String(req.query.filter) : 'all';
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 60);

    const [drops, stats] = await Promise.all([
      dropsStore.recent(config.live.keepLast),
      dropsStore.stats(),
    ]);
    res.json({
      filter,
      drops: applyFilter(drops, filter).slice(0, limit),
      stats: { ...stats, online: presence.display() },
    });
  })
);

/** GET /api/live/stats — today's totals + online count. */
dropsRouter.get(
  '/live/stats',
  apiLimiter,
  asyncRoute(async (_req, res) => {
    const stats = await dropsStore.stats();
    res.json({ ...stats, online: presence.display() });
  })
);

/**
 * POST /api/live/drop
 * Internal ingestion for game services. Requires the shared service key; the
 * payload is validated, de-spammed and throttled inside the ingest pipeline.
 */
dropsRouter.post(
  '/live/drop',
  ingestLimiter,
  requireService,
  asyncRoute(async (req, res) => {
    const result = await ingestDrop(req.body);
    if (!result.ok && result.status === 422) {
      return res.status(422).json({ error: 'Invalid drop', details: result.errors });
    }
    if (!result.ok) {
      return res.status(202).json({ accepted: false, skipped: result.skipped });
    }
    return res.status(202).json({ accepted: true, id: result.drop.id });
  })
);

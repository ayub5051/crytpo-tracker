/* ============================================================================
   BLAZZER — Upgrade API (Stage 3.4)
   Two routes, both authenticated, both rate-limited, both zod-validated:

     POST /api/upgrade/play      consume the stake, settle, grant on a win
     GET  /api/upgrade/history   the caller's recent Upgrades, with proofs

   The play endpoint accepts an `Idempotency-Key` header so a retried PLAY
   settles exactly once — without it, a flaky connection could consume the same
   stake twice, which is the one failure mode this game must never have.
   ========================================================================= */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { upgradePlayLimiter, upgradeReadLimiter } from '../rateLimit.js';
import { MAX_INPUTS } from '../../js/upgrade-rules.js';
import { history, play } from '../upgrade/manager.js';

export const upgradeRouter = Router();

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function fail(res, err) {
  if (err?.status) return res.status(err.status).json({ error: err.message });
  throw err;
}

const PlayBody = z
  .object({
    itemIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_INPUTS),
    targetCatalogueId: z.string().min(1).max(64),
  })
  .strict();

const HistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** Settle one Upgrade. */
upgradeRouter.post(
  '/upgrade/play',
  requireAuth,
  upgradePlayLimiter,
  asyncRoute(async (req, res) => {
    const parsed = PlayBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        error: 'Invalid input',
        details: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
      });
    }

    const raw = req.get('Idempotency-Key');
    const idempotencyKey = typeof raw === 'string' && raw.length && raw.length <= 128 ? raw : null;

    try {
      const result = await play({
        userId: req.user.sub,
        itemIds: parsed.data.itemIds,
        targetCatalogueId: parsed.data.targetCatalogueId,
        idempotencyKey,
        ip: req.ip,
      });
      res.json(result);
    } catch (err) {
      fail(res, err);
    }
  })
);

/** The caller's recent Upgrades. */
upgradeRouter.get(
  '/upgrade/history',
  requireAuth,
  upgradeReadLimiter,
  asyncRoute(async (req, res) => {
    const parsed = HistoryQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({
        error: 'Invalid input',
        details: parsed.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`),
      });
    }
    res.json(await history(req.user.sub, { limit: parsed.data.limit ?? 25 }));
  })
);

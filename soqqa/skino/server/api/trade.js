/* ============================================================================
   BLAZZER — trade API (Stage 3.3)
     POST   /api/trade/create
     GET    /api/trade/history
     GET    /api/trade/:id
     POST   /api/trade/:id/add-item
     POST   /api/trade/:id/remove-item
     POST   /api/trade/:id/confirm
     POST   /api/trade/:id/final-confirm
     POST   /api/trade/:id/execute
     POST   /api/trade/:id/cancel

   Every route requires auth and validates its input with zod; each mutating
   action has its own rate-limit budget. `/history` is declared before `/:id`
   so it is never captured as an id.
   ========================================================================= */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { apiLimiter, tradeCancelLimiter, tradeConfirmLimiter, tradeCreateLimiter, tradeItemLimiter } from '../rateLimit.js';
import {
  addItem,
  cancel,
  confirm,
  create,
  execute,
  finalConfirm,
  getState,
  history,
  removeItem,
} from '../trade/manager.js';

export const tradeRouter = Router();

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function fail(res, err) {
  if (err?.status) return res.status(err.status).json({ error: err.message, missing: err.missing });
  throw err;
}

const IdParams = z.object({ id: z.string().min(1).max(40) });

const CreateBody = z.object({
  items: z.array(z.string().min(1).max(64)).min(1).max(20),
});

const ItemBody = z.object({ uid: z.string().min(1).max(64) });
const ReasonBody = z.object({ reason: z.string().max(200).optional() }).optional();

/** Display name for the trade party (guest tokens carry none). */
function displayName(req) {
  const name = req.user?.name;
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : 'Trader';
}

tradeRouter.post(
  '/trade/create',
  requireAuth,
  tradeCreateLimiter,
  asyncRoute(async (req, res) => {
    const parsed = CreateBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(422).json({ error: 'Select between 1 and 20 items' });
    try {
      const trade = await create({
        initiatorId: req.user.sub,
        initiatorName: displayName(req),
        items: parsed.data.items,
        ip: req.ip,
      });
      return res.status(201).json({ trade });
    } catch (err) {
      return fail(res, err);
    }
  })
);

tradeRouter.get(
  '/trade/history',
  requireAuth,
  apiLimiter,
  asyncRoute(async (req, res) => {
    res.json({ trades: await history(req.user.sub) });
  })
);

tradeRouter.get(
  '/trade/:id',
  requireAuth,
  apiLimiter,
  asyncRoute(async (req, res) => {
    const parsed = IdParams.safeParse(req.params);
    if (!parsed.success) return res.status(422).json({ error: 'Invalid trade id' });
    try {
      return res.json({ trade: await getState(parsed.data.id, req.user.sub) });
    } catch (err) {
      return fail(res, err);
    }
  })
);

tradeRouter.post(
  '/trade/:id/add-item',
  requireAuth,
  tradeItemLimiter,
  asyncRoute(async (req, res) => {
    const params = IdParams.safeParse(req.params);
    const body = ItemBody.safeParse(req.body ?? {});
    if (!params.success || !body.success) return res.status(422).json({ error: 'Invalid item' });
    try {
      const trade = await addItem({ userId: req.user.sub, id: params.data.id, uid: body.data.uid });
      return res.json({ trade });
    } catch (err) {
      return fail(res, err);
    }
  })
);

tradeRouter.post(
  '/trade/:id/remove-item',
  requireAuth,
  tradeItemLimiter,
  asyncRoute(async (req, res) => {
    const params = IdParams.safeParse(req.params);
    const body = ItemBody.safeParse(req.body ?? {});
    if (!params.success || !body.success) return res.status(422).json({ error: 'Invalid item' });
    try {
      const trade = await removeItem({ userId: req.user.sub, id: params.data.id, uid: body.data.uid });
      return res.json({ trade });
    } catch (err) {
      return fail(res, err);
    }
  })
);

tradeRouter.post(
  '/trade/:id/confirm',
  requireAuth,
  tradeConfirmLimiter,
  asyncRoute(async (req, res) => {
    const parsed = IdParams.safeParse(req.params);
    if (!parsed.success) return res.status(422).json({ error: 'Invalid trade id' });
    try {
      return res.json({ trade: await confirm({ userId: req.user.sub, id: parsed.data.id }) });
    } catch (err) {
      return fail(res, err);
    }
  })
);

tradeRouter.post(
  '/trade/:id/final-confirm',
  requireAuth,
  tradeConfirmLimiter,
  asyncRoute(async (req, res) => {
    const parsed = IdParams.safeParse(req.params);
    if (!parsed.success) return res.status(422).json({ error: 'Invalid trade id' });
    try {
      return res.json({ trade: await finalConfirm({ userId: req.user.sub, id: parsed.data.id }) });
    } catch (err) {
      return fail(res, err);
    }
  })
);

tradeRouter.post(
  '/trade/:id/execute',
  requireAuth,
  tradeConfirmLimiter,
  asyncRoute(async (req, res) => {
    const parsed = IdParams.safeParse(req.params);
    if (!parsed.success) return res.status(422).json({ error: 'Invalid trade id' });
    try {
      return res.json({ trade: await execute({ userId: req.user.sub, id: parsed.data.id, ip: req.ip }) });
    } catch (err) {
      return fail(res, err);
    }
  })
);

tradeRouter.post(
  '/trade/:id/cancel',
  requireAuth,
  tradeCancelLimiter,
  asyncRoute(async (req, res) => {
    const params = IdParams.safeParse(req.params);
    const body = ReasonBody.safeParse(req.body ?? {});
    if (!params.success) return res.status(422).json({ error: 'Invalid trade id' });
    const reason = body.success ? body.data?.reason : undefined;
    try {
      return res.json({ trade: await cancel({ userId: req.user.sub, id: params.data.id, reason }) });
    } catch (err) {
      return fail(res, err);
    }
  })
);

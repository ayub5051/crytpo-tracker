/* ============================================================================
   BLAZZER — inventory API (Stage 3.1)
   The read/remove surface for a user's owned items:

     GET    /api/inventory        paginated list (newest first by default)
     GET    /api/inventory/:id    one item, if the caller owns it
     DELETE /api/inventory/:id    remove, unless listed or trade-locked

   Every route requires auth (guest or user JWT) and is rate-limited; every
   input is validated with zod before it reaches the manager.
   ========================================================================= */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { apiLimiter } from '../rateLimit.js';
import { getItem, listInventory, removeItem } from '../inventory/manager.js';

export const inventoryRouter = Router();

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const SORTS = ['newest', 'oldest', 'value-desc', 'value-asc'];

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(64).optional(),
  sort: z.enum(SORTS).optional(),
});

const ItemParams = z.object({ id: z.string().min(1).max(64) });

/** Map a thrown { status, message } into an HTTP response. */
function fail(res, err) {
  if (err?.status) return res.status(err.status).json({ error: err.message });
  throw err;
}

/** GET /api/inventory — the caller's items, paginated. */
inventoryRouter.get(
  '/inventory',
  requireAuth,
  apiLimiter,
  asyncRoute(async (req, res) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({
        error: 'Invalid query',
        details: parsed.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`),
      });
    }
    const { limit, cursor, sort } = parsed.data;
    const result = await listInventory(req.user.sub, { limit, cursor, sort });
    res.json(result);
  })
);

/** GET /api/inventory/:id — one owned item. */
inventoryRouter.get(
  '/inventory/:id',
  requireAuth,
  apiLimiter,
  asyncRoute(async (req, res) => {
    const parsed = ItemParams.safeParse(req.params);
    if (!parsed.success) return res.status(422).json({ error: 'Invalid item id' });
    const item = await getItem(req.user.sub, parsed.data.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    return res.json({ item });
  })
);

/** DELETE /api/inventory/:id — remove an item (not if listed or locked). */
inventoryRouter.delete(
  '/inventory/:id',
  requireAuth,
  apiLimiter,
  asyncRoute(async (req, res) => {
    const parsed = ItemParams.safeParse(req.params);
    if (!parsed.success) return res.status(422).json({ error: 'Invalid item id' });
    try {
      const item = await removeItem(req.user.sub, { id: parsed.data.id, ip: req.ip });
      return res.json({ ok: true, id: item.id, itemId: item.itemId });
    } catch (err) {
      return fail(res, err);
    }
  })
);

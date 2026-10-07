/* ============================================================================
   BLAZZER — marketplace API (Stage 3.2)
   The browse/detail/read surface, plus the four mutating actions (list, buy,
   cancel, edit). Every mutating action carries its own rate-limit budget so a
   runaway client cannot spam the trade engine. Every input is zod-validated
   before it reaches the manager, and the buy endpoint accepts an
   `Idempotency-Key` header so a retried request settles exactly once.

     GET    /api/market/browse
     GET    /api/market/item/:id
     GET    /api/market/my-listings
     GET    /api/market/suggest-price
     POST   /api/market/list
     POST   /api/market/buy/:id
     POST   /api/market/cancel/:id
     POST   /api/market/edit/:id
   ========================================================================= */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import {
  marketBuyLimiter,
  marketCancelLimiter,
  marketEditLimiter,
  marketListLimiter,
  apiLimiter,
} from '../rateLimit.js';
import {
  browse,
  buy,
  cancel,
  edit,
  getListing,
  list,
  myListings,
  suggest,
  balanceOf,
} from '../market/manager.js';

export const marketRouter = Router();

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function fail(res, err) {
  if (err?.status) return res.status(err.status).json({ error: err.message });
  throw err;
}

/** Accept `a,b,c`, repeated params, or a real array — always a string[]. */
const toArray = (value) => {
  if (value === undefined) return undefined;
  const parts = Array.isArray(value) ? value : String(value).split(',');
  const out = parts.map((p) => String(p).trim()).filter(Boolean);
  return out.length ? out : undefined;
};

const BrowseQuery = z.object({
  q: z.string().max(80).optional(),
  sort: z.enum(['newest', 'price-asc', 'price-desc', 'ending-soon', 'rating']).optional(),
  page: z.coerce.number().int().min(1).max(5000).optional(),
  pageSize: z.coerce.number().int().min(1).max(60).optional(),
  priceMin: z.coerce.number().int().min(0).optional(),
  priceMax: z.coerce.number().int().min(0).optional(),
  stattrakOnly: z.coerce.boolean().optional(),
  ratingMin: z.coerce.number().min(0).max(5).optional(),
  rarity: z.preprocess(toArray, z.array(z.string().max(32)).optional()),
  wear: z.preprocess(toArray, z.array(z.string().max(32)).optional()),
  category: z.preprocess(toArray, z.array(z.string().max(32)).optional()),
});

const ListBody = z.object({
  itemId: z.string().min(1).max(64),
  price: z.number().int().min(1).max(1_000_000),
  duration: z.enum(['1h', '6h', '24h', '3d', '7d']).optional(),
  meta: z
    .object({
      catalogueId: z.string().max(64).optional(),
      weapon: z.string().max(48).optional(),
      finish: z.string().max(48).optional(),
      condition: z.string().max(32).optional(),
      rarity: z.string().max(32).optional(),
    })
    .optional(),
  seller: z
    .object({
      id: z.string().max(64).optional(),
      name: z.string().max(40).optional(),
      rating: z.number().min(0).max(5).optional(),
      sales: z.number().int().min(0).optional(),
    })
    .optional(),
});

const EditBody = z.object({ price: z.number().int().min(1).max(1_000_000) });

const SuggestQuery = z.object({
  itemId: z.string().min(1).max(64),
  value: z.coerce.number().int().min(0).max(10_000_000).optional(),
});

const IdParams = z.object({ id: z.string().min(1).max(64) });

/* ------------------------------------------------------------------ browse */

marketRouter.get(
  '/market/browse',
  requireAuth,
  apiLimiter,
  asyncRoute(async (req, res) => {
    const parsed = BrowseQuery.safeParse(req.query);
    if (!parsed.success) return res.status(422).json({ error: 'Invalid query', details: parsed.error.issues });
    const { rarity, wear, category, ...rest } = parsed.data;
    const result = await browse({
      q: rest.q,
      sort: rest.sort,
      page: rest.page,
      pageSize: rest.pageSize,
      filters: {
        priceMin: rest.priceMin,
        priceMax: rest.priceMax,
        stattrakOnly: rest.stattrakOnly,
        ratingMin: rest.ratingMin,
        rarities: rarity,
        wears: wear,
        categories: category,
      },
    });
    res.json(result);
  })
);

/* --------------------------------------------------------- read surfaces */

marketRouter.get(
  '/market/item/:id',
  requireAuth,
  apiLimiter,
  asyncRoute(async (req, res) => {
    const parsed = IdParams.safeParse(req.params);
    if (!parsed.success) return res.status(422).json({ error: 'Invalid listing id' });
    const listing = await getListing(parsed.data.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    res.json({ listing });
  })
);

marketRouter.get(
  '/market/my-listings',
  requireAuth,
  apiLimiter,
  asyncRoute(async (req, res) => {
    const listings = await myListings(req.user.sub);
    res.json({ listings, balance: await balanceOf(req.user.sub) });
  })
);

marketRouter.get(
  '/market/suggest-price',
  requireAuth,
  apiLimiter,
  asyncRoute(async (req, res) => {
    const parsed = SuggestQuery.safeParse(req.query);
    if (!parsed.success) return res.status(422).json({ error: 'Invalid query' });
    res.json(await suggest({ catalogueId: parsed.data.itemId, value: parsed.data.value || 0 }));
  })
);

/* --------------------------------------------------------- mutate actions */

marketRouter.post(
  '/market/list',
  requireAuth,
  marketListLimiter,
  asyncRoute(async (req, res) => {
    const parsed = ListBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(422).json({ error: 'Invalid listing', details: parsed.error.issues });
    try {
      const listing = await list({
        sellerId: req.user.sub,
        itemId: parsed.data.itemId,
        price: parsed.data.price,
        duration: parsed.data.duration,
        meta: parsed.data.meta,
        seller: parsed.data.seller || { id: req.user.sub, name: req.user.name || 'You', rating: 5, sales: 0 },
      });
      return res.status(201).json({ listing });
    } catch (err) {
      return fail(res, err);
    }
  })
);

marketRouter.post(
  '/market/buy/:id',
  requireAuth,
  marketBuyLimiter,
  asyncRoute(async (req, res) => {
    const parsed = IdParams.safeParse(req.params);
    if (!parsed.success) return res.status(422).json({ error: 'Invalid listing id' });
    const idempotencyKey = String(req.headers['idempotency-key'] || '').slice(0, 80) || null;
    try {
      const result = await buy({ buyerId: req.user.sub, listingId: parsed.data.id, idempotencyKey });
      return res.json(result);
    } catch (err) {
      return fail(res, err);
    }
  })
);

marketRouter.post(
  '/market/cancel/:id',
  requireAuth,
  marketCancelLimiter,
  asyncRoute(async (req, res) => {
    const parsed = IdParams.safeParse(req.params);
    if (!parsed.success) return res.status(422).json({ error: 'Invalid listing id' });
    try {
      return res.json(await cancel({ sellerId: req.user.sub, listingId: parsed.data.id }));
    } catch (err) {
      return fail(res, err);
    }
  })
);

marketRouter.post(
  '/market/edit/:id',
  requireAuth,
  marketEditLimiter,
  asyncRoute(async (req, res) => {
    const params = IdParams.safeParse(req.params);
    const body = EditBody.safeParse(req.body ?? {});
    if (!params.success || !body.success) return res.status(422).json({ error: 'Invalid edit request' });
    try {
      const listing = await edit({ sellerId: req.user.sub, listingId: params.data.id, price: body.data.price });
      return res.json({ listing });
    } catch (err) {
      return fail(res, err);
    }
  })
);

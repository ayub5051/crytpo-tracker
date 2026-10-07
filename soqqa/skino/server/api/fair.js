/* ============================================================================
   BLAZZER — provably-fair API
   Public surface for the fairness modal:

     GET  /api/fair/seeds        current commitment + client seed + nonce
     POST /api/fair/client-seed  set the client seed            (5 / minute)
     POST /api/fair/rotate       reveal old seed, commit new     (1 / minute)
     GET  /api/fair/history      past bets with proofs (paged)
     POST /api/fair/verify       server-side verification

   Plus one integration endpoint used by game services to consume the next
   nonce and obtain the deterministic outcome:

     POST /api/fair/outcome      consume nonce → outcome (rate-limited)

   Identity comes from the JWT (guest or user). Every route is rate-limited and
   every input is validated with zod.
   ========================================================================= */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { GAMES } from '../fair/outcome-generator.js';
import {
  consumeOutcome,
  getSeedState,
  listBets,
  rotateSeed,
  setClientSeed,
  verifyWithServer,
} from '../fair/seed-manager.js';

export const fairRouter = Router();

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const userKey = (req) => req.user?.sub || req.ip;

/** Global fairness ceiling — generous, but bounded. */
const fairLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: { error: 'Too many requests.' },
});

/** Client-seed edits: max 5 per minute. */
const clientSeedLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: { error: 'You can change your client seed 5 times per minute.' },
});

/** Rotation: once per 60 seconds. */
const rotateLimiter = rateLimit({
  windowMs: 60_000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: { error: 'You can rotate your seed once per minute.' },
});

/* --- Validation ------------------------------------------------------------ */

const ParamsSchema = z
  .object({
    mines: z.number().int().min(1).max(24).optional(),
    houseEdge: z.number().min(0).max(0.2).optional(),
    tier: z.enum(['bronze', 'silver', 'gold', 'neon']).optional(),
    weights: z.array(z.number().finite().positive()).min(1).max(50).optional(),
    // Upgrade: the win chance the bet was priced at, and the item being aimed
    // for. Both are bound into the digest so the proof covers the exact stake.
    chance: z.number().min(0).max(1).optional(),
    target: z.string().min(1).max(64).optional(),
    stake: z.number().finite().nonnegative().optional(),
  })
  .strict();

const GameSchema = z.enum(GAMES);

const ClientSeedBody = z.object({ clientSeed: z.string().min(1).max(64) });

const VerifyBody = z.object({
  serverSeed: z.string().regex(/^[0-9a-f]{64}$/i, 'Server seed must be 64 hex characters'),
  clientSeed: z.string().min(1).max(64),
  nonce: z.number().int().min(0).max(1_000_000),
  game: GameSchema,
  params: ParamsSchema.optional().default({}),
});

const OutcomeBody = z.object({
  game: GameSchema,
  params: ParamsSchema.optional().default({}),
  amount: z.number().finite().nonnegative().optional().default(0),
});

/** Tiny helper: 400 with zod issues. */
function invalid(res, parsed) {
  return res.status(422).json({
    error: 'Invalid input',
    details: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
  });
}

/* --- Routes ---------------------------------------------------------------- */

/** Current commitment, client seed and nonce. */
fairRouter.get(
  '/fair/seeds',
  requireAuth,
  fairLimiter,
  asyncRoute(async (req, res) => {
    res.json(await getSeedState(req.user.sub, req.ip));
  })
);

/** Replace the client seed (1–64 printable chars). */
fairRouter.post(
  '/fair/client-seed',
  requireAuth,
  clientSeedLimiter,
  asyncRoute(async (req, res) => {
    const parsed = ClientSeedBody.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed);
    try {
      res.json(await setClientSeed(req.user.sub, parsed.data.clientSeed, req.ip));
    } catch (err) {
      if (err.status === 422) return res.status(422).json({ error: err.message });
      throw err;
    }
  })
);

/** Reveal the old server seed and commit a new one. */
fairRouter.post(
  '/fair/rotate',
  requireAuth,
  rotateLimiter,
  asyncRoute(async (req, res) => {
    res.json(await rotateSeed(req.user.sub, req.ip));
  })
);

/** Paginated bet history with proofs. */
fairRouter.get(
  '/fair/history',
  requireAuth,
  fairLimiter,
  asyncRoute(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 50);
    const before = Number(req.query.before) || null;
    res.json(await listBets(req.user.sub, { limit, before }));
  })
);

/** Server-side verification (the client verifies offline too). */
fairRouter.post(
  '/fair/verify',
  requireAuth,
  fairLimiter,
  asyncRoute(async (req, res) => {
    const parsed = VerifyBody.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed);
    const { serverSeed, clientSeed, nonce, game, params } = parsed.data;
    res.json(await verifyWithServer(req.user.sub, { serverSeed, clientSeed, nonce, game, params }));
  })
);

/** Game integration: consume the next nonce and return the outcome. */
fairRouter.post(
  '/fair/outcome',
  requireAuth,
  fairLimiter,
  asyncRoute(async (req, res) => {
    const parsed = OutcomeBody.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed);
    const { game, params, amount } = parsed.data;
    try {
      const result = await consumeOutcome(req.user.sub, { game, params, amount, ip: req.ip });
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  })
);

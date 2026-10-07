/* ============================================================================
   BLAZZER — rate limiting
   Every HTTP surface is limited here, keyed by user when authenticated and by
   IP otherwise. A small token bucket guards WebSocket message handling too.
   ========================================================================= */

import rateLimit from 'express-rate-limit';
import { config } from './config.js';

const keyByUserOrIp = (req) => req.user?.sub || req.ip;

/** General API ceiling. */
export const apiLimiter = rateLimit({
  windowMs: config.rate.windowMs,
  max: config.rate.apiMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { error: 'Too many requests, slow down.' },
});

/** Token minting is tighter — it is the entry point to the socket tier. */
export const tokenLimiter = rateLimit({
  windowMs: config.rate.windowMs,
  max: config.rate.tokenMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { error: 'Too many token requests.' },
});

/** Ingestion is keyed by the calling service, not the end user. */
export const ingestLimiter = rateLimit({
  windowMs: config.rate.windowMs,
  max: config.rate.ingestMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-service-key'] || req.ip,
  message: { error: 'Ingest rate exceeded.' },
});

const marketLimiter = (max) =>
  rateLimit({
    windowMs: config.market.rate.windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByUserOrIp,
    message: { error: 'Too many market actions, slow down.' },
  });

/** Listing, buying, cancelling and re-pricing each get their own budget. */
export const marketListLimiter = marketLimiter(config.market.rate.listMax);
export const marketBuyLimiter = marketLimiter(config.market.rate.buyMax);
export const marketCancelLimiter = marketLimiter(config.market.rate.cancelMax);
export const marketEditLimiter = marketLimiter(config.market.rate.editMax);

const tradeLimiter = (max) =>
  rateLimit({
    windowMs: config.trade.rate.windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByUserOrIp,
    message: { error: 'Too many trade actions, slow down.' },
  });

/** Creating trades, editing sides, confirming and cancelling each get a budget. */
export const tradeCreateLimiter = tradeLimiter(config.trade.rate.createMax);
export const tradeItemLimiter = tradeLimiter(config.trade.rate.itemMax);
export const tradeConfirmLimiter = tradeLimiter(config.trade.rate.confirmMax);
export const tradeCancelLimiter = tradeLimiter(config.trade.rate.cancelMax);

const upgradeLimiter = (max) =>
  rateLimit({
    windowMs: config.upgrade.rate.windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByUserOrIp,
    message: { error: 'Too many upgrades, slow down.' },
  });

/** Playing consumes real items, so it gets a tighter budget than reading. */
export const upgradePlayLimiter = upgradeLimiter(config.upgrade.rate.playMax);
export const upgradeReadLimiter = upgradeLimiter(config.upgrade.rate.readMax);

/**
 * A refill-over-time token bucket. Returns `take(cost) -> boolean`.
 * Used to cap inbound WebSocket messages per connection.
 */
export function createTokenBucket({ rate, burst }) {
  let tokens = burst;
  let last = Date.now();
  return function take(cost = 1) {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * rate);
    last = now;
    if (tokens >= cost) {
      tokens -= cost;
      return true;
    }
    return false;
  };
}

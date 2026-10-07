-- ============================================================================
-- BLAZZER — Stage 3.2 · secondary-market tables
--
-- Builds on 0001_stage3_inventory.sql, which already created market_listings.
-- This migration
--   * denormalises the catalogue metadata a listing needs to be filterable
--     server-side (rarity / weapon / wear / StatTrak), and
--   * adds the three supporting collections the manager settles against:
--     market_sales (price history), market_wallets (demo balance) and
--     market_idempotency_keys (retry-safe purchases).
--
-- Idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), so re-running is safe.
--
--   psql "$DATABASE_URL" -f server/db/migrations/0002_stage3_market.sql
-- ============================================================================

BEGIN;

-- ------------------------------------------------- market_listings · metadata
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS "catalogueId" TEXT;
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS weapon        TEXT NOT NULL DEFAULT '';
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS finish        TEXT NOT NULL DEFAULT '';
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS condition     TEXT NOT NULL DEFAULT '';
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS rarity        TEXT NOT NULL DEFAULT 'Consumer';
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS stattrak      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS "floatValue"  DOUBLE PRECISION;
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS stickers      JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS "fairProof"   JSONB;

CREATE INDEX IF NOT EXISTS market_listings_active_expiry_idx
  ON market_listings ("expiresAt") WHERE status = 'active';
CREATE INDEX IF NOT EXISTS market_listings_catalogue_idx
  ON market_listings ("catalogueId");

-- ------------------------------------------------------------------ market_sales
CREATE TABLE IF NOT EXISTS market_sales (
  id          TEXT        PRIMARY KEY,
  "listingId" TEXT        NOT NULL,
  "itemId"    TEXT        NOT NULL, -- catalogue skin id
  price       INTEGER     NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT market_sales_price_positive CHECK (price > 0)
);

CREATE INDEX IF NOT EXISTS market_sales_item_created_idx
  ON market_sales ("itemId", "createdAt" DESC);

-- --------------------------------------------------------------- market_wallets
-- Demo-only Crystal balances so a purchase has two sides to settle. The browser
-- client is authoritative for the local demo; this is the server ledger.
CREATE TABLE IF NOT EXISTS market_wallets (
  "userId"    TEXT        PRIMARY KEY,
  balance     BIGINT      NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT market_wallets_balance_non_negative CHECK (balance >= 0)
);

-- ----------------------------------------------------- market_idempotency_keys
CREATE TABLE IF NOT EXISTS market_idempotency_keys (
  key         TEXT        PRIMARY KEY,
  "userId"    TEXT        NOT NULL,
  scope       TEXT        NOT NULL,
  result      JSONB       NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_idempotency_user_idx
  ON market_idempotency_keys ("userId", "createdAt" DESC);

COMMIT;

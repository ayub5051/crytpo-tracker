-- ============================================================================
-- BLAZZER — Stage 3 · inventory + trading tables
--
-- This is the hand-written equivalent of `prisma migrate dev` for the models in
-- server/prisma/schema.prisma (InventoryItem, MarketListing, Trade, Gift,
-- UpgradeAttempt, TransferAudit). Apply it directly when you are running
-- Postgres without Prisma:
--
--   psql "$DATABASE_URL" -f server/db/migrations/0001_stage3_inventory.sql
--
-- Every statement is idempotent (IF NOT EXISTS), so re-running is safe.
-- Money is stored as BIGINT Crystals; item ids are TEXT because they are
-- app-generated cuids, not database sequences.
-- ============================================================================

BEGIN;

-- ------------------------------------------------------------- inventory_items
CREATE TABLE IF NOT EXISTS inventory_items (
  id                 TEXT        PRIMARY KEY,
  "userId"           TEXT        NOT NULL,
  "itemId"           TEXT        NOT NULL,
  value              INTEGER     NOT NULL DEFAULT 0,
  "obtainedAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "obtainedVia"      TEXT        NOT NULL DEFAULT 'purchase',
  stickers           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  stattrak           BOOLEAN     NOT NULL DEFAULT false,
  "floatValue"       DOUBLE PRECISION,
  "isListed"         BOOLEAN     NOT NULL DEFAULT false,
  price              INTEGER,
  "tradeLocked"      BOOLEAN     NOT NULL DEFAULT false,
  "tradeLockedUntil" TIMESTAMPTZ,
  "fairProof"        JSONB,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_items_user_obtained_idx
  ON inventory_items ("userId", "obtainedAt" DESC);
CREATE INDEX IF NOT EXISTS inventory_items_item_idx
  ON inventory_items ("itemId");
CREATE INDEX IF NOT EXISTS inventory_items_listed_idx
  ON inventory_items ("isListed") WHERE "isListed" = true;

-- ------------------------------------------------------------- market_listings
CREATE TABLE IF NOT EXISTS market_listings (
  id          TEXT        PRIMARY KEY,
  "itemId"    TEXT        NOT NULL UNIQUE, -- one active listing per item
  "sellerId"  TEXT        NOT NULL,
  price       INTEGER     NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expiresAt" TIMESTAMPTZ NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'active',
  "buyerId"   TEXT,
  "soldAt"    TIMESTAMPTZ,
  CONSTRAINT market_listings_price_positive CHECK (price > 0),
  CONSTRAINT market_listings_status_check
    CHECK (status IN ('active', 'sold', 'cancelled', 'expired'))
);

CREATE INDEX IF NOT EXISTS market_listings_status_created_idx
  ON market_listings (status, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS market_listings_seller_idx
  ON market_listings ("sellerId");

-- ---------------------------------------------------------------------- trades
CREATE TABLE IF NOT EXISTS trades (
  id                TEXT        PRIMARY KEY,
  "initiatorId"     TEXT        NOT NULL,
  "receiverId"      TEXT        NOT NULL,
  "initiatorItems"  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  "receiverItems"   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  "initiatorOk"     BOOLEAN     NOT NULL DEFAULT false,
  "receiverOk"      BOOLEAN     NOT NULL DEFAULT false,
  status            TEXT        NOT NULL DEFAULT 'pending',
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expiresAt"       TIMESTAMPTZ NOT NULL,
  "completedAt"     TIMESTAMPTZ,
  CONSTRAINT trades_status_check
    CHECK (status IN ('pending', 'accepted', 'cancelled', 'completed', 'expired'))
);

CREATE INDEX IF NOT EXISTS trades_status_created_idx
  ON trades (status, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS trades_initiator_idx ON trades ("initiatorId");
CREATE INDEX IF NOT EXISTS trades_receiver_idx  ON trades ("receiverId");

-- ----------------------------------------------------------------------- gifts
CREATE TABLE IF NOT EXISTS gifts (
  id          TEXT        PRIMARY KEY,
  "senderId"  TEXT        NOT NULL,
  "receiverId" TEXT       NOT NULL,
  "itemId"    TEXT        NOT NULL,
  message     TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "claimedAt" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS gifts_receiver_created_idx
  ON gifts ("receiverId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS gifts_sender_created_idx
  ON gifts ("senderId", "createdAt" DESC);

-- ------------------------------------------------------------- upgrade_attempts
CREATE TABLE IF NOT EXISTS upgrade_attempts (
  id           TEXT        PRIMARY KEY,
  "userId"     TEXT        NOT NULL,
  "inputItems" JSONB       NOT NULL DEFAULT '[]'::jsonb,
  "targetItem" TEXT        NOT NULL,
  odds         DOUBLE PRECISION NOT NULL,
  result       TEXT        NOT NULL,
  "fairProof"  JSONB,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT upgrade_attempts_odds_check CHECK (odds >= 0 AND odds <= 1),
  CONSTRAINT upgrade_attempts_result_check CHECK (result IN ('win', 'lose'))
);

CREATE INDEX IF NOT EXISTS upgrade_attempts_user_created_idx
  ON upgrade_attempts ("userId", "createdAt" DESC);

-- ------------------------------------------------------------- transfer_audits
CREATE TABLE IF NOT EXISTS transfer_audits (
  id            TEXT        PRIMARY KEY,
  "itemId"      TEXT        NOT NULL,
  "fromUserId"  TEXT,
  "toUserId"    TEXT,
  reason        TEXT        NOT NULL,
  ip            TEXT,
  meta          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transfer_audits_item_created_idx
  ON transfer_audits ("itemId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS transfer_audits_to_created_idx
  ON transfer_audits ("toUserId", "createdAt" DESC);

COMMIT;

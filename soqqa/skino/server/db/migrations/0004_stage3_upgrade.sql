-- ============================================================================
-- BLAZZER — Stage 3.4 · upgrade (trade-up wheel)
--
-- One row per settled Upgrade. The stake is consumed on both outcomes, so
-- `consumedItemIds` is the authoritative record of what was destroyed and
-- `grantedItemId` is the single item handed out on a win.
--
-- `chance` is stored alongside `stake`/`targetValue` so the pricing of a
-- historical Upgrade can be re-derived from the row alone, and `digest` +
-- `nonce` + `serverSeedHash` are the provably-fair proof for the outcome.
--
-- Idempotent, so re-running is safe:
--   psql "$DATABASE_URL" -f server/db/migrations/0004_stage3_upgrade.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS upgrades (
  id                TEXT PRIMARY KEY,
  "userId"          TEXT NOT NULL,
  stake             INTEGER NOT NULL,
  "inputCount"      INTEGER NOT NULL,
  target            TEXT NOT NULL,
  "targetName"      TEXT NOT NULL,
  "targetValue"     INTEGER NOT NULL,
  chance            DOUBLE PRECISION NOT NULL,
  multiplier        DOUBLE PRECISION NOT NULL,
  win               BOOLEAN NOT NULL,
  "grantedItemId"   TEXT,
  "consumedItemIds" TEXT[] NOT NULL DEFAULT '{}',
  -- Provably-fair proof: the bet this Upgrade was settled against.
  nonce             INTEGER NOT NULL,
  digest            TEXT NOT NULL,
  "serverSeedHash"  TEXT NOT NULL,
  "clientSeed"      TEXT NOT NULL,
  "createdAt"       BIGINT NOT NULL
);

-- History is always queried "mine, newest first".
CREATE INDEX IF NOT EXISTS upgrades_user_time_idx
  ON upgrades ("userId", "createdAt" DESC);

-- Support tooling: how much value has been consumed, and what the house kept.
CREATE INDEX IF NOT EXISTS upgrades_time_idx
  ON upgrades ("createdAt" DESC);

CREATE INDEX IF NOT EXISTS upgrades_outcome_idx
  ON upgrades (win, "createdAt" DESC);

COMMIT;

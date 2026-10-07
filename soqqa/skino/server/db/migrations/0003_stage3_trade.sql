-- ============================================================================
-- BLAZZER — Stage 3.3 · trade system
--
-- trade table was created in 0001_stage3_inventory.sql. Each side confirms
-- twice: the first confirmation locks that side, the second (final) is the
-- "yes, swap it" step. Both final flags set → the atomic swap runs.
--
-- Idempotent, so re-running is safe:
--   psql "$DATABASE_URL" -f server/db/migrations/0003_stage3_trade.sql
-- ============================================================================

BEGIN;

ALTER TABLE trades ADD COLUMN IF NOT EXISTS "initiatorFinalConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS "receiverFinalConfirmed"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS "cancelReason"             TEXT;

CREATE INDEX IF NOT EXISTS trades_pending_expiry_idx
  ON trades ("expiresAt") WHERE status IN ('pending', 'ready');

-- A trade can be looked up by its short share code as well as its id.
CREATE INDEX IF NOT EXISTS trades_initiator_receiver_idx
  ON trades ("initiatorId", "receiverId");

COMMIT;

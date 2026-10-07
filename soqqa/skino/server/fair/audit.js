/* ============================================================================
   BLAZZER — provably-fair audit trail
   Every fairness-affecting action is logged (who, what, when, from where) so
   rotations are accountable and disputes are answerable. Writes are
   best-effort: an audit failure must never break a bet.
   ========================================================================= */

import { randomUUID } from 'node:crypto';
import { fairStore } from './store.js';

export const AUDIT_ACTIONS = {
  SEED_INIT: 'seed.init',
  SEED_ROTATE: 'seed.rotate',
  CLIENT_SEED: 'client-seed.update',
  BET: 'bet.placed',
  VERIFY: 'verify.run',
};

/** Append an audit entry. Never throws. */
export async function logFairEvent({ userId, action, ip = null, meta = {} }) {
  const entry = {
    id: `a_${randomUUID()}`,
    userId,
    action,
    ip,
    meta,
    createdAt: Date.now(),
  };
  try {
    await fairStore().appendAudit(entry);
  } catch (err) {
    console.warn('[fair:audit] write failed:', err.message);
  }
  return entry;
}

export async function listFairAudit(userId, limit = 50) {
  try {
    return await fairStore().listAudit(userId, limit);
  } catch {
    return [];
  }
}

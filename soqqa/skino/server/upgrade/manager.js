/* ============================================================================
   BLAZZER — Upgrade manager (Stage 3.4)
   The only place an Upgrade is priced and settled. One critical section:

     1. re-read every staked item INSIDE the lock, re-checking ownership,
        listing state and trade locks (a racing sale or trade cannot slip past)
     2. price the play with `assess()` imported straight from js/upgrade-rules.js
        — the SAME module the browser uses, so the odds shown are the odds
        settled, to the last bit of the float
     3. consume the next provably-fair nonce to get the one bit that decides it
     4. settle: the stake leaves either way; a win grants the target

   Step 2 is why the rules module is shared rather than mirrored. Every other
   catalogue in this codebase is duplicated with a lockstep comment (the wheel
   segments, the case tiers) because those are static tables; the Upgrade's
   price is a *computed* value, and two copies of it would eventually disagree.

   Errors are thrown as { status, message } and mapped straight to HTTP codes.
   ========================================================================= */

import { randomUUID } from 'node:crypto';
import { getSkinById } from '../../js/skins.js';
import { assess, blockMessage, MAX_INPUTS, MIN_INPUTS } from '../../js/upgrade-rules.js';
import { upgradeStore } from './store.js';
import { inventoryStore } from '../inventory/store.js';
import { isTradeLocked } from '../inventory/manager.js';
import { logTransfer, TRANSFER_REASONS } from '../utils/audit.js';
import { withLocks } from '../utils/locking.js';
import { consumeOutcome } from '../fair/seed-manager.js';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Public projection of a settled Upgrade (the shape the client stores). */
export function publicUpgrade(row) {
  if (!row) return null;
  return {
    id: row.id,
    stake: row.stake,
    inputCount: row.inputCount,
    target: row.target,
    targetName: row.targetName,
    targetValue: row.targetValue,
    chance: row.chance,
    win: row.win,
    grantedItemId: row.grantedItemId,
    fairProof: row.fairProof,
    createdAt: row.createdAt,
  };
}

/**
 * Play one Upgrade.
 *
 * @param {object} input
 * @param {string} input.userId
 * @param {string[]} input.itemIds        inventory item ids (the stake)
 * @param {string} input.targetCatalogueId the skin being aimed for
 * @param {string|null} [input.idempotencyKey]
 * @param {string|null} [input.ip]
 */
export async function play({
  userId,
  itemIds,
  targetCatalogueId,
  idempotencyKey = null,
  ip = null,
}) {
  if (!Array.isArray(itemIds)) throw httpError(422, 'itemIds must be an array');

  const ids = itemIds.map((id) => String(id));
  if (new Set(ids).size !== ids.length) throw httpError(422, 'The stake contains duplicate items');
  if (ids.length < MIN_INPUTS) throw httpError(422, `Stake at least ${MIN_INPUTS} item`);
  if (ids.length > MAX_INPUTS) throw httpError(422, `Stake at most ${MAX_INPUTS} items`);

  const target = getSkinById(String(targetCatalogueId || ''));
  if (!target) throw httpError(404, 'Target item not found');

  const key = idempotencyKey ? `upgrade:${userId}:${idempotencyKey}` : null;
  if (key) {
    const cached = await upgradeStore().getIdempotency(key);
    if (cached) return cached;
  }

  const lockKeys = [`user:${userId}`, ...ids.map((id) => `item:${id}`)];

  return withLocks(lockKeys, async () => {
    // Re-check inside the lock: a retried request may have lost the race.
    if (key) {
      const cached = await upgradeStore().getIdempotency(key);
      if (cached) return cached;
    }

    /* ---- 1. the stake, re-read and re-validated ------------------------- */

    const staked = [];
    for (const uid of ids) {
      const item = await inventoryStore().getItem(uid);
      if (!item || item.userId !== userId) throw httpError(404, 'An item in your stake was not found');
      if (item.isListed) throw httpError(409, 'An item in your stake is listed for sale');
      if (isTradeLocked(item)) throw httpError(409, 'An item in your stake is trade-locked');

      const skin = getSkinById(item.itemId);
      if (!skin) throw httpError(422, 'An item in your stake is not in the catalogue');
      staked.push({ item, skin });
    }

    /* ---- 2. price it (the shared rule) ---------------------------------- */

    const stake = staked.reduce((sum, entry) => sum + entry.skin.price, 0);
    const assessment = assess({
      inputValue: stake,
      targetValue: target.price,
      inputCount: staked.length,
    });
    if (!assessment.ok) throw httpError(422, blockMessage(assessment.reason));

    /* ---- 3. the outcome is decided here, before anything moves ---------- */

    const { bet, serverSeedHash, clientSeed, nextNonce } = await consumeOutcome(userId, {
      game: 'upgrade',
      params: { chance: assessment.chance, target: target.id, stake },
      amount: stake,
      ip,
    });

    // The generator clamps too; trust its value so the recorded chance is
    // exactly the one the digest was compared against.
    const chance = bet.outcome.chance;
    const win = Boolean(bet.outcome.win);

    /* ---- 4. settle ------------------------------------------------------- */

    const upgradeId = `u_${randomUUID()}`;
    const now = Date.now();

    for (const { item } of staked) {
      await inventoryStore().deleteItem(item.id);
      await logTransfer({
        itemId: item.id,
        fromUserId: userId,
        toUserId: null, // consumed — the stake is gone either way
        reason: TRANSFER_REASONS.UPGRADE,
        ip,
        meta: { upgradeId, catalogueId: item.itemId, chance, win, outcome: 'staked' },
      });
    }

    let granted = null;
    if (win) {
      granted = {
        id: `i_${randomUUID()}`,
        userId,
        itemId: target.id,
        value: target.price,
        obtainedAt: now,
        obtainedVia: 'upgrade',
        stickers: [],
        stattrak: false,
        floatValue: null,
        isListed: false,
        price: null,
        tradeLocked: false,
        tradeLockedUntil: null,
        fairProof: {
          game: 'upgrade',
          nonce: bet.nonce,
          digest: bet.digest,
          serverSeedHash,
          clientSeed,
          chance,
        },
        createdAt: now,
        updatedAt: now,
      };
      await inventoryStore().saveItem(granted);
      await logTransfer({
        itemId: granted.id,
        fromUserId: null,
        toUserId: userId,
        reason: TRANSFER_REASONS.GRANT,
        ip,
        meta: { upgradeId, catalogueId: target.id, obtainedVia: 'upgrade' },
      });
    }

    const row = {
      id: upgradeId,
      userId,
      stake,
      inputCount: staked.length,
      target: target.id,
      targetName: `${target.weapon} | ${target.finish}`,
      targetValue: target.price,
      chance,
      multiplier: assessment.multiplier,
      win,
      grantedItemId: granted ? granted.id : null,
      consumedItemIds: staked.map(({ item }) => item.id),
      fairProof: {
        game: 'upgrade',
        nonce: bet.nonce,
        digest: bet.digest,
        serverSeedHash,
        clientSeed,
      },
      createdAt: now,
    };
    await upgradeStore().appendHistory(row);

    const result = {
      ok: true,
      upgrade: publicUpgrade(row),
      win,
      chance,
      multiplier: assessment.multiplier,
      stake,
      targetValue: target.price,
      grantedItemId: granted ? granted.id : null,
      fair: {
        nonce: bet.nonce,
        digest: bet.digest,
        serverSeedHash,
        clientSeed,
        nextNonce,
      },
    };

    if (key) await upgradeStore().putIdempotency(key, result);
    return result;
  });
}

/** Recent Upgrades for the caller, newest first. */
export async function history(userId, { limit = 25 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const rows = await upgradeStore().listHistory(userId, size);
  return { upgrades: rows.map(publicUpgrade) };
}

/* ============================================================================
   BLAZZER — concurrency control
   Every item transfer in Stage 3 must be atomic: two buyers racing on one
   listing, or a trade confirming while the same item is being gifted, must
   never double-spend an item. We defend in two layers:

     1. An in-process, keyed async mutex (`withLock` / `withLocks`). This is the
        only guard the dependency-free file store has, and it also serialises
        writes before they reach Postgres.
     2. `selectForUpdate`, which takes real row locks (`SELECT ... FOR UPDATE`)
        inside a Prisma transaction when Postgres is in play — the belt to the
        mutex's braces.

   Locks are always acquired in sorted key order so two multi-item operations
   can never deadlock on each other.
   ========================================================================= */

/** key -> tail promise of the current queue for that key */
const chains = new Map();

/** A promise plus its resolver, used to gate the next waiter in a chain. */
function createGate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/**
 * Run `fn` while holding an exclusive lock on `key`. Calls with the same key
 * run strictly one-after-another; different keys run concurrently.
 *
 * @template T
 * @param {string} key
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withLock(key, fn) {
  const prev = chains.get(key) ?? Promise.resolve();
  const gate = createGate();
  const mine = prev.then(() => gate.promise);
  chains.set(key, mine);

  // A rejected predecessor must not poison the queue, hence the `.catch`.
  return Promise.resolve(prev)
    .catch(() => {})
    .then(fn)
    .finally(() => {
      gate.release();
      if (chains.get(key) === mine) chains.delete(key);
    });
}

/**
 * Hold several locks at once, acquired in sorted order to avoid deadlock.
 *
 * @template T
 * @param {string[]} keys
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withLocks(keys, fn) {
  const ordered = [...new Set(keys)].filter(Boolean).sort();
  const acquire = (i) =>
    i >= ordered.length ? Promise.resolve(fn()) : withLock(ordered[i], () => acquire(i + 1));
  return Promise.resolve().then(() => acquire(0));
}

/** Convenience wrapper: lock one or more inventory items by id. */
export function withItemLocks(itemIds, fn) {
  const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
  return withLocks(ids.map((id) => `item:${id}`), fn);
}

/**
 * Best-effort row lock for a Prisma transaction client. Item ids are opaque
 * app-generated cuids, so they are passed as bound parameters — never string
 * concatenated into the statement text.
 *
 * @param {{ $queryRawUnsafe?: Function }} tx  a Prisma transaction client
 * @param {string[]} itemIds
 */
export async function selectForUpdate(tx, itemIds) {
  const ids = (itemIds || []).filter(Boolean);
  if (!ids.length || typeof tx?.$queryRawUnsafe !== 'function') return;
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  await tx.$queryRawUnsafe(
    `SELECT id FROM inventory_items WHERE id IN (${placeholders}) FOR UPDATE`,
    ...ids
  );
}

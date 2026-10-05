/* ============================================================================
   SKINO — inventory
   Tracks which skins the player owns, keyed by skin id with a quantity.
   Persisted in LocalStorage so purchases and wheel wins survive reloads.
   ========================================================================= */

export const INVENTORY_KEY = 'skino:inventory';

const listeners = new Set();

/** @type {Record<string, number>} id -> quantity */
let items = read();

function read() {
  try {
    const raw = window.localStorage.getItem(INVENTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const clean = {};
    for (const [id, qty] of Object.entries(parsed)) {
      const n = Math.round(Number(qty));
      if (typeof id === 'string' && id && Number.isFinite(n) && n > 0) clean[id] = n;
    }
    return clean;
  } catch {
    return {};
  }
}

function write() {
  try {
    window.localStorage.setItem(INVENTORY_KEY, JSON.stringify(items));
  } catch {
    /* Storage unavailable — keep the in-memory copy for this session. */
  }
}

function emit() {
  const snapshot = getInventory();
  listeners.forEach((fn) => fn(snapshot));
}

/** Owned skins as `{ id, qty }`, newest acquisition order preserved by key order. */
export function getInventory() {
  return Object.entries(items).map(([id, qty]) => ({ id, qty }));
}

export function ownedCount(id) {
  return items[id] ?? 0;
}

export function totalItems() {
  return Object.values(items).reduce((sum, n) => sum + n, 0);
}

export function addToInventory(id, qty = 1) {
  const n = Math.round(qty);
  if (!id || !Number.isFinite(n) || n <= 0) return;
  items[id] = (items[id] ?? 0) + n;
  write();
  emit();
}

export function removeFromInventory(id, qty = 1) {
  const n = Math.round(qty);
  if (!items[id] || n <= 0) return;
  const next = items[id] - n;
  if (next > 0) items[id] = next;
  else delete items[id];
  write();
  emit();
}

/**
 * Remove several stacks at once (used by "sell duplicates"), notifying
 * subscribers a single time.
 * @param {{id:string, qty:number}[]} removals
 */
export function removeMany(removals) {
  let changed = false;
  removals.forEach(({ id, qty }) => {
    const n = Math.round(qty);
    if (!items[id] || n <= 0) return;
    const next = items[id] - n;
    if (next > 0) items[id] = next;
    else delete items[id];
    changed = true;
  });
  if (!changed) return;
  write();
  emit();
}

export function clearInventory() {
  items = {};
  write();
  emit();
}

/** Subscribe to inventory changes. Returns an unsubscribe function. */
export function onInventoryChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

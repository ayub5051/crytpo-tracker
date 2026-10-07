/* ============================================================================
   BLAZZER — inventory model (Stage 3.1)
   The source of truth for what a player owns. Each owned skin is a real
   *instance* (its own uid, acquisition date, provenance, stickers, lock state)
   rather than an anonymous counter — that is what makes trading, gifting and
   upgrading possible later.

   Storage is versioned and backwards-compatible: the previous `{ id: qty }` map
   is detected and expanded into instances on first read, non-destructively, so
   nobody loses their collection (see js/storage.js for the older key rename).

   Public surface is a superset of the Stage-1 API — `getInventory()`,
   `ownedCount()`, `addToInventory()`, `removeFromInventory()` all still behave
   exactly as before, so the games and the market modal need no changes beyond
   passing an optional provenance tag.
   ========================================================================= */

export const INVENTORY_KEY = 'blazzer:inventory';
const VERSION = 2;

/** Lock window applied to items received via trade/gift (anti-fraud). */
export const TRADE_LOCK_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_STICKERS = 5;

const listeners = new Set();

/** Cross-tab so two open tabs never show divergent inventories. */
let channel = null;
try {
  channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('blazzer:inventory') : null;
} catch {
  channel = null;
}

/* --------------------------------------------------------------- normalise */

/** Coerce anything into a well-formed item instance, or null if unusable. */
export function normaliseItem(partial) {
  if (!partial || typeof partial !== 'object') return null;
  const id = String(partial.id || '').trim();
  if (!id) return null;
  const now = Date.now();
  return {
    uid: String(partial.uid || `i_${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`),
    id,
    obtainedAt: Number.isFinite(partial.obtainedAt) ? partial.obtainedAt : now,
    obtainedVia: partial.obtainedVia || 'purchase',
    stickers: Array.isArray(partial.stickers) ? partial.stickers.slice(0, MAX_STICKERS) : [],
    stattrak: Boolean(partial.stattrak),
    floatValue: Number.isFinite(partial.floatValue) ? partial.floatValue : null,
    isListed: Boolean(partial.isListed),
    price: Number.isFinite(partial.price) ? partial.price : null,
    tradeLocked: Boolean(partial.tradeLocked),
    tradeLockedUntil: Number.isFinite(partial.tradeLockedUntil) ? partial.tradeLockedUntil : null,
  };
}

/** Expand the legacy `{ id: qty }` map into one instance per copy. */
function expandLegacyMap(map) {
  const out = [];
  for (const [id, qty] of Object.entries(map)) {
    const n = Math.round(Number(qty));
    if (!Number.isFinite(n) || n <= 0) continue;
    for (let i = 0; i < n; i += 1) {
      const item = normaliseItem({ id, obtainedVia: 'legacy' });
      if (item) out.push(item);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ storage */

// Declared before `read()` runs: `read()` flips `migrated` when it upgrades a
// legacy shape, so the binding must already be initialised (no TDZ).
let migrated = false;

/** @type {ReturnType<typeof normaliseItem>[]} */
let items = read();

function read() {
  try {
    const raw = window.localStorage.getItem(INVENTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // v2 shape
    if (parsed && Array.isArray(parsed.items)) {
      return parsed.items.map(normaliseItem).filter(Boolean);
    }
    // bare array of instances
    if (Array.isArray(parsed)) return parsed.map(normaliseItem).filter(Boolean);
    // legacy `{ id: qty }` map
    if (parsed && typeof parsed === 'object') {
      migrated = true;
      return expandLegacyMap(parsed);
    }
    return [];
  } catch {
    return [];
  }
}

function write() {
  try {
    window.localStorage.setItem(INVENTORY_KEY, JSON.stringify({ v: VERSION, items }));
  } catch {
    /* Storage unavailable — keep the in-memory copy for this session. */
  }
}

function emit({ broadcast = true } = {}) {
  const snapshot = getInventory();
  listeners.forEach((fn) => fn(snapshot));
  if (broadcast && channel) {
    try {
      channel.postMessage({ type: 'change', at: Date.now() });
    } catch {
      /* channel closed */
    }
  }
}

// Persist the one-time legacy migration so the new shape is the stored truth.
if (migrated) write();

/* -------------------------------------------------------------- compatibility */

/**
 * Owned skins as stacks `{ id, qty }`, newest-first by first acquisition.
 * Unchanged from the Stage-1 contract.
 */
export function getInventory() {
  const stacks = new Map();
  for (const item of items) {
    const entry = stacks.get(item.id) || { id: item.id, qty: 0 };
    entry.qty += 1;
    stacks.set(item.id, entry);
  }
  return [...stacks.values()];
}

export function ownedCount(id) {
  return items.reduce((n, item) => (item.id === id ? n + 1 : n), 0);
}

export function totalItems() {
  return items.length;
}

/* ------------------------------------------------------------------ instances */

/** A defensive copy of every owned instance, newest-first. */
export function getItems() {
  return items.map((item) => ({ ...item })).sort((a, b) => b.obtainedAt - a.obtainedAt);
}

export function getItem(uid) {
  const found = items.find((item) => item.uid === uid);
  return found ? { ...found } : null;
}

/**
 * Add one or more copies of a skin. `meta.obtainedVia` records provenance
 * (wheel | mines | case | trade | gift | purchase).
 * @param {string} id
 * @param {number} [qty]
 * @param {{obtainedVia?:string, stattrak?:boolean, floatValue?:number}} [meta]
 */
export function addToInventory(id, qty = 1, meta = {}) {
  const n = Math.round(qty);
  if (!id || !Number.isFinite(n) || n <= 0) return [];
  const added = [];
  for (let i = 0; i < n; i += 1) {
    const item = normaliseItem({ id, obtainedVia: meta.obtainedVia || 'purchase', stattrak: meta.stattrak, floatValue: meta.floatValue });
    if (item) {
      items.push(item);
      added.push(item);
    }
  }
  if (!added.length) return [];
  write();
  emit();
  return added.map((item) => ({ ...item }));
}

/** Insert a fully-formed instance (used when adopting server data). */
export function addItem(partial) {
  const item = normaliseItem(partial);
  if (!item) return null;
  // Ignore a duplicate uid so a re-sync cannot double-insert.
  if (items.some((existing) => existing.uid === item.uid)) return getItem(item.uid);
  items.push(item);
  write();
  emit();
  return { ...item };
}

/** Patch an owned instance in place (stickers, listing price, locks). */
export function updateItem(uid, patch = {}) {
  const index = items.findIndex((item) => item.uid === uid);
  if (index < 0) return null;
  items[index] = normaliseItem({ ...items[index], ...patch, uid });
  write();
  emit();
  return { ...items[index] };
}

/** Remove exactly one instance by uid. */
export function removeItem(uid) {
  const index = items.findIndex((item) => item.uid === uid);
  if (index < 0) return null;
  const [removed] = items.splice(index, 1);
  write();
  emit();
  return { ...removed };
}

/** Prefer to consume transferable copies before listed/locked ones. */
function consume(id, qty) {
  const n = Math.round(qty);
  if (!id || !Number.isFinite(n) || n <= 0) return 0;
  const matches = items.filter((item) => item.id === id);
  if (!matches.length) return 0;
  const transferable = matches.filter((item) => !item.isListed && !item.tradeLocked);
  const chosen = [...transferable, ...matches.filter((item) => !transferable.includes(item))].slice(0, n);
  if (!chosen.length) return 0;
  const doomed = new Set(chosen.map((item) => item.uid));
  items = items.filter((item) => !doomed.has(item.uid));
  return chosen.length;
}

export function removeFromInventory(id, qty = 1) {
  const removed = consume(id, qty);
  if (!removed) return;
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
    if (consume(id, qty) > 0) changed = true;
  });
  if (!changed) return;
  write();
  emit();
}

export function clearInventory() {
  items = [];
  write();
  emit();
}

/** Subscribe to inventory changes. Returns an unsubscribe function. */
export function onInventoryChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* --------------------------------------------------------- optional sync --- */
/* The demo runs local-first: LocalStorage is authoritative so it works with no
   server. When a backend is available (window.BLAZZER_INVENTORY.sync === true)
   an empty local inventory is hydrated from GET /api/inventory. Failures are
   silent — the games must never break because a server is missing.
   ------------------------------------------------------------------------- */

let hydrating = false;

export async function hydrateFromServer() {
  if (hydrating || items.length > 0) return false;
  if (window.BLAZZER_INVENTORY?.sync !== true) return false;
  hydrating = true;
  try {
    const token = window.BLAZZER_INVENTORY?.token;
    const res = await fetch('/api/inventory?limit=100', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const data = await res.json();
    const list = Array.isArray(data?.items) ? data.items : [];
    if (!list.length) return false;
    items = list
      .map((row) => normaliseItem({ uid: row.id, id: row.itemId, obtainedAt: row.obtainedAt, obtainedVia: row.obtainedVia, stattrak: row.stattrak, floatValue: row.floatValue, isListed: row.isListed, price: row.price, tradeLocked: row.tradeLocked, tradeLockedUntil: row.tradeLockedUntil }))
      .filter(Boolean);
    write();
    emit({ broadcast: false });
    return true;
  } catch {
    return false;
  } finally {
    hydrating = false;
  }
}

/* Cross-tab: adopt another tab's writes so the grid stays consistent. */
if (channel) {
  channel.addEventListener('message', (event) => {
    if (event.data?.type !== 'change') return;
    items = read();
    emit({ broadcast: false });
  });
  window.addEventListener('pagehide', () => {
    try {
      channel?.close();
    } catch {
      /* already closed */
    }
  });
}

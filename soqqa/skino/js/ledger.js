/* ============================================================================
   SKINO — transaction ledger
   A newest-first log of everything that moves Crystals or skins: purchases,
   sales, mini-game results and rewards. Capped and persisted in LocalStorage.
   ========================================================================= */

export const LEDGER_KEY = 'skino:ledger';
export const MAX_ENTRIES = 100;

const listeners = new Set();

let entries = read();

function read() {
  try {
    const raw = window.localStorage.getItem(LEDGER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.label === 'string')
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function write() {
  try {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(entries));
  } catch {
    /* Storage unavailable — keep the in-memory log for this session. */
  }
}

function emit() {
  const snapshot = getLedger();
  listeners.forEach((fn) => fn(snapshot));
}

export function getLedger() {
  return entries.map((entry) => ({ ...entry }));
}

/**
 * Append an event. `amount` is the signed Crystal change (0 for skin-only
 * gains); `type` groups the entry for the History view.
 */
export function record({ type = 'other', label, amount = 0, skinId = null }) {
  if (!label) return null;
  const entry = {
    id: `t${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    label,
    amount: Math.round(amount),
    skinId,
    time: Date.now(),
  };
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  write();
  emit();
  return entry;
}

export function clearLedger() {
  if (entries.length === 0) return;
  entries = [];
  write();
  emit();
}

/** Subscribe to ledger changes. Returns an unsubscribe function. */
export function onLedgerChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

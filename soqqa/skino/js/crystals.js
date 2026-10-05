/* ============================================================================
   SKINO — Crystal currency
   The single in-app currency. Persisted in LocalStorage so the balance
   survives reloads. Other modules subscribe to keep their UI in sync.
   ========================================================================= */

export const STORAGE_KEY = 'skino:crystals';
export const STARTING_CRYSTALS = 2500;
export const FRIEND_SHARE_REWARD = 250;

const listeners = new Set();

const format = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Safe LocalStorage read — private mode or disabled storage should not throw. */
function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStored(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* Storage unavailable — keep the in-memory value for this session. */
  }
}

let balance = readStored() ?? STARTING_CRYSTALS;
if (readStored() === null) writeStored(balance);

export function getCrystals() {
  return balance;
}

export function formatCrystals(value) {
  return format.format(value);
}

/** Replace the balance, persist it, and notify subscribers. */
export function setCrystals(value) {
  const next = Math.max(0, Math.round(value));
  if (next === balance) return balance;
  balance = next;
  writeStored(balance);
  listeners.forEach((fn) => fn(balance));
  return balance;
}

export function addCrystals(amount) {
  return setCrystals(balance + amount);
}

/** Returns false (and leaves the balance untouched) when funds are short. */
export function spendCrystals(amount) {
  if (amount > balance) return false;
  setCrystals(balance - amount);
  return true;
}

/** Subscribe to balance changes. Returns an unsubscribe function. */
export function onCrystalsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetCrystals() {
  return setCrystals(STARTING_CRYSTALS);
}

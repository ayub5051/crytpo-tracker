/* ============================================================================
   BLAZZER — trade system (Stage 3.3)
   Peer-to-peer item swaps, no money involved. This module owns:

     • the local-first trade model (create / add / remove / confirm / execute /
       cancel), mirrored to the server API when one is configured
     • the /trade/:id page and its whole state machine (pending → ready →
       completed / cancelled / expired), plus the read-only observer view
     • share links (copy, X, Telegram, WhatsApp, native share)
     • the fairness indicator and the create-trade modal

   The demo runs local-first: the counterparty is a seeded demo trader whose
   pool stands in for their inventory, so the full two-sided flow is
   demonstrable in one browser. Point the client at a server
   (`window.BLAZZER_TRADE.sync === true`) and the same state machine drives real
   two-account trades over the Stage 1 WebSocket.

   Animation: transform + opacity only, custom easings, reduced-motion aware.
   ========================================================================= */

import { formatCrystals } from './crystals.js';
import { crystalIcon, hydrateCrystalIcons } from './icons.js';
import { getSkinById, RARITIES } from './skins.js';
import { getItem, removeItem, addToInventory, updateItem, onInventoryChange } from './inventory.js';
import { record } from './ledger.js';
import { showToast } from './toast.js';
import { openTradePicker } from './trade-picker.js';
import { connectTradeRealtime } from './trade-realtime.js';
import { celebrateTrade } from './trade-celebration.js';

const ME_KEY = 'blazzer:trade:me';
const TRADES_KEY = 'blazzer:trades';
const POOL_KEY = 'blazzer:trade:pool';
const VERSION = 1;

export const MAX_ITEMS_PER_SIDE = 20;
export const TRADE_TTL_MS = 24 * 60 * 60 * 1000;
const TRADE_LOCK_MS = 7 * 24 * 60 * 60 * 1000;

const listeners = new Set();

/* --------------------------------------------------------------- utilities */

function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function onTradeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => fn());
}

export function money(value) {
  return `${formatCrystals(value)} ${crystalIcon(13)}`;
}

/* ----------------------------------------------------------------- identity */

let me = null;

export function currentUser() {
  if (me) return me;
  me = readJson(ME_KEY, null);
  if (!me?.id) {
    me = { id: `u_${Math.random().toString(36).slice(2, 9)}`, name: 'You' };
    writeJson(ME_KEY, me);
  }
  return me;
}

/* -------------------------------------------------------------- demo pool */

const POOL_NAMES = ['Ari', 'Kestrel', 'vanta', 'Sable', 'Orbit', 'Fen'];

/**
 * The seeded counterparty inventory used in the local demo. With a real server
 * the other side comes from the other account, and this pool is unused.
 */
export function poolItems() {
  let pool = readJson(POOL_KEY, null);
  if (!pool || !Array.isArray(pool.items) || !pool.items.length) {
    pool = { v: VERSION, items: seedPool() };
    writeJson(POOL_KEY, pool);
  }
  return pool.items;
}

function seedPool() {
  const random = (() => {
    let a = 0x5eed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const ids = ['ak-47-slate', 'glock-18-fade', 'mp9-hydra', 'usp-s-cortex', 'awp-redline', 'p250-sand-dune', 'desert-eagle-blaze', 'm4a1-s-blue-phosphor', 'ak-47-case-hardened', 'mp9-hot-rod', 'star-karambit-fade', 'm4a4-asiimov'];
  return ids.map((catalogueId, i) => ({
    uid: `p_${i}_${catalogueId}`,
    catalogueId,
    stattrak: random() < 0.1,
    floatValue: null,
    stickers: [],
    obtainedAt: Date.now() - Math.floor(random() * 30 * 24 * 60 * 60 * 1000),
  }));
}

/* ---------------------------------------------------------------- the model */

let trades = {};

function load() {
  const stored = readJson(TRADES_KEY, null);
  trades = stored && typeof stored.trades === 'object' && stored.trades ? stored.trades : {};
  // Expire anything that lapsed while the tab was closed.
  const now = Date.now();
  let changed = false;
  Object.values(trades).forEach((t) => {
    if ((t.status === 'pending' || t.status === 'ready') && t.expiresAt <= now) {
      t.status = 'expired';
      changed = true;
    }
  });
  if (changed) persist();
}

function persist() {
  writeJson(TRADES_KEY, { v: VERSION, trades });
}

/** Snapshot the local catalogue metadata an item needs to be tradable. */
function snapshot(uid, catalogueId, extra = {}) {
  const skin = getSkinById(catalogueId);
  return {
    uid,
    catalogueId,
    value: skin?.price ?? 0,
    stattrak: Boolean(extra.stattrak),
    floatValue: extra.floatValue ?? null,
    stickers: extra.stickers || [],
    obtainedAt: extra.obtainedAt ?? Date.now(),
  };
}

export function getTrade(id) {
  return trades[id] ?? null;
}

function activeTrade() {
  return Object.values(trades).filter((t) => t.status === 'pending' || t.status === 'ready');
}

/** True when an item is already committed to another live trade. */
export function itemInTrade(uid) {
  return activeTrade().some(
    (t) =>
      t.uid === uid ||
      t.initiatorItems.some((i) => i.uid === uid) ||
      t.receiverItems.some((i) => i.uid === uid)
  );
}

/** Your role in a trade: 'initiator' | 'receiver' | 'observer'. */
export function roleIn(trade) {
  if (!trade) return 'observer';
  const mine = currentUser().id;
  if (trade.initiatorId === mine) return 'initiator';
  if (trade.receiverId === mine) return 'receiver';
  return 'observer';
}

export function yourItems(trade) {
  const role = roleIn(trade);
  if (role === 'receiver') return trade.receiverItems;
  return trade.initiatorItems;
}

export function theirItems(trade) {
  const role = roleIn(trade);
  if (role === 'receiver') return trade.initiatorItems;
  return trade.receiverItems;
}

/**
 * Fairness from the current user's point of view.
 * @returns {{state:'waiting'|'fair'|'gain'|'lose', delta:number, pct:number}}
 */
export function fairness(trade) {
  const mine = yourItems(trade).reduce((n, i) => n + (i.value || 0), 0);
  const theirs = theirItems(trade).reduce((n, i) => n + (i.value || 0), 0);
  // Waiting until both sides hold something — a one-sided trade has no fairness.
  if (!mine || !theirs) return { state: 'waiting', delta: 0, pct: 0 };
  const delta = theirs - mine;
  const base = Math.max(mine, theirs, 1);
  const pct = Math.abs(delta) / base;
  if (pct <= 0.05) return { state: 'fair', delta, pct };
  return { state: delta > 0 ? 'gain' : 'lose', delta, pct };
}

/* ----------------------------------------------------------------- mutations */

function newId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Create a draft with your items already on your side. */
export function createTrade(uids) {
  const wanted = [...new Set(uids)].slice(0, MAX_ITEMS_PER_SIDE);
  if (!wanted.length) throw new Error('Select at least one item');

  const items = wanted.map((uid) => {
    const item = getItem(uid);
    if (!item) throw new Error('Item not found');
    if (item.isListed) throw new Error('An item is listed for sale');
    if (item.tradeLocked && (!item.tradeLockedUntil || item.tradeLockedUntil > Date.now())) {
      throw new Error('An item is trade-locked');
    }
    if (itemInTrade(uid)) throw new Error('An item is already in another trade');
    return snapshot(uid, item.id, item);
  });

  const now = Date.now();
  const user = currentUser();
  const trade = {
    id: newId(),
    initiatorId: user.id,
    initiator: { id: user.id, name: user.name },
    receiverId: null,
    receiver: null,
    initiatorItems: items,
    receiverItems: [],
    initiatorConfirmed: false,
    receiverConfirmed: false,
    initiatorFinalConfirmed: false,
    receiverFinalConfirmed: false,
    status: 'pending',
    createdAt: now,
    expiresAt: now + TRADE_TTL_MS,
    completedAt: null,
    cancelReason: null,
    demo: true,
  };
  trades[trade.id] = trade;
  persist();
  emit();
  sync('create', trade);
  return trade;
}

/** Which side a uid may be added to. The demo lets you drive both sides. */
function sideKeyFor(side) {
  return side === 'receiver' ? 'receiverItems' : 'initiatorItems';
}

export function addItemToTrade(id, uid, { side = 'initiator', source = 'inventory' } = {}) {
  const trade = trades[id];
  if (!trade) throw new Error('Trade not found');
  if (trade.status !== 'pending') throw new Error('This trade can no longer be edited');
  const key = sideKeyFor(side);
  if (trade[key].some((i) => i.uid === uid)) return trade;
  if (trade[key].length >= MAX_ITEMS_PER_SIDE) throw new Error(`At most ${MAX_ITEMS_PER_SIDE} items per side`);

  let entry;
  if (source === 'pool') {
    const found = poolItems().find((i) => i.uid === uid);
    if (!found) throw new Error('Item not found');
    entry = snapshot(uid, found.catalogueId, found);
  } else {
    const item = getItem(uid);
    if (!item) throw new Error('Item not found');
    if (item.isListed) throw new Error('That item is listed for sale');
    if (itemInTrade(uid)) throw new Error('That item is already in another trade');
    entry = snapshot(uid, item.id, item);
  }

  trade[key] = [...trade[key], entry];
  if (side === 'receiver') trade.receiverConfirmed = false;
  else trade.initiatorConfirmed = false;
  persist();
  emit();
  sync('add-item', trade, { uid, side });
  return trade;
}

export function removeItemFromTrade(id, uid, { side = 'initiator' } = {}) {
  const trade = trades[id];
  if (!trade) throw new Error('Trade not found');
  if (trade.status !== 'pending') throw new Error('This trade can no longer be edited');
  const key = sideKeyFor(side);
  trade[key] = trade[key].filter((i) => i.uid !== uid);
  if (side === 'receiver') {
    trade.receiverConfirmed = false;
    trade.receiverFinalConfirmed = false;
  } else {
    trade.initiatorConfirmed = false;
    trade.initiatorFinalConfirmed = false;
  }
  persist();
  emit();
  sync('remove-item', trade, { uid, side });
  return trade;
}

/** First confirmation: locks a side. */
export function confirmTrade(id, { side = 'initiator' } = {}) {
  const trade = trades[id];
  if (!trade) throw new Error('Trade not found');
  if (trade.status === 'completed' || trade.status === 'cancelled' || trade.status === 'expired') {
    throw new Error('This trade is closed');
  }
  const items = side === 'receiver' ? trade.receiverItems : trade.initiatorItems;
  if (!items.length) throw new Error('Add at least one item to that side first');
  if (side === 'receiver') trade.receiverConfirmed = true;
  else trade.initiatorConfirmed = true;
  trade.status = trade.initiatorConfirmed && trade.receiverConfirmed ? 'ready' : 'pending';
  persist();
  emit();
  sync('confirm', trade);
  return trade;
}

/** Second (final) confirmation. */
export function finalConfirmTrade(id, { side = 'initiator' } = {}) {
  const trade = trades[id];
  if (!trade) throw new Error('Trade not found');
  if (trade.status !== 'ready') throw new Error('Both sides must confirm first');
  if (side === 'receiver') trade.receiverFinalConfirmed = true;
  else trade.initiatorFinalConfirmed = true;
  persist();
  emit();
  sync('final-confirm', trade);
  return trade;
}

/**
 * The atomic swap, local edition: your items leave your inventory and land in
 * the demo trader's pool; their items leave the pool and land in your
 * inventory, trade-locked for 7 days.
 */
export function executeTrade(id) {
  const trade = trades[id];
  if (!trade) throw new Error('Trade not found');
  if (trade.status === 'completed') return trade;
  if (trade.status !== 'ready') throw new Error('This trade is not ready');
  if (!trade.initiatorFinalConfirmed || !trade.receiverFinalConfirmed) {
    throw new Error('Both parties must give final confirmation');
  }
  if (trade.expiresAt <= Date.now()) {
    trade.status = 'expired';
    persist();
    emit();
    throw new Error('This trade has expired');
  }

  const role = roleIn(trade);
  const mineSide = role === 'receiver' ? 'receiverItems' : 'initiatorItems';
  const theirSide = role === 'receiver' ? 'initiatorItems' : 'receiverItems';

  // Everything on my side must still be mine and tradable.
  for (const entry of trade[mineSide]) {
    const item = getItem(entry.uid);
    if (!item) throw new Error('One of your items is no longer in your inventory');
  }

  const received = [];
  const lockUntil = Date.now() + TRADE_LOCK_MS;

  // My items leave.
  trade[mineSide].forEach((entry) => {
    removeItem(entry.uid);
  });

  // Their items arrive, trade-locked.
  trade[theirSide].forEach((entry) => {
    const [added] = addToInventory(entry.catalogueId, 1, {
      obtainedVia: 'trade',
      stattrak: entry.stattrak,
      floatValue: entry.floatValue ?? undefined,
    });
    if (added) {
      updateItem(added.uid, { tradeLocked: true, tradeLockedUntil: lockUntil });
      received.push({ ...entry, uid: added.uid });
    }
  });

  trade.status = 'completed';
  trade.completedAt = Date.now();
  trade.received = received;
  persist();

  record({
    type: 'trade',
    label: `Traded ${trade[mineSide].length} item(s) for ${trade[theirSide].length}`,
    amount: 0,
  });
  emit();
  sync('execute', trade);
  return trade;
}

export function cancelTrade(id, reason = null) {
  const trade = trades[id];
  if (!trade) throw new Error('Trade not found');
  if (trade.status === 'completed') throw new Error('A completed trade cannot be cancelled');
  if (trade.status === 'cancelled') return trade;
  trade.status = 'cancelled';
  trade.cancelReason = reason ? String(reason).slice(0, 200) : null;
  persist();
  emit();
  sync('cancel', trade);
  return trade;
}

export function historyTrades() {
  return Object.values(trades).sort((a, b) => b.createdAt - a.createdAt);
}

/* --------------------------------------------------------- server mirroring */

function api() {
  return window.BLAZZER_TRADE?.sync === true ? window.BLAZZER_TRADE : null;
}

function sync(action, trade, extra = {}) {
  const cfg = api();
  if (!cfg) return;
  const token = cfg.token;
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const map = {
    create: { url: '/api/trade/create', body: { items: trade.initiatorItems.map((i) => i.uid) } },
    'add-item': { url: `/api/trade/${trade.id}/add-item`, body: { uid: extra.uid } },
    'remove-item': { url: `/api/trade/${trade.id}/remove-item`, body: { uid: extra.uid } },
    confirm: { url: `/api/trade/${trade.id}/confirm`, body: {} },
    'final-confirm': { url: `/api/trade/${trade.id}/final-confirm`, body: {} },
    execute: { url: `/api/trade/${trade.id}/execute`, body: {} },
    cancel: { url: `/api/trade/${trade.id}/cancel`, body: { reason: trade.cancelReason } },
  };
  const call = map[action];
  if (!call) return;
  fetch(call.url, { method: 'POST', headers, body: JSON.stringify(call.body), keepalive: action === 'execute' }).catch(
    (err) => console.warn('[trade] sync failed:', err.message)
  );
}

/* -------------------------------------------------------------- share links */

export function tradeLink(id) {
  try {
    const { origin, pathname } = window.location;
    if (origin && origin.startsWith('http')) return `${origin}/trade/${id}`;
    return `${pathname}?trade=${id}`;
  } catch {
    return `?trade=${id}`;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to a temp textarea.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function shareRow(markup, url) {
  const enc = encodeURIComponent;
  const text = encodeURIComponent('Trade skins with me on BLAZZER');
  return (
    '<div class="trade-share">' +
    `<button class="trade-share-btn" type="button" data-share="copy">Copy link</button>` +
    `<a class="trade-share-btn" href="https://twitter.com/intent/tweet?url=${enc(url)}&text=${text}" target="_blank" rel="noopener noreferrer">X</a>` +
    `<a class="trade-share-btn" href="https://t.me/share/url?url=${enc(url)}&text=${text}" target="_blank" rel="noopener noreferrer">Telegram</a>` +
    `<a class="trade-share-btn" href="https://wa.me/?text=${enc(`${text} ${url}`)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` +
    (markup || '') +
    '</div>'
  );
}

/* ============================================================================
   The page
   ========================================================================= */

let page = null;
let openTradeId = null;
let tick = 0;
let realtime = null;
let lastRenderedStatus = null;

const TILE = (entry, { remove = false, side = 'initiator' } = {}) => {
  const skin = getSkinById(entry.catalogueId);
  return (
    `<figure class="trade-tile" data-uid="${entry.uid}" style="--rarity:${RARITIES[skin?.rarity] ?? '#b0c3d9'}">` +
    `<span class="trade-tile-thumb">${
      skin?.image ? `<img src="${skin.image}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<span class="trade-tile-glyph">${crystalIcon(26)}</span>`
    }</span>` +
    `<figcaption class="trade-tile-body"><span class="trade-tile-name">${skin?.weapon || 'Item'} | ${skin?.finish || ''}</span>` +
    `<span class="trade-tile-sub">${skin?.condition || ''}</span>` +
    `<span class="trade-tile-value">${money(entry.value || 0)}</span></figcaption>` +
    (remove
      ? `<button class="trade-tile-x" type="button" data-trade-remove="${entry.uid}" data-trade-side="${side}" aria-label="Remove item">✕</button>`
      : '') +
    '</figure>'
  );
};

function sideMarkup(trade, side) {
  const entries = side === 'initiator' ? trade.initiatorItems : trade.receiverItems;
  const total = entries.reduce((n, i) => n + (i.value || 0), 0);
  const confirmed = side === 'initiator' ? trade.initiatorConfirmed : trade.receiverConfirmed;
  const label = side === 'initiator' ? 'Your items' : 'Their items';
  const editable = trade.status === 'pending';
  const nameOf = side === 'initiator' ? trade.initiator?.name || 'Trader' : trade.receiver?.name || 'Waiting to join';
  return (
    `<section class="trade-side" data-side="${side}">` +
    `<header class="trade-side-head"><span class="trade-side-title">${label} <em>(${entries.length})</em></span>` +
    `<span class="trade-side-total">${money(total)}</span></header>` +
    `<p class="trade-side-owner">${nameOf}${confirmed ? ' · confirmed' : ''}</p>` +
    `<div class="trade-tiles">${entries.map((e) => TILE(e, { remove: editable, side })).join('')}</div>` +
    (editable
      ? `<button class="btn btn-ghost trade-add" type="button" data-trade-add="${side}">+ Add items</button>`
      : '') +
    '</section>'
  );
}

function fairnessMarkup(trade) {
  const f = fairness(trade);
  const labels = {
    waiting: 'Waiting for the other side',
    fair: 'Fair trade',
    gain: `You gain ${formatCrystals(Math.abs(f.delta))} ◆`,
    lose: `You lose ${formatCrystals(Math.abs(f.delta))} ◆`,
  };
  return `<div class="trade-fairness" data-state="${f.state}"><span class="trade-fairness-dot" aria-hidden="true"></span>${labels[f.state]}</div>`;
}

function statusMarkup(trade) {
  if (trade.status === 'expired') {
    return (
      '<div class="trade-verdict is-expired">' +
      '<h2 class="trade-verdict-title">Trade expired</h2>' +
      '<p class="trade-verdict-copy">This trade lapsed after 24 hours.</p>' +
      '<button class="btn btn-primary" type="button" data-trade-new>Create new trade</button>' +
      '</div>'
    );
  }
  if (trade.status === 'cancelled') {
    return (
      '<div class="trade-verdict is-cancelled">' +
      '<h2 class="trade-verdict-title">Trade cancelled</h2>' +
      (trade.cancelReason ? `<p class="trade-verdict-copy">Reason: ${trade.cancelReason}</p>` : '') +
      '<button class="btn btn-primary" type="button" data-trade-new>Create new trade</button>' +
      '</div>'
    );
  }
  return '';
}

function actionsMarkup(trade) {
  if (trade.status === 'completed') {
    return '<div class="trade-actions"><button class="btn btn-primary" type="button" data-view-target="inventory">View in inventory</button></div>';
  }
  if (trade.status === 'cancelled' || trade.status === 'expired') return '';

  const role = roleIn(trade);
  const mineConfirmed = role === 'receiver' ? trade.receiverConfirmed : trade.initiatorConfirmed;
  const theirsConfirmed = role === 'receiver' ? trade.initiatorConfirmed : trade.receiverConfirmed;

  if (trade.status === 'ready') {
    return (
      '<div class="trade-actions trade-actions-ready">' +
      '<button class="btn btn-ghost" type="button" data-trade-cancel>Cancel</button>' +
      '<button class="btn btn-primary" type="button" data-trade-final-confirm>Confirm trade</button>' +
      '</div>'
    );
  }

  if (mineConfirmed && !theirsConfirmed) {
    return (
      '<div class="trade-actions">' +
      '<span class="trade-waiting"><span class="trade-waiting-dot" aria-hidden="true"></span>Waiting for the other side to confirm…</span>' +
      '<button class="btn btn-ghost" type="button" data-trade-waitcancel>Cancel confirmation</button>' +
      '</div>'
    );
  }

  return (
    '<div class="trade-actions">' +
    '<button class="btn btn-ghost" type="button" data-trade-cancel>Cancel</button>' +
    '<button class="btn btn-primary" type="button" data-trade-confirm>Confirm trade</button>' +
    '</div>'
  );
}

function countdown(trade) {
  if (trade.status !== 'pending' && trade.status !== 'ready') return '';
  const ms = Math.max(0, trade.expiresAt - Date.now());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `expires in ${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function ensurePage() {
  if (page) return page;
  page = document.createElement('div');
  page.className = 'trade-page';
  page.setAttribute('role', 'region');
  page.setAttribute('aria-label', 'Trade');
  document.body.append(page);
  page.addEventListener('click', onPageClick);
  return page;
}

function render() {
  const trade = getTrade(openTradeId);
  if (!page) return;

  if (!trade) {
    page.innerHTML =
      '<div class="trade-shell"><div class="trade-verdict is-cancelled">' +
      '<h2 class="trade-verdict-title">Trade not found</h2>' +
      '<p class="trade-verdict-copy">This link is invalid or the trade has been removed.</p>' +
      '<button class="btn btn-primary" type="button" data-trade-new>Create a trade</button></div></div>';
    return;
  }

  const role = roleIn(trade);
  const readOnly = role === 'observer' || trade.status === 'completed' || trade.status === 'cancelled' || trade.status === 'expired';
  const f = fairness(trade);

  page.innerHTML =
    '<div class="trade-shell">' +
    '<header class="trade-top">' +
    '<button class="trade-back" type="button" data-trade-close aria-label="Back to BLAZZER">←</button>' +
    '<span class="trade-brand">TRADE</span>' +
    `<span class="trade-clock" data-trade-clock>${countdown(trade)}</span>` +
    '<button class="trade-history-btn" type="button" data-trade-history>History</button>' +
    '</header>' +
    (role === 'observer' ? '<p class="trade-notice">This trade isn\'t yours — you are viewing it read-only.</p>' : '') +
    (trade.demo && role !== 'observer' && !readOnly
      ? '<p class="trade-notice trade-notice-demo">Demo mode: no second account is connected, so you drive both sides.</p>'
      : '') +
    '<div class="trade-columns" data-fairness="' + f.state + '">' +
    sideMarkup(trade, 'initiator') +
    '<div class="trade-swap" aria-hidden="true">⇄</div>' +
    sideMarkup(trade, 'receiver') +
    '</div>' +
    fairnessMarkup(trade) +
    (readOnly ? '' : actionsMarkup(trade)) +
    statusMarkup(trade) +
    (trade.status === 'completed'
      ? `<p class="trade-complete-note">Completed ${new Date(trade.completedAt).toLocaleString()} — ${trade.received?.length ?? 0} item(s) received.</p>`
      : '') +
    '</div>';

  hydrateCrystalIcons(page);

  if (trade.status === 'completed' && lastRenderedStatus !== 'completed') {
    lastRenderedStatus = 'completed';
    const received = trade.received || [];
    const total = received.reduce((n, i) => n + (i.value || 0), 0);
    // celebrateTrade() owns its own reduced-motion path (static "Trade complete"
    // copy + fade, no item choreography), so the feedback is never skipped — only
    // the animation is. The trade state update above runs on both paths.
    celebrateTrade({ items: received, total });
  }
}

/* ------------------------------------------------------------ page actions */

function onPageClick(event) {
  const target = event.target;
  const trade = getTrade(openTradeId);
  if (!trade) {
    if (target.closest('[data-trade-new]') || target.closest('[data-trade-close]')) closeTradePage();
    return;
  }

  if (target.closest('[data-trade-close]')) return closeTradePage();
  if (target.closest('[data-trade-history]')) return showHistory();

  const add = target.closest('[data-trade-add]');
  if (add) return openSidePicker(trade, add.dataset.tradeAdd);

  const remove = target.closest('[data-trade-remove]');
  if (remove) {
    try {
      removeItemFromTrade(trade.id, remove.dataset.tradeRemove, { side: remove.dataset.tradeSide });
      showToast('Item removed', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
    return undefined;
  }

  if (target.closest('[data-trade-confirm]')) {
    try {
      const role = roleIn(trade);
      confirmTrade(trade.id, { side: role === 'receiver' ? 'receiver' : 'initiator' });
      showToast('Confirmed — waiting for the other side', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
    return undefined;
  }

  if (target.closest('[data-trade-final-confirm]')) {
    const role = roleIn(trade);
    const side = role === 'receiver' ? 'receiver' : 'initiator';
    try {
      finalConfirmTrade(trade.id, { side });
      // The counterparty confirms in the same click in the local demo.
      if (trade.demo) finalConfirmTrade(trade.id, { side: side === 'initiator' ? 'receiver' : 'initiator' });
      const done = executeTrade(trade.id);
      if (done.status === 'completed') {
        showToast('Trade complete!', 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
    return undefined;
  }

  if (target.closest('[data-trade-waitcancel]')) {
    const role = roleIn(trade);
    const side = role === 'receiver' ? 'receiver' : 'initiator';
    try {
      if (side === 'receiver') trade.receiverConfirmed = false;
      else trade.initiatorConfirmed = false;
      trade.status = 'pending';
      persist();
      emit();
      showToast('Confirmation withdrawn', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
    return undefined;
  }

  if (target.closest('[data-trade-cancel]')) {
    try {
      cancelTrade(trade.id);
      showToast('Trade cancelled', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
    return undefined;
  }

  if (target.closest('[data-trade-new]')) {
    closeTradePage();
    showToast('Open your inventory and select items, then choose Trade', 'info');
    return undefined;
  }
  return undefined;
}

/** Open the picker for one side (your inventory, or the demo pool). */
function openSidePicker(trade, side) {
  const isTheirs = side === 'receiver';
  const source = isTheirs && trade.demo && roleIn(trade) === 'initiator' ? 'pool' : 'inventory';
  openTradePicker({
    source,
    alreadyIn: trade[sideKeyFor(side)].map((i) => i.uid),
    title: isTheirs ? 'Add their items' : 'Add your items',
    onConfirm: (uids) => {
      try {
        uids.forEach((uid) => addItemToTrade(trade.id, uid, { side, source }));
        showToast(`${uids.length} item(s) added`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    },
  });
}

/* ---------------------------------------------------------------- history */

function showHistory() {
  if (!page) return;
  const rows = historyTrades();
  page.innerHTML =
    '<div class="trade-shell">' +
    '<header class="trade-top">' +
    '<button class="trade-back" type="button" data-trade-history-back aria-label="Back">←</button>' +
    '<span class="trade-brand">TRADE HISTORY</span>' +
    '</header>' +
    (rows.length
      ? `<ul class="trade-history">${rows
          .map((t) => {
            const other = roleIn(t) === 'initiator' ? t.receiver?.name || 'Unclaimed' : t.initiator?.name || 'Trader';
            const mine = yourItems(t).length;
            const theirs = theirItems(t).length;
            return (
              `<li class="trade-history-row"><button class="trade-history-open" type="button" data-trade-open="${t.id}">` +
              `<span class="trade-history-date">${new Date(t.createdAt).toLocaleDateString()}</span>` +
              `<span class="trade-history-other">${other}</span>` +
              `<span class="trade-history-items">${mine} ⇄ ${theirs}</span>` +
              `<span class="trade-history-status is-${t.status}">${t.status}</span>` +
              '</button></li>'
            );
          })
          .join('')}</ul>`
      : '<div class="trade-verdict"><h2 class="trade-verdict-title">No trades yet</h2><p class="trade-verdict-copy">Select items in your inventory and choose Trade.</p></div>') +
    '</div>';

  page.querySelector('[data-trade-history-back]')?.addEventListener('click', () => render());
  page.querySelectorAll('[data-trade-open]').forEach((el) =>
    el.addEventListener('click', () => openTrade(el.dataset.tradeOpen))
  );
}

/* -------------------------------------------------------------- mount/route */

export function openTrade(id) {
  openTradeId = id;
  ensurePage();
  lastRenderedStatus = getTrade(id)?.status ?? null;
  page.classList.add('is-open');
  document.body.classList.add('trade-open');
  render();
  startTick();
  startRealtime(id);
}

export function closeTradePage() {
  if (!page) return;
  page.classList.remove('is-open');
  document.body.classList.remove('trade-open');
  stopTick();
  stopRealtime();
  // Drop the /trade/:id route without reloading.
  try {
    const url = `${location.pathname.replace(/\/trade\/[^/]+$/, '') || '/'}`;
    window.history.replaceState(null, '', url);
  } catch {
    /* history unavailable */
  }
}

function startTick() {
  stopTick();
  tick = window.setInterval(() => {
    const trade = getTrade(openTradeId);
    const clock = page?.querySelector('[data-trade-clock]');
    if (!trade || !clock) return;
    clock.textContent = countdown(trade);
    if ((trade.status === 'pending' || trade.status === 'ready') && trade.expiresAt <= Date.now()) {
      trade.status = 'expired';
      persist();
      emit();
    }
  }, 1000);
}

function stopTick() {
  if (tick) window.clearInterval(tick);
  tick = 0;
}

function startRealtime(id) {
  stopRealtime();
  realtime = connectTradeRealtime({
    tradeId: id,
    onMessage: () => {
      // Re-read from the server on a hint; local-first mode just re-renders.
      render();
    },
  });
}

function stopRealtime() {
  realtime?.close?.();
  realtime = null;
}

/** Parse `/trade/<id>` or `?trade=<id>` and open the page if present. */
export function routeTrade() {
  let id = null;
  try {
    const match = /\/trade\/([^/?#]+)/.exec(window.location.pathname);
    if (match && match[1] !== 'history') id = decodeURIComponent(match[1]);
    if (!id) id = new URLSearchParams(window.location.search).get('trade');
  } catch {
    id = null;
  }
  if (id) openTrade(id);
  return Boolean(id);
}

/* -------------------------------------------------------- create modal */

let createModal = null;

/** Open the create-trade modal with your selected items on your side. */
export function openCreateTrade(uids) {
  let trade;
  try {
    trade = createTrade(uids);
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }

  if (!createModal) {
    createModal = document.createElement('div');
    createModal.className = 'market-modal';
    document.body.append(createModal);
  }

  const url = tradeLink(trade.id);
  const total = trade.initiatorItems.reduce((n, i) => n + (i.value || 0), 0);
  createModal.innerHTML =
    '<div class="market-backdrop" data-create-close></div>' +
    '<div class="market-dialog" role="dialog" aria-modal="true" aria-labelledby="tradeCreateTitle">' +
    '<button class="market-modal-close" type="button" data-create-close aria-label="Close">✕</button>' +
    '<h2 class="market-title" id="tradeCreateTitle">New trade</h2>' +
    '<p class="market-cond">Your side is ready — share the link so they can add theirs.</p>' +
    '<div class="trade-preview">' +
    `<div class="trade-preview-side"><span class="trade-side-title">Your items <em>(${trade.initiatorItems.length})</em></span><div class="trade-tiles trade-tiles-sm">${trade.initiatorItems.map((e) => TILE(e)).join('')}</div><span class="trade-preview-total">${money(total)}</span></div>` +
    '<div class="trade-preview-side is-empty"><span class="trade-side-title">Their items <em>(0)</em></span><p class="trade-preview-wait">Waiting for them to join…</p></div>' +
    '</div>' +
    `<div class="trade-link"><input class="trade-link-field" data-trade-link value="${url}" readonly aria-label="Trade link" />` +
    '<button class="btn btn-ghost" type="button" data-trade-copy>Copy</button></div>' +
    shareRow('', url) +
    '<div class="market-actions">' +
    '<button class="btn btn-ghost" type="button" data-create-close>Close</button>' +
    '<button class="btn btn-primary" type="button" data-trade-open-page>Open trade page</button>' +
    '</div></div>';

  hydrateCrystalIcons(createModal);
  createModal.classList.add('is-open');
  document.body.classList.add('modal-open');
  createModal.querySelector('.trade-link')?.classList.add('is-highlight');

  showToast('Trade link ready — share it with your friend', 'success');

  createModal.onclick = async (event) => {
    if (event.target.closest('[data-create-close]')) return closeCreate();
    if (event.target.closest('[data-trade-copy]')) {
      const ok = await copyText(url);
      showToast(ok ? 'Link copied' : 'Could not copy — select it manually', ok ? 'success' : 'error');
      return undefined;
    }
    if (event.target.closest('[data-share="copy"]')) {
      const ok = await copyText(url);
      showToast(ok ? 'Link copied' : 'Could not copy', ok ? 'success' : 'error');
      return undefined;
    }
    if (event.target.closest('[data-trade-open-page]')) {
      closeCreate();
      openTrade(trade.id);
      return undefined;
    }
    return undefined;
  };
}

export function closeCreate() {
  if (!createModal) return;
  createModal.classList.remove('is-open');
  document.body.classList.remove('modal-open');
}

/* -------------------------------------------------------------------- init */

export function initTrade() {
  load();
  currentUser();

  // Re-render the open page on any model change or inventory change.
  onTradeChange(() => {
    if (openTradeId) render();
  });
  onInventoryChange(() => {
    if (openTradeId) render();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (createModal?.classList.contains('is-open')) closeCreate();
      else if (page?.classList.contains('is-open')) closeTradePage();
    }
  });

  routeTrade();
}

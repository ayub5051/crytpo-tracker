/* ============================================================================
   BLAZZER — inventory view (Stage 3.1)
   The rich, owner-facing inventory: a value/trend top bar, search + sort + a
   multi-select filter drawer, bulk selection with actions, a per-item owner
   detail modal, and a proper empty state.

   Every owned skin is rendered as its own card (one instance = one card), so
   per-item data — provenance, wear, stickers, lock state — is always truthful.
   Rendering reuses the catalogue card (js/skins.js) so the two grids look
   identical; only the inventory-specific extras live here.

   Animation contract: transform + opacity only, custom easings, and everything
   collapses cleanly under `prefers-reduced-motion`.
   ========================================================================= */

import { RARITIES, createSkinCard, getSkinById } from './skins.js';
import { getItems, updateItem, removeItem, onInventoryChange, hydrateFromServer } from './inventory.js';
import { addCrystals, formatCrystals } from './crystals.js';
import { crystalIcon, hydrateCrystalIcons } from './icons.js';
import { record } from './ledger.js';
import { showToast } from './toast.js';
import { openSellModal } from './market-sell.js';
import { openCreateTrade } from './trade.js';

const VALUE_HISTORY_KEY = 'blazzer:inventory:valueHistory';
const MAX_SELECT = 20; // mirrors the server's trade cap

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const SOURCE_LABELS = {
  wheel: 'Wheel',
  mines: 'Mines',
  case: 'Mystery Case',
  crash: 'Crash',
  trade: 'Trade',
  gift: 'Gift',
  purchase: 'Purchase',
  legacy: 'Earlier session',
};

/** Weapon buckets for the drawer's category filter. */
const CATEGORIES = [
  { id: 'rifles', label: 'Rifles', test: (w) => /^(AK-47|M4A4|M4A1-S|Galil|FAMAS|SG 553|AUG)/.test(w) },
  { id: 'snipers', label: 'Snipers', test: (w) => /^(AWP|SSG 08|SCAR-20|G3SG1)/.test(w) },
  { id: 'pistols', label: 'Pistols', test: (w) => /^(Desert Eagle|USP-S|Glock-18|P250|Five-SeveN|Tec-9|CZ75|P2000|R8)/.test(w) },
  { id: 'smgs', label: 'SMGs', test: (w) => /^(MP9|MAC-10|UMP-45|P90|MP7|MP5)/.test(w) },
  { id: 'knives', label: 'Knives', test: (w) => w.startsWith('★') && !/Gloves/.test(w) },
  { id: 'gloves', label: 'Gloves', test: (w) => /Gloves/.test(w) },
];

function categoryOf(weapon) {
  const hit = CATEGORIES.find((c) => c.test(weapon));
  return hit ? hit.id : 'other';
}

const RARITY_ORDER = Object.keys(RARITIES);
const WEAR_ORDER = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];

/* ------------------------------------------------------------------- state */

const state = {
  sort: 'newest',
  search: '',
  rarities: new Set(),
  categories: new Set(),
  wears: new Set(),
  stattrak: false,
  stickers: false,
  bulk: false,
  selected: new Set(), // item uids
};

let els = null;
let detail = null;
let lastFocused = null;
let shownValue = 0;
let valueRaf = 0;

/* --------------------------------------------------------------- utilities */

function formatValue(n) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));
}

/** Items joined with their catalogue record, dropping anything unlisted. */
function ownedEntries() {
  return getItems()
    .map((item) => ({ item, skin: getSkinById(item.id) }))
    .filter((entry) => entry.skin);
}

function entryValue({ skin }) {
  return skin.price;
}

function filteredEntries() {
  const q = state.search.trim().toLowerCase();
  const list = ownedEntries().filter(({ item, skin }) => {
    if (state.rarities.size && !state.rarities.has(skin.rarity)) return false;
    if (state.categories.size && !state.categories.has(categoryOf(skin.weapon))) return false;
    if (state.wears.size && !state.wears.has(skin.condition)) return false;
    if (state.stattrak && !item.stattrak) return false;
    if (state.stickers && !(item.stickers && item.stickers.length)) return false;
    if (q && !`${skin.weapon} ${skin.finish} ${skin.condition}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return sortEntries(list);
}

function sortEntries(list) {
  const byWeapon = (a, b) => a.skin.weapon.localeCompare(b.skin.weapon) || a.skin.finish.localeCompare(b.skin.finish);
  const comparators = {
    newest: (a, b) => b.item.obtainedAt - a.item.obtainedAt,
    oldest: (a, b) => a.item.obtainedAt - b.item.obtainedAt,
    'value-desc': (a, b) => entryValue(b) - entryValue(a),
    'value-asc': (a, b) => entryValue(a) - entryValue(b),
    rarity: (a, b) => RARITY_ORDER.indexOf(b.skin.rarity) - RARITY_ORDER.indexOf(a.skin.rarity) || byWeapon(a, b),
    weapon: byWeapon,
  };
  return [...list].sort(comparators[state.sort] || comparators.newest);
}

/* --------------------------------------------------- value + trend tracking */

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readHistory() {
  try {
    const raw = window.localStorage.getItem(VALUE_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((e) => e && e.d && Number.isFinite(e.v)) : [];
  } catch {
    return [];
  }
}

/** Record today's inventory value, keeping ~30 days of history. */
function recordValue(value) {
  try {
    const history = readHistory();
    const today = todayKey();
    const existing = history.find((e) => e.d === today);
    // Skip the write (per keystroke of a search) when today's value is unchanged.
    if (existing && existing.v === value) return;
    if (existing) existing.v = value;
    else history.push({ d: today, v: value });
    history.sort((a, b) => (a.d < b.d ? -1 : 1));
    window.localStorage.setItem(VALUE_HISTORY_KEY, JSON.stringify(history.slice(-30)));
  } catch {
    /* history is best-effort */
  }
}

/** Percentage change vs the oldest sample within the last 7 days. */
function trend() {
  const history = readHistory();
  if (history.length < 2) return { pct: 0, dir: 'flat' };
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const baseline = history.find((e) => new Date(`${e.d}T00:00:00Z`).getTime() >= cutoff) || history[0];
  const current = history[history.length - 1].v;
  if (!baseline || baseline.v <= 0) return { pct: 0, dir: current > 0 ? 'up' : 'flat' };
  const pct = Math.round(((current - baseline.v) / baseline.v) * 100);
  return { pct, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

/** Animate the top-bar value with an ease-out count (respects reduced motion). */
function paintValue(target) {
  if (!els?.value) return;
  window.cancelAnimationFrame(valueRaf);
  if (reducedMotion) {
    els.value.textContent = formatValue(target);
    shownValue = target;
    return;
  }
  const from = shownValue;
  const t0 = performance.now();
  const duration = 700;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    els.value.textContent = formatValue(from + (target - from) * eased);
    if (p < 1) valueRaf = requestAnimationFrame(step);
    else {
      shownValue = target;
      els.value.textContent = formatValue(target);
    }
  };
  valueRaf = requestAnimationFrame(step);
}

/* ------------------------------------------------------------------- cards */

const GLYPHS = {
  default: 'M2 15h13l3-3h4v2l-3 1v3h-3l-1-3H8l-1 3H4z',
};

/** Build one inventory card: a catalogue card plus the owner's extras. */
function createCard(item, skin) {
  const card = createSkinCard(skin);
  card.classList.add('inv-card');
  card.dataset.invUid = item.uid;
  card.setAttribute(
    'aria-label',
    `Owned ${skin.weapon} | ${skin.finish}, ${skin.condition}`
  );

  const thumb = card.querySelector('.skin-thumb');

  const owned = document.createElement('span');
  owned.className = 'inv-owned';
  owned.textContent = 'Owned';
  thumb.append(owned);

  if (item.stattrak) {
    const st = document.createElement('span');
    st.className = 'inv-stattrak';
    st.textContent = 'StatTrak™';
    thumb.append(st);
  }

  if (item.isListed) {
    const listed = document.createElement('span');
    listed.className = 'inv-listed';
    listed.textContent = 'Listed';
    thumb.append(listed);
  } else if (item.tradeLocked && (!item.tradeLockedUntil || item.tradeLockedUntil > Date.now())) {
    const lock = document.createElement('span');
    lock.className = 'inv-locked';
    lock.textContent = 'Locked';
    thumb.append(lock);
  }

  if (item.stickers && item.stickers.length) {
    const strip = document.createElement('div');
    strip.className = 'inv-sticker-strip';
    strip.setAttribute('aria-label', `${item.stickers.length} sticker(s)`);
    item.stickers.slice(0, 5).forEach((sticker) => {
      const dot = document.createElement('span');
      dot.className = 'inv-sticker-dot';
      dot.title = sticker.stickerId || 'Sticker';
      strip.append(dot);
    });
    card.querySelector('.skin-body')?.append(strip);
  }

  // Selection affordance (only visible in bulk mode).
  const check = document.createElement('span');
  check.className = 'inv-check';
  check.setAttribute('aria-hidden', 'true');
  check.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  card.prepend(check);

  if (state.selected.has(item.uid)) card.classList.add('is-selected');
  return card;
}

const EMPTY_MARKUP = `
  <span class="inv-empty-art" aria-hidden="true">
    <svg viewBox="0 0 120 96" width="120" height="96" fill="none">
      <rect x="14" y="30" width="92" height="52" rx="10" stroke="currentColor" stroke-width="1.4" opacity="0.5"/>
      <path d="M14 42h92" stroke="currentColor" stroke-width="1.4" opacity="0.35"/>
      <path d="M46 30v-6a8 8 0 0 1 8-8h12a8 8 0 0 1 8 8v6" stroke="currentColor" stroke-width="1.4" opacity="0.5"/>
      <path d="M60 52v10M55 57h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.75"/>
    </svg>
  </span>
  <p class="empty-title">Your inventory is empty</p>
  <p class="empty-copy">Spin the wheel to win your first skin.</p>
  <button class="btn btn-primary" type="button" data-view-target="games">Go to the games</button>`;

/* ------------------------------------------------------------------ render */

function renderStats() {
  const entries = ownedEntries();
  const value = entries.reduce((sum, entry) => sum + entryValue(entry), 0);
  recordValue(value);
  paintValue(value);

  if (els.items) els.items.textContent = formatValue(entries.length);
  if (els.count) {
    els.count.textContent = `${entries.length} item${entries.length === 1 ? '' : 's'}`;
  }

  const { pct, dir } = trend();
  if (els.trend) {
    els.trend.dataset.dir = dir;
    els.trend.textContent =
      dir === 'flat' && pct === 0 ? '—' : `${pct > 0 ? '↑' : pct < 0 ? '↓' : '→'} ${Math.abs(pct)}% this week`;
  }
}

function renderBulkBar(visibleCount) {
  if (!els.bulkbar) return;
  const count = state.selected.size;
  els.bulkbar.hidden = !state.bulk || count === 0;
  if (els.bulkCount) els.bulkCount.textContent = `${count} selected`;
  if (els.bulkSell) {
    els.bulkSell.disabled = count === 0;
    const payout = selectedPayout();
    els.bulkSell.innerHTML =
      count === 0 ? 'Sell Selected' : `Sell Selected (${count}) · +${formatCrystals(payout)} ${crystalIcon(13)}`;
  }
  void visibleCount;
}

function render() {
  if (!els) return;
  renderStats();

  const list = filteredEntries();
  els.grid.classList.toggle('is-bulk', state.bulk);

  // Drop selections for items that no longer exist.
  const live = new Set(ownedEntries().map(({ item }) => item.uid));
  [...state.selected].forEach((uid) => {
    if (!live.has(uid)) state.selected.delete(uid);
  });

  if (list.length === 0) {
    const owned = ownedEntries().length;
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    // Filtered-to-nothing is a different message than a truly empty inventory.
    empty.innerHTML =
      owned === 0
        ? EMPTY_MARKUP
        : `<p class="empty-title">Nothing matches those filters</p>
           <p class="empty-copy">Try clearing the search or a filter.</p>
           <button class="btn btn-ghost" type="button" data-inv-reset-filters>Reset filters</button>`;
    els.grid.replaceChildren(empty);
  } else {
    els.grid.replaceChildren(...list.map(({ item, skin }) => createCard(item, skin)));
  }

  renderBulkBar(list.length);
  syncFilterChips();
}

/* ------------------------------------------------------------------ filters */

function buildFilters() {
  if (!els.filters) return;
  els.filters.innerHTML = `
    <div class="inv-filter-group">
      <p class="inv-filter-label">Rarity</p>
      <div class="inv-chips" data-inv-rarity-chips></div>
    </div>
    <div class="inv-filter-group">
      <p class="inv-filter-label">Weapon</p>
      <div class="inv-chips" data-inv-category-chips></div>
    </div>
    <div class="inv-filter-group">
      <p class="inv-filter-label">Wear</p>
      <div class="inv-chips" data-inv-wear-chips></div>
    </div>
    <div class="inv-filter-group">
      <p class="inv-filter-label">Special</p>
      <div class="inv-chips">
        <button class="inv-chip" type="button" data-inv-toggle="stattrak">StatTrak only</button>
        <button class="inv-chip" type="button" data-inv-toggle="stickers">Stickers only</button>
        <button class="inv-chip inv-chip-reset" type="button" data-inv-reset-filters>Reset</button>
      </div>
    </div>`;

  const rarity = els.filters.querySelector('[data-inv-rarity-chips]');
  RARITY_ORDER.forEach((tier) => {
    rarity.append(createChip(tier, tier, { color: RARITIES[tier] }));
  });

  const cats = els.filters.querySelector('[data-inv-category-chips]');
  CATEGORIES.forEach((c) => cats.append(createChip(c.label, c.id, { group: 'categories' })));

  const wear = els.filters.querySelector('[data-inv-wear-chips]');
  WEAR_ORDER.forEach((w) => wear.append(createChip(w, w, { group: 'wears' })));

  rarity.addEventListener('click', (event) => toggleChip(event, 'rarities'));
  cats.addEventListener('click', (event) => toggleChip(event, 'categories'));
  wear.addEventListener('click', (event) => toggleChip(event, 'wears'));
}

function createChip(label, value, { color = null, group = 'rarities' } = {}) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'inv-chip';
  chip.dataset.invChip = value;
  chip.dataset.invGroup = group;
  chip.textContent = label;
  if (color) chip.style.setProperty('--chip', color);
  return chip;
}

function toggleChip(event, bucket) {
  const chip = event.target.closest('[data-inv-chip]');
  if (!chip) return;
  const value = chip.dataset.invChip;
  if (state[bucket].has(value)) state[bucket].delete(value);
  else state[bucket].add(value);
  render();
}

function syncFilterChips() {
  if (!els.filters) return;
  els.filters.querySelectorAll('[data-inv-chip]').forEach((chip) => {
    const bucket = chip.dataset.invGroup;
    const active = state[bucket]?.has(chip.dataset.invChip);
    chip.classList.toggle('is-active', Boolean(active));
    chip.setAttribute('aria-pressed', String(Boolean(active)));
  });
  els.filters.querySelectorAll('[data-inv-toggle]').forEach((chip) => {
    const active = Boolean(state[chip.dataset.invToggle]);
    chip.classList.toggle('is-active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
}

function resetFilters() {
  state.rarities.clear();
  state.categories.clear();
  state.wears.clear();
  state.stattrak = false;
  state.stickers = false;
  state.search = '';
  if (els.search) els.search.value = '';
  render();
}

/* ----------------------------------------------------------------- bulk ops */

function selectedEntries() {
  const byUid = new Map(ownedEntries().map((entry) => [entry.item.uid, entry]));
  return [...state.selected].map((uid) => byUid.get(uid)).filter(Boolean);
}

function selectedPayout() {
  return selectedEntries().reduce(
    (sum, { skin }) => sum + Math.max(1, Math.round(skin.price * 0.7)),
    0
  );
}

function toggleSelect(uid) {
  if (state.selected.has(uid)) state.selected.delete(uid);
  else if (state.selected.size < MAX_SELECT) state.selected.add(uid);
  else showToast(`You can select up to ${MAX_SELECT} items at once`, 'info');
  render();
}

function setBulkMode(on) {
  state.bulk = on;
  if (!on) state.selected.clear();
  if (els.bulkBtn) {
    els.bulkBtn.classList.toggle('is-active', on);
    els.bulkBtn.setAttribute('aria-pressed', String(on));
    els.bulkBtn.textContent = on ? 'Done selecting' : 'Bulk select';
  }
  render();
}

/** The bulk sell confirmation modal. */
function openBulkSell() {
  const entries = selectedEntries();
  if (!entries.length) return;
  const payout = selectedPayout();
  const count = entries.length;

  const modal = document.createElement('div');
  modal.className = 'inv-modal is-open';
  modal.innerHTML = `
    <div class="inv-backdrop" data-bulk-close></div>
    <div class="inv-dialog inv-dialog-sm" role="dialog" aria-modal="true" aria-label="Sell selected items">
      <h2 class="inv-title">Sell ${count} item${count === 1 ? '' : 's'}?</h2>
      <p class="inv-copy">You will receive <strong>${formatCrystals(payout)} ${crystalIcon(14)}</strong> at the ${Math.round(
        0.7 * 100
      )}% buy-back rate. This cannot be undone.</p>
      <div class="inv-actions">
        <button class="btn btn-ghost" type="button" data-bulk-close>Cancel</button>
        <button class="btn btn-primary" type="button" data-bulk-confirm>Sell for ${formatCrystals(payout)} ${crystalIcon(13)}</button>
      </div>
    </div>`;
  hydrateCrystalIcons(modal);

  const close = () => modal.remove();
  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-bulk-close]')) close();
    if (event.target.closest('[data-bulk-confirm]')) {
      confirmBulkSell(entries, payout);
      close();
    }
  });
  document.body.append(modal);
}

function confirmBulkSell(entries, payout) {
  entries.forEach(({ item }) => removeItem(item.uid));
  addCrystals(payout);
  record({
    type: 'sale',
    label: `Sold ${entries.length} item${entries.length === 1 ? '' : 's'} from inventory`,
    amount: payout,
  });
  showToast(
    `Sold ${entries.length} item${entries.length === 1 ? '' : 's'} for ${formatCrystals(payout)} Crystals`,
    'success'
  );
  state.selected.clear();
}

/* ------------------------------------------------------------ detail modal */

const DETAIL_TEMPLATE = `
  <div class="inv-backdrop" data-inv-close></div>
  <div class="inv-dialog" role="dialog" aria-modal="true" aria-labelledby="invModalTitle">
    <button class="inv-modal-close" type="button" aria-label="Close" data-inv-close>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <div class="inv-media" data-inv-media>
      <span class="inv-media-bar" aria-hidden="true"></span>
      <img class="inv-media-img" alt="" />
      <span class="inv-media-glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="56" height="56" fill="none"><path d="${GLYPHS.default}" fill="currentColor" opacity="0.5"/></svg>
      </span>
      <span class="inv-media-shimmer" aria-hidden="true"></span>
      <span class="inv-owned">Owned</span>
      <span class="inv-stattrak" data-inv-stat hidden>StatTrak™</span>
    </div>
    <div class="inv-body">
      <p class="inv-rarity" data-inv-rarity></p>
      <h2 class="inv-title" id="invModalTitle" data-inv-title></h2>
      <p class="inv-cond" data-inv-cond></p>
      <dl class="inv-meta">
        <div><dt>Weapon</dt><dd data-inv-weapon></dd></div>
        <div><dt>Wear</dt><dd data-inv-wear></dd></div>
        <div><dt>Float</dt><dd data-inv-float></dd></div>
        <div><dt>Value</dt><dd data-inv-value-cell></dd></div>
        <div><dt>Obtained</dt><dd data-inv-via></dd></div>
      </dl>
      <button class="inv-proof" type="button" data-inv-proof>How I got this →</button>
      <div class="inv-sticker-list" data-inv-stickers hidden></div>
      <div class="inv-actions inv-actions-grid">
        <button class="btn btn-ghost" type="button" data-inv-action="sell">Sell</button>
        <button class="btn btn-ghost" type="button" data-inv-action="trade">Trade</button>
        <button class="btn btn-ghost" type="button" data-inv-action="gift">Gift</button>
        <button class="btn btn-ghost" type="button" data-inv-action="upgrade">Upgrade</button>
        <button class="btn btn-ghost" type="button" data-inv-action="sticker">Apply Sticker</button>
      </div>
      <p class="inv-history" data-inv-history></p>
    </div>
  </div>`;

let currentUid = null;

function ensureDetail() {
  if (detail) return detail;
  detail = document.createElement('div');
  detail.className = 'inv-modal';
  detail.innerHTML = DETAIL_TEMPLATE;
  detail.addEventListener('click', (event) => {
    if (event.target.closest('[data-inv-close]')) return closeDetail();
    if (event.target.closest('[data-inv-proof]')) return openProof();
    const action = event.target.closest('[data-inv-action]');
    if (action) return runAction(action.dataset.invAction);
    const removeSticker = event.target.closest('[data-sticker-remove]');
    if (removeSticker) return removeStickerSlot(Number(removeSticker.dataset.stickerRemove));
  });
  document.body.append(detail);
  return detail;
}

function openDetail(uid) {
  const item = getItems().find((entry) => entry.uid === uid);
  const skin = item && getSkinById(item.id);
  if (!item || !skin) return;
  currentUid = uid;

  const modal = ensureDetail();
  const media = modal.querySelector('[data-inv-media]');
  media.classList.remove('is-fallback');
  const img = modal.querySelector('.inv-media-img');
  img.src = skin.image;
  img.alt = `${skin.weapon} | ${skin.finish}`;
  img.onerror = () => media.classList.add('is-fallback');

  modal.style.setProperty('--rarity', RARITIES[skin.rarity] ?? RARITIES.Consumer);
  modal.querySelector('[data-inv-rarity]').textContent = skin.rarity;
  modal.querySelector('[data-inv-title]').textContent = `${skin.weapon} | ${skin.finish}`;
  modal.querySelector('[data-inv-cond]').textContent = skin.condition;
  modal.querySelector('[data-inv-weapon]').textContent = skin.weapon;
  modal.querySelector('[data-inv-wear]').textContent = skin.condition;
  modal.querySelector('[data-inv-float]').textContent = Number.isFinite(item.floatValue)
    ? item.floatValue.toFixed(6)
    : '—';
  modal.querySelector('[data-inv-value-cell]').innerHTML = `${formatCrystals(skin.price)} ${crystalIcon(13)}`;
  modal.querySelector('[data-inv-via]').textContent = `${SOURCE_LABELS[item.obtainedVia] || 'Unknown'} · ${formatDate(
    item.obtainedAt
  )}`;
  modal.querySelector('[data-inv-stat]').hidden = !item.stattrak;
  modal.querySelector('[data-inv-media]').classList.toggle('is-holo', item.holo === true);
  hydrateCrystalIcons(modal);

  renderStickers(modal, item);
  modal.querySelector('[data-inv-history]').textContent = `Owned since ${formatDate(item.obtainedAt)}${
    item.tradeLocked ? ' · trade-locked' : ''
  }`;

  lastFocused = document.activeElement;
  modal.classList.add('is-open');
  document.body.classList.add('modal-open');
  modal.querySelector('.inv-modal-close')?.focus();
}

function renderStickers(modal, item) {
  const list = modal.querySelector('[data-inv-stickers]');
  const stickers = item.stickers || [];
  list.hidden = stickers.length === 0;
  if (!stickers.length) {
    list.replaceChildren();
    return;
  }
  list.replaceChildren(
    ...stickers.map((sticker, index) => {
      const row = document.createElement('div');
      row.className = 'inv-sticker-row';
      row.innerHTML = `<span class="inv-sticker-swatch" aria-hidden="true"></span>
        <span class="inv-sticker-name"></span>
        <button class="inv-sticker-remove" type="button" data-sticker-remove="${index}">Remove</button>`;
      row.querySelector('.inv-sticker-name').textContent = sticker.stickerId || `Sticker ${index + 1}`;
      return row;
    })
  );
}

function removeStickerSlot(index) {
  const item = getItems().find((entry) => entry.uid === currentUid);
  if (!item) return;
  const stickers = (item.stickers || []).filter((_, i) => i !== index);
  const updated = updateItem(item.uid, { stickers });
  if (updated) {
    showToast('Sticker removed', 'info');
    openDetail(item.uid);
  }
}

function closeDetail() {
  if (!detail) return;
  detail.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  currentUid = null;
  if (lastFocused instanceof HTMLElement) lastFocused.focus();
}

function openProof() {
  if (window.BLAZZER_FAIR?.open) window.BLAZZER_FAIR.open();
  else showToast('Provably-fair panel is unavailable', 'info');
}

function runAction(action) {
  const item = getItems().find((entry) => entry.uid === currentUid);
  if (!item) return;

  switch (action) {
    case 'sell': {
      if (item.isListed) return showToast('This item is listed for sale', 'error');
      // Stage 3.2: hand off to the market sell modal instead of an instant sale.
      closeDetail();
      return openSellModal(item.uid);
    }
    case 'trade':
      // Stage 3.3: create a trade with this item on your side.
      closeDetail();
      return openCreateTrade([item.uid]);
    case 'gift':
      return showToast('Gifting arrives in Stage 3.5', 'info');
    case 'upgrade':
      return showToast('The upgrade tool arrives in Stage 3.4', 'info');
    case 'sticker':
      return showToast('Sticker application arrives in a later stage', 'info');
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ helpers */

function formatDate(ms) {
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
      new Date(ms)
    );
  } catch {
    return '—';
  }
}

/* -------------------------------------------------------------------- events */

function wire() {
  els.search?.addEventListener('input', (event) => {
    state.search = event.target.value || '';
    render();
  });
  els.sort?.addEventListener('change', (event) => {
    state.sort = event.target.value;
    render();
  });
  els.filterToggle?.addEventListener('click', () => {
    const open = els.filters.hidden;
    els.filters.hidden = !open;
    els.filterToggle.setAttribute('aria-expanded', String(open));
    els.filterToggle.classList.toggle('is-active', open);
  });
  els.bulkBtn?.addEventListener('click', () => setBulkMode(!state.bulk));
  els.bulkCancel?.addEventListener('click', () => setBulkMode(false));
  els.bulkSell?.addEventListener('click', openBulkSell);
  els.bulkTrade?.addEventListener('click', () => {
    const uids = [...state.selected];
    if (!uids.length) return showToast('Select items to trade', 'info');
    return openCreateTrade(uids);
  });
  els.bulkUpgrade?.addEventListener('click', () => showToast('The upgrade tool arrives in Stage 3.4', 'info'));

  els.filters?.addEventListener('click', (event) => {
    if (event.target.closest('[data-inv-reset-filters]')) resetFilters();
    const toggle = event.target.closest('[data-inv-toggle]');
    if (toggle) {
      state[toggle.dataset.invToggle] = !state[toggle.dataset.invToggle];
      render();
    }
  });

  // One delegated handler for card activation and selection.
  const onActivate = (event) => {
    const card = event.target.closest('.inv-card');
    if (!card || !els.grid.contains(card)) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    if (event.type === 'keydown') event.preventDefault();
    const uid = card.dataset.invUid;
    if (state.bulk) toggleSelect(uid);
    else openDetail(uid);
  };
  els.grid.addEventListener('click', onActivate);
  els.grid.addEventListener('keydown', onActivate);

  els.grid.addEventListener('click', (event) => {
    if (event.target.closest('[data-inv-reset-filters]')) resetFilters();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDetail();
  });
}

/* ---------------------------------------------------------------------- init */

export function initInventoryView() {
  const grid = document.querySelector('[data-inventory-grid]');
  if (!grid) return;

  els = {
    grid,
    count: document.querySelector('[data-inventory-count]'),
    value: document.querySelector('[data-inv-value]'),
    items: document.querySelector('[data-inv-items]'),
    trend: document.querySelector('[data-inv-trend]'),
    search: document.querySelector('[data-inv-search]'),
    sort: document.querySelector('[data-inv-sort]'),
    filterToggle: document.querySelector('[data-inv-filter-toggle]'),
    filters: document.querySelector('[data-inv-filters]'),
    bulkBtn: document.querySelector('[data-inv-bulk-toggle]'),
    bulkbar: document.querySelector('[data-inv-bulkbar]'),
    bulkCount: document.querySelector('[data-inv-bulk-count]'),
    bulkSell: document.querySelector('[data-inv-bulk-sell]'),
    bulkTrade: document.querySelector('[data-inv-bulk-trade]'),
    bulkUpgrade: document.querySelector('[data-inv-bulk-upgrade]'),
    bulkCancel: document.querySelector('[data-inv-bulk-cancel]'),
  };

  buildFilters();
  wire();
  onInventoryChange(() => render());
  render();

  // Best-effort server hydration; a no-op unless explicitly enabled.
  hydrateFromServer()
    .then((adopted) => {
      if (adopted) render();
    })
    .catch(() => {});

  return { render, resetFilters };
}

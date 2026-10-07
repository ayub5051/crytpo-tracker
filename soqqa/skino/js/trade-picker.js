/* ============================================================================
   BLAZZER — trade item picker (Stage 3.3)
   The "+ Add items" modal on a trade page. Shows either your inventory or (in
   the local demo) the counterparty pool, with search + rarity/category filters
   and multi-select. Large collections render through a window so the modal
   stays at 60fps; small ones render whole.
   ========================================================================= */

import { RARITIES, getSkinById } from './skins.js';
import { getItems } from './inventory.js';
import { crystalIcon, hydrateCrystalIcons } from './icons.js';
import { poolItems, money } from './trade.js';

const VIRTUAL_THRESHOLD = 60;
const CATEGORIES = [
  { id: 'rifles', label: 'Rifles', test: (w) => /^(AK-47|M4A4|M4A1-S|Galil|FAMAS|SG 553|AUG)/.test(w) },
  { id: 'snipers', label: 'Snipers', test: (w) => /^(AWP|SSG 08|SCAR-20|G3SG1)/.test(w) },
  { id: 'pistols', label: 'Pistols', test: (w) => /^(Desert Eagle|USP-S|Glock-18|P250|Five-SeveN|Tec-9|CZ75|P2000|R8)/.test(w) },
  { id: 'smgs', label: 'SMGs', test: (w) => /^(MP9|MAC-10|UMP-45|P90|MP7|MP5)/.test(w) },
  { id: 'knives', label: 'Knives', test: (w) => w.startsWith('★') && !/Gloves/.test(w) },
  { id: 'gloves', label: 'Gloves', test: (w) => /Gloves/.test(w) },
];

let modal = null;
let state = null;
let layout = null;
let scrollRaf = 0;
let onConfirmCb = null;

function categoryOf(weapon = '') {
  const hit = CATEGORIES.find((c) => c.test(weapon));
  return hit ? hit.id : 'other';
}

/** Normalise both sources into one shape the picker can render. */
function sourceEntries(source) {
  if (source === 'pool') {
    return poolItems().map((entry) => ({ uid: entry.uid, catalogueId: entry.catalogueId, isListed: false }));
  }
  return getItems().map((item) => ({ uid: item.uid, catalogueId: item.id, isListed: Boolean(item.isListed) }));
}

function filtered() {
  return sourceEntries(state.source)
    .map((entry) => ({ entry, skin: getSkinById(entry.catalogueId) }))
    .filter(({ entry, skin }) => {
      if (!skin) return false;
      if (state.alreadyIn.includes(entry.uid)) return false;
      if (entry.isListed) return false;
      if (state.rarity !== 'all' && skin.rarity !== state.rarity) return false;
      if (state.category !== 'all' && categoryOf(skin.weapon) !== state.category) return false;
      if (state.q && !`${skin.weapon} ${skin.finish}`.toLowerCase().includes(state.q)) return false;
      return true;
    });
}

function tile({ entry, skin }) {
  const on = state.selected.has(entry.uid);
  return (
    `<button class="pick-tile${on ? ' is-selected' : ''}" type="button" data-pick="${entry.uid}" style="--rarity:${RARITIES[skin.rarity] ?? '#b0c3d9'}">` +
    `<span class="pick-check" aria-hidden="true">✓</span>` +
    `<span class="pick-thumb">${
      skin.image ? `<img src="${skin.image}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<span class="pick-glyph">${crystalIcon(22)}</span>`
    }</span>` +
    `<span class="pick-name">${skin.weapon} | ${skin.finish}</span>` +
    `<span class="pick-value">${money(skin.price)}</span>` +
    '</button>'
  );
}

function renderWindow(list) {
  const grid = modal.querySelector('[data-pick-grid]');
  const scroller = modal.querySelector('[data-pick-scroll]');
  const cols = layout?.cols ?? 4;
  const rowHeight = layout?.rowHeight ?? 150;
  const totalRows = Math.ceil(list.length / cols);
  const viewport = scroller?.clientHeight || 480;
  const scrolled = Math.max(0, (scroller?.scrollTop || 0) - (layout?.gridTop || 0));
  const firstRow = Math.max(0, Math.floor(scrolled / rowHeight) - 2);
  const rowsOnScreen = Math.ceil(viewport / rowHeight) + 4;
  const lastRow = Math.min(totalRows, firstRow + rowsOnScreen);
  const start = firstRow * cols;
  const end = Math.min(list.length, lastRow * cols);

  const top = firstRow > 0 ? `<div class="pick-spacer" style="height:${firstRow * rowHeight}px"></div>` : '';
  const bottom = totalRows - lastRow > 0 ? `<div class="pick-spacer" style="height:${(totalRows - lastRow) * rowHeight}px"></div>` : '';
  grid.innerHTML = `${top}${list.slice(start, end).map(tile).join('')}${bottom}`;
}

/** Measure column count + row height from a full render, once per open. */
function measure(list) {
  const grid = modal.querySelector('[data-pick-grid]');
  grid.innerHTML = list.map(tile).join('');
  const styles = getComputedStyle(grid);
  const cols = Math.max(1, styles.gridTemplateColumns.split(' ').filter(Boolean).length);
  const first = grid.querySelector('.pick-tile');
  const rect = first?.getBoundingClientRect();
  const rowGap = Number.parseFloat(styles.rowGap) || 0;
  const cardHeight = Math.max(80, rect?.height ?? 150);
  grid.style.gridAutoRows = `${cardHeight}px`;
  layout = { cols, rowHeight: cardHeight + rowGap, gridTop: grid.getBoundingClientRect().top };
}

function renderGrid() {
  const grid = modal.querySelector('[data-pick-grid]');
  const list = filtered();
  const total = modal.querySelector('[data-pick-total]');
  if (total) total.textContent = `${list.length} item${list.length === 1 ? '' : 's'}`;

  if (!list.length) {
    grid.classList.remove('is-virtual');
    grid.innerHTML = '<div class="empty-state"><p class="empty-title">Nothing to add</p><p class="empty-copy">Try a different filter.</p></div>';
    return;
  }

  if (list.length <= VIRTUAL_THRESHOLD) {
    grid.classList.remove('is-virtual');
    grid.style.gridAutoRows = '';
    grid.innerHTML = list.map(tile).join('');
    return;
  }

  grid.classList.add('is-virtual');
  if (!layout) measure(list);
  renderWindow(list);
}

function renderSummary() {
  const byUid = new Map(sourceEntries(state.source).map((e) => [e.uid, e]));
  const total = [...state.selected].reduce((n, uid) => {
    const entry = byUid.get(uid);
    const skin = entry && getSkinById(entry.catalogueId);
    return n + (skin?.price ?? 0);
  }, 0);
  const summary = modal.querySelector('[data-pick-summary]');
  if (summary) summary.innerHTML = `${state.selected.size} item(s) selected · ${money(total)}`;
  const confirm = modal.querySelector('[data-pick-confirm]');
  if (confirm) confirm.disabled = state.selected.size === 0;
}

function render() {
  renderGrid();
  renderSummary();
  hydrateCrystalIcons(modal);
}

function ensureModal() {
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'market-modal trade-picker';
  modal.innerHTML =
    '<div class="market-backdrop" data-pick-close></div>' +
    '<div class="market-dialog" role="dialog" aria-modal="true" aria-labelledby="pickTitle">' +
    '<button class="market-modal-close" type="button" data-pick-close aria-label="Close">✕</button>' +
    '<h2 class="market-title" id="pickTitle" data-pick-title></h2>' +
    '<div class="pick-toolbar">' +
    '<label class="field field-search"><span class="field-label">Search</span><input type="search" data-pick-search placeholder="Weapon or finish" autocomplete="off" /></label>' +
    '<label class="field"><span class="field-label">Rarity</span><select data-pick-rarity><option value="all">All rarities</option></select></label>' +
    '<label class="field"><span class="field-label">Weapon</span><select data-pick-category><option value="all">All weapons</option></select></label>' +
    '<span class="pick-total" data-pick-total>0 items</span>' +
    '</div>' +
    '<div class="pick-scroll" data-pick-scroll><div class="pick-grid" data-pick-grid></div></div>' +
    '<div class="market-actions pick-actions">' +
    '<span class="pick-summary" data-pick-summary>0 items selected</span>' +
    '<button class="btn btn-ghost" type="button" data-pick-close>Cancel</button>' +
    '<button class="btn btn-primary" type="button" data-pick-confirm disabled>Add to trade</button>' +
    '</div></div>';

  const rarity = modal.querySelector('[data-pick-rarity]');
  Object.keys(RARITIES).forEach((tier) => {
    const opt = document.createElement('option');
    opt.value = tier;
    opt.textContent = tier;
    rarity.append(opt);
  });
  const category = modal.querySelector('[data-pick-category]');
  CATEGORIES.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.label;
    category.append(opt);
  });

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-pick-close]')) return closePicker();
    const pick = event.target.closest('[data-pick]');
    if (pick) {
      const uid = pick.dataset.pick;
      if (state.selected.has(uid)) state.selected.delete(uid);
      else state.selected.add(uid);
      pick.classList.toggle('is-selected', state.selected.has(uid));
      renderSummary();
      return undefined;
    }
    if (event.target.closest('[data-pick-confirm]')) {
      const uids = [...state.selected];
      const cb = onConfirmCb;
      closePicker();
      cb?.(uids);
      return undefined;
    }
    return undefined;
  });

  modal.querySelector('[data-pick-search]').addEventListener('input', (event) => {
    state.q = (event.target.value || '').trim().toLowerCase();
    render();
  });
  modal.querySelector('[data-pick-rarity]').addEventListener('change', (event) => {
    state.rarity = event.target.value;
    render();
  });
  modal.querySelector('[data-pick-category]').addEventListener('change', (event) => {
    state.category = event.target.value;
    render();
  });
  modal.querySelector('[data-pick-scroll]').addEventListener(
    'scroll',
    () => {
      const grid = modal.querySelector('[data-pick-grid]');
      if (!grid.classList.contains('is-virtual')) return;
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        renderWindow(filtered());
      });
    },
    { passive: true }
  );

  document.body.append(modal);
  return modal;
}

export function openTradePicker({ source = 'inventory', alreadyIn = [], title = 'Add items', onConfirm } = {}) {
  ensureModal();
  state = { source, alreadyIn: [...alreadyIn], selected: new Set(), q: '', rarity: 'all', category: 'all' };
  layout = null;
  onConfirmCb = onConfirm;

  modal.querySelector('[data-pick-title]').textContent = title;
  modal.querySelector('[data-pick-search]').value = '';
  modal.querySelector('[data-pick-rarity]').value = 'all';
  modal.querySelector('[data-pick-category]').value = 'all';
  const grid = modal.querySelector('[data-pick-grid]');
  grid.style.gridAutoRows = '';
  grid.classList.remove('is-virtual');

  modal.classList.add('is-open');
  document.body.classList.add('modal-open');

  // Render after the dialog has its final size so measurement is accurate.
  requestAnimationFrame(() => {
    modal.querySelector('[data-pick-scroll]').scrollTop = 0;
    render();
  });
}

export function closePicker() {
  if (!modal) return;
  modal.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  const grid = modal.querySelector('[data-pick-grid]');
  grid.classList.remove('is-virtual');
  grid.style.gridAutoRows = '';
  grid.replaceChildren();
  layout = null;
  onConfirmCb = null;
}

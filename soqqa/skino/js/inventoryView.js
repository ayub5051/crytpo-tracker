/* ============================================================================
   SKINO — inventory view
   Renders owned skins (with quantities and sorting) and offers a one-click
   "sell duplicates" action that trades spare copies back for Crystals.
   ========================================================================= */

import { getSkinById, createSkinCard, sellPrice } from './skins.js';
import { getInventory, totalItems, removeMany, onInventoryChange } from './inventory.js';
import { addCrystals, formatCrystals } from './crystals.js';
import { record } from './ledger.js';
import { showToast } from './toast.js';

const EMPTY_MARKUP = `
  <span class="empty-mark" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
      <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z"
        stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
      <path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" stroke="currentColor" stroke-width="1.3" />
    </svg>
  </span>
  <p class="empty-title">Your inventory is empty</p>
  <p class="empty-copy">Skins you buy or win from the games will appear here.</p>
  <button class="btn btn-ghost" type="button" data-view-target="market">
    Browse the market
  </button>`;

const SORTS = {
  'value-desc': (a, b) => b.skin.price * b.qty - a.skin.price * a.qty,
  'value-asc': (a, b) => a.skin.price * a.qty - b.skin.price * b.qty,
  'qty-desc': (a, b) => b.qty - a.qty,
  name: (a, b) =>
    `${a.skin.weapon} ${a.skin.finish}`.localeCompare(`${b.skin.weapon} ${b.skin.finish}`),
};

export function initInventoryView() {
  const grid = document.querySelector('[data-inventory-grid]');
  const countEl = document.querySelector('[data-inventory-count]');
  const sortEl = document.querySelector('[data-inventory-sort]');
  const sellBtn = document.querySelector('[data-inventory-sell-dupes]');
  if (!grid) return;

  function ownedList() {
    return getInventory()
      .map(({ id, qty }) => ({ skin: getSkinById(id), qty }))
      .filter((entry) => entry.skin);
  }

  /** One copy of every stack beyond the first is a sellable duplicate. */
  function duplicateRemovals(owned) {
    return owned
      .filter((entry) => entry.qty > 1)
      .map((entry) => ({ id: entry.skin.id, qty: entry.qty - 1 }));
  }

  function summarise(removals) {
    const count = removals.reduce((sum, r) => sum + r.qty, 0);
    const gained = removals.reduce(
      (sum, r) => sum + sellPrice(getSkinById(r.id)) * r.qty,
      0
    );
    return { count, gained };
  }

  function render() {
    const owned = ownedList();
    const total = totalItems();
    const value = owned.reduce((sum, entry) => sum + entry.skin.price * entry.qty, 0);

    if (countEl) {
      countEl.textContent = `${total} item${total === 1 ? '' : 's'} · ${formatCrystals(
        value
      )} ◆`;
    }

    const { count: dupCount, gained } = summarise(duplicateRemovals(owned));
    if (sellBtn) {
      sellBtn.disabled = dupCount === 0;
      sellBtn.textContent =
        dupCount === 0
          ? 'No duplicates to sell'
          : `Sell ${dupCount} duplicate${dupCount === 1 ? '' : 's'} · +${formatCrystals(
              gained
            )} ◆`;
    }

    if (owned.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = EMPTY_MARKUP;
      grid.replaceChildren(empty);
      return;
    }

    const key = sortEl?.value ?? 'value-desc';
    const sorted = [...owned].sort(SORTS[key] ?? SORTS['value-desc']);
    grid.replaceChildren(...sorted.map(({ skin, qty }) => createSkinCard(skin, { qty })));
  }

  function sellDuplicates() {
    const removals = duplicateRemovals(ownedList());
    if (removals.length === 0) return;
    const { count, gained } = summarise(removals);

    removeMany(removals);
    addCrystals(gained);
    record({
      type: 'sale',
      label: `Sold ${count} duplicate${count === 1 ? '' : 's'}`,
      amount: gained,
    });
    showToast(
      `Sold ${count} duplicate${count === 1 ? '' : 's'} for ${formatCrystals(
        gained
      )} Crystals`,
      'success'
    );
  }

  sortEl?.addEventListener('change', render);
  sellBtn?.addEventListener('click', sellDuplicates);
  onInventoryChange(render);
  render();
}

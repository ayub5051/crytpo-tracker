/* ============================================================================
   SKINO — inventory view
   Renders owned skins (with quantities) and keeps the item count current.
   ========================================================================= */

import { getSkinById, createSkinCard } from './skins.js';
import { getInventory, totalItems, onInventoryChange } from './inventory.js';

const EMPTY_MARKUP = `
  <span class="empty-mark" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
      <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z"
        stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
      <path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" stroke="currentColor" stroke-width="1.3" />
    </svg>
  </span>
  <p class="empty-title">Your inventory is empty</p>
  <p class="empty-copy">Skins you buy or win from the Wheel will appear here.</p>
  <button class="btn btn-ghost" type="button" data-view-target="market">
    Browse the market
  </button>`;

export function initInventoryView() {
  const grid = document.querySelector('[data-inventory-grid]');
  const countEl = document.querySelector('[data-inventory-count]');
  if (!grid) return;

  function render(items) {
    const owned = items
      .map(({ id, qty }) => ({ skin: getSkinById(id), qty }))
      .filter((entry) => entry.skin);

    if (countEl) {
      const total = totalItems();
      countEl.textContent = `${total} item${total === 1 ? '' : 's'}`;
    }

    if (owned.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = EMPTY_MARKUP;
      grid.replaceChildren(empty);
      return;
    }

    grid.replaceChildren(
      ...owned.map(({ skin, qty }) => createSkinCard(skin, { qty }))
    );
  }

  render(getInventory());
  onInventoryChange(render);
}

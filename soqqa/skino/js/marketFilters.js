/* ============================================================================
   BLAZZER — market toolbar (Stage 3.2)
   The existing search / rarity / sort bar, now a thin adapter: it keeps its own
   markup and behaviour but hands every change to js/marketplace.js, which owns
   the listing model, the drawer and the grid. Keeping the toolbar here means
   the bar itself is untouched while the grid beneath it became a real market.
   ========================================================================= */

import { RARITIES } from './skins.js';

/**
 * Wire the toolbar controls.
 *
 * @param {object} handlers
 * @param {(value:string)=>void} handlers.onSearch
 * @param {(value:string)=>void} handlers.onRarity
 * @param {(value:string)=>void} handlers.onSort
 */
export function initMarketToolbar({ onSearch, onRarity, onSort } = {}) {
  const search = document.querySelector('[data-filter-search]');
  const rarity = document.querySelector('[data-filter-rarity]');
  const sort = document.querySelector('[data-filter-sort]');

  // Populate the rarity select once (the markup ships with only "All rarities").
  if (rarity && rarity.options.length <= 1) {
    Object.keys(RARITIES).forEach((tier) => {
      const opt = document.createElement('option');
      opt.value = tier;
      opt.textContent = tier;
      rarity.append(opt);
    });
  }

  search?.addEventListener('input', (event) => onSearch?.(event.target.value || ''));
  rarity?.addEventListener('change', (event) => onRarity?.(event.target.value || 'all'));
  sort?.addEventListener('change', (event) => onSort?.(event.target.value || 'featured'));

  return { search, rarity, sort };
}

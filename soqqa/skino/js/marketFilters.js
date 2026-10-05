/* ============================================================================
   SKINO — market filters
   Search, rarity and sort controls layered over the skin catalogue. Rendering
   is delegated to skins.js so cards stay consistent everywhere.
   ========================================================================= */

import { SKINS, RARITIES, renderMarket } from './skins.js';

const SORTS = {
  'price-asc': (a, b) => a.price - b.price,
  'price-desc': (a, b) => b.price - a.price,
  name: (a, b) =>
    `${a.weapon} ${a.finish}`.localeCompare(`${b.weapon} ${b.finish}`),
};

const EMPTY_MARKUP = `
  <span class="empty-mark" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
      <circle cx="11" cy="11" r="6" stroke="currentColor" stroke-width="1.3" />
      <path d="m15.5 15.5 4 4" stroke="currentColor" stroke-width="1.3"
        stroke-linecap="round" />
    </svg>
  </span>
  <p class="empty-title">No skins match those filters</p>
  <p class="empty-copy">Try a different search or rarity tier.</p>
  <button class="btn btn-ghost" type="button" data-filter-reset>Reset filters</button>`;

export function initMarketFilters() {
  const grid = document.querySelector('[data-market-grid]');
  const countEl = document.querySelector('[data-market-count]');
  const search = document.querySelector('[data-filter-search]');
  const rarity = document.querySelector('[data-filter-rarity]');
  const sort = document.querySelector('[data-filter-sort]');

  if (rarity && rarity.options.length <= 1) {
    Object.keys(RARITIES).forEach((tier) => {
      const opt = document.createElement('option');
      opt.value = tier;
      opt.textContent = tier;
      rarity.append(opt);
    });
  }

  const featuredIndex = new Map(SKINS.map((skin, i) => [skin.id, i]));

  function apply() {
    const q = (search?.value ?? '').trim().toLowerCase();
    const tier = rarity?.value ?? 'all';
    const sortKey = sort?.value ?? 'featured';

    const matches = SKINS.filter((skin) => {
      if (tier !== 'all' && skin.rarity !== tier) return false;
      if (!q) return true;
      return `${skin.weapon} ${skin.finish} ${skin.condition}`
        .toLowerCase()
        .includes(q);
    });

    const list =
      sortKey === 'featured'
        ? matches.sort((a, b) => featuredIndex.get(a.id) - featuredIndex.get(b.id))
        : matches.sort(SORTS[sortKey] ?? (() => 0));

    renderMarket(grid, list);

    if (countEl) {
      countEl.textContent = `${list.length} listing${list.length === 1 ? '' : 's'}`;
    }

    if (list.length === 0 && grid) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = EMPTY_MARKUP;
      grid.replaceChildren(empty);
    }
  }

  function reset() {
    if (search) search.value = '';
    if (rarity) rarity.value = 'all';
    if (sort) sort.value = 'featured';
    apply();
  }

  search?.addEventListener('input', apply);
  rarity?.addEventListener('change', apply);
  sort?.addEventListener('change', apply);
  grid?.addEventListener('click', (event) => {
    if (event.target.closest('[data-filter-reset]')) reset();
  });

  apply();
  return apply;
}

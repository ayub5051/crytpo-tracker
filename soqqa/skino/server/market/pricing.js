/* ============================================================================
   BLAZZER — market pricing (Stage 3.2)
   The sell modal wants a defensible starting price. We derive it from recent
   comparable sales for the same catalogue item, and fall back to the item's
   catalogue value when the market is thin. The median (not the mean) is used so
   a single outlier sale cannot distort the suggestion.
   ========================================================================= */

import { marketStore } from './store.js';

/** Median of a numeric list. Returns null for an empty list. */
export function median(values) {
  const nums = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
}

/**
 * A suggested listing price for a catalogue item.
 *
 * @param {string} catalogueId  catalogue skin id (e.g. "ak-47-redline")
 * @param {number} fallback     catalogue value, used when there are no sales
 * @returns {Promise<{suggested:number, low:number, high:number, samples:number}>}
 */
export async function suggestPrice(catalogueId, fallback = 0) {
  const base = Math.max(1, Math.round(Number(fallback) || 0));
  let sales = [];
  try {
    sales = await marketStore().recentSales(catalogueId, 30);
  } catch {
    sales = [];
  }
  const prices = sales.map((s) => s.price);
  const mid = median(prices);

  if (mid === null) {
    // No history: a sensible band around the catalogue value.
    return {
      suggested: base,
      low: Math.max(1, Math.round(base * 0.95)),
      high: Math.round(base * 1.05),
      samples: 0,
    };
  }

  const sorted = prices.slice().sort((a, b) => a - b);
  return {
    suggested: mid,
    low: sorted[0],
    high: sorted[sorted.length - 1],
    samples: prices.length,
  };
}

/* ============================================================================
   SOQQA — stats view
   Keeps the landing stat tiles in sync with lifetime stats (which survive
   history trimming because they are persisted separately).
   ========================================================================= */

import { formatCoins } from './format.js';

/** data-stat attribute → value resolver */
const TILES = Object.freeze({
  'total-spins': (stats) => formatCoins(stats.totalSpins),
  'biggest-win': (stats) => (stats.biggestWin > 0 ? `${formatCoins(stats.biggestWin)} soqqa` : '—'),
  'total-won': (stats) => formatCoins(stats.totalWon),
  net: (stats) => formatCoins(stats.net),
});

export function createStatsView(root = document) {
  const nodes = new Map();

  Object.keys(TILES).forEach((key) => {
    const element = root.querySelector(`[data-stat="${key}"]`);
    if (element) nodes.set(key, element);
  });

  return {
    /** @param {{ stats: object }} state */
    render(state) {
      const stats = state?.stats;
      if (!stats) return;

      nodes.forEach((element, key) => {
        const formatted = TILES[key](stats);
        if (element.textContent !== formatted) element.textContent = formatted;
      });
    },
  };
}

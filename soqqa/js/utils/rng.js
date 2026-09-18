/* ============================================================================
   SOQQA — random number utilities
   ----------------------------------------------------------------------------
   All randomness flows through here so results stay reproducible (seeded RNG
   is used by the test suite) and so the odds live in exactly one place.
   ========================================================================= */

/**
 * Seeded linear-congruential RNG — deterministic for a given seed.
 * Used by tests and by anyone who wants a reproducible spin sequence.
 * @param {number} [seed]
 */
export function createSeededRng(seed = 1) {
  let state = seed >>> 0 || 1;

  const next = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };

  return buildRng(next);
}

/** Cryptographically-seeded RNG for real play (falls back to Math.random). */
export function createRng() {
  const source =
    typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues
      ? globalThis.crypto
      : null;

  const next = () => {
    if (source) {
      const buffer = new Uint32Array(1);
      source.getRandomValues(buffer);
      return buffer[0] / 4294967296;
    }
    return Math.random();
  };

  return buildRng(next);
}

/**
 * @param {() => number} next — returns a float in [0, 1)
 */
function buildRng(next) {
  return {
    next,

    /** Integer in [min, max] inclusive. */
    int(min, max) {
      if (max < min) return min;
      return min + Math.floor(next() * (max - min + 1));
    },

    /** Index in [0, length). */
    pickIndex(length) {
      if (!Number.isFinite(length) || length <= 0) return -1;
      return Math.min(length - 1, Math.floor(next() * length));
    },

    /** Random element (undefined for empty input). */
    pick(items) {
      if (!Array.isArray(items) || items.length === 0) return undefined;
      return items[this.pickIndex(items.length)];
    },

    /**
     * Weighted index selection.
     * @param {number[]} weights — non-negative, same order as the options
     */
    weightedIndex(weights) {
      if (!Array.isArray(weights) || weights.length === 0) return -1;

      const total = weights.reduce((sum, weight) => sum + Math.max(0, Number(weight) || 0), 0);
      if (!(total > 0)) return -1;

      let roll = next() * total;
      for (let i = 0; i < weights.length; i += 1) {
        roll -= Math.max(0, Number(weights[i]) || 0);
        if (roll < 0) return i;
      }
      // Floating-point edge case: fall back to the last non-zero weight.
      for (let i = weights.length - 1; i >= 0; i -= 1) {
        if (weights[i] > 0) return i;
      }
      return -1;
    },
  };
}

/**
 * Test/stub helper: yields a fixed sequence of indices, then repeats the last.
 * @param {number[]} indices
 */
export function createStubRng(indices = []) {
  const queue = Array.isArray(indices) ? indices.slice() : [];
  let cursor = 0;

  return {
    ...buildRng(() => 0.5),
    weightedIndex() {
      if (queue.length === 0) return -1;
      const value = queue[Math.min(cursor, queue.length - 1)];
      cursor += 1;
      return value;
    },
  };
}

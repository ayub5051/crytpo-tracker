/* ============================================================================
   BLAZZER — provably-fair outcome generator
   The single, deterministic algorithm that turns a committed server seed, a
   client seed and a nonce into a game outcome. It is the server twin of
   js/fair-verify.js — the two MUST stay byte-for-byte equivalent. Any change
   here must be mirrored there (and vice versa) or verification breaks.

   Algorithm (identical on both sides):
     1. commitment = SHA-256(serverSeed)            (shown before betting)
     2. digest     = HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`)
     3. roll       = uint32(digest[0..8]) / 2^32    (float in [0, 1))
     4. outcome    = per-game mapping of `roll` (table below)

   Mapping:
     - wheel   : weighted pick over WHEEL_SEGMENTS
     - mines   : deterministic Fisher–Yates over the grid using the digest bytes
     - case    : weighted pick over the chosen tier's prizes
     - crash   : inverse-CDF with a house edge (instant bust under the edge)
     - upgrade : binary win if roll < chance (the chance comes in as a param)
   ========================================================================= */

import crypto from 'node:crypto';

export const HMAC_ALGO = 'sha256';
export const GAMES = ['wheel', 'mines', 'case', 'crash', 'upgrade'];

/* --- Game catalogues -------------------------------------------------------
   Mirrored from js/wheel.js (SEGMENTS) and js/mysteryCase.js (TIERS). Keep in
   lockstep with the client; the verify tab reads these exact numbers. */
export const WHEEL_SEGMENTS = [
  { label: 'No win', weight: 4 },
  { label: '+25', weight: 4 },
  { label: '+50', weight: 4 },
  { label: '+75', weight: 3 },
  { label: '+100', weight: 3 },
  { label: '+150', weight: 2 },
  { label: '+250', weight: 1 },
  { label: '+500', weight: 0.5 },
  { label: '+1000', weight: 0.2 },
  { label: 'AK Slate', weight: 0.15 },
  { label: 'Deagle Blaze', weight: 0.06 },
  { label: 'AWP Asiimov', weight: 0.02 },
];

export const CASE_TIERS = {
  bronze: [34, 26, 16, 6, 18],
  silver: [30, 24, 14, 6, 26],
  gold: [28, 22, 14, 6, 30],
  neon: [26, 22, 14, 6, 32],
};

export const MINES_SIZE = 25;
export const CRASH_HOUSE_EDGE = 0.01;

/* The Upgrade chance band. MUST stay in lockstep with js/upgrade-rules.js
   (MIN_CHANCE / MAX_CHANCE) and with the twin mapper in js/fair-verify.js —
   this generator clamps the chance that arrives as a param, and any difference
   in the bounds would make a bet unverifiable. The house edge itself is NOT
   duplicated here: the caller (server/upgrade/manager.js) imports
   `assess()` from js/upgrade-rules.js, so the server and the browser price a
   play from one single implementation. */
export const UPGRADE_MIN_CHANCE = 0.02;
export const UPGRADE_MAX_CHANCE = 0.95;

/* --- Primitives ------------------------------------------------------------ */

/** SHA-256 of a string, hex-encoded. */
export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/** HMAC-SHA256(key, message), hex-encoded. */
export function hmacHex(key, message) {
  return crypto.createHmac(HMAC_ALGO, key).update(message, 'utf8').digest('hex');
}

/** First 4 bytes of a hex digest → unsigned 32-bit integer. */
export function uint32FromHex(digestHex) {
  return Number.parseInt(digestHex.slice(0, 8), 16) >>> 0;
}

/** Canonical roll in [0, 1) — divides the uint32 by 2^32. */
export function rollFromDigest(digestHex) {
  return uint32FromHex(digestHex) / 4294967296;
}

/** Weighted pick: `roll` ∈ [0,1) selects an index by cumulative weight. */
export function weightedIndex(roll, weights) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) return 0;
  let target = roll * total;
  for (let i = 0; i < weights.length; i += 1) {
    target -= weights[i];
    if (target < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Deterministic mine placement: partial Fisher–Yates over [0, size) seeded by
 * the digest bytes, taking the first `mines` positions. Returned sorted.
 */
export function minesBombs(serverSeed, clientSeed, nonce, mines, size = MINES_SIZE) {
  const digest = hmacHex(serverSeed, `${clientSeed}:${nonce}`);
  const bytes = Buffer.from(digest, 'hex');
  const positions = Array.from({ length: size }, (_, i) => i);
  const count = Math.min(Math.max(1, mines | 0), size - 1);
  for (let i = 0; i < count; i += 1) {
    const j = i + (bytes[i % bytes.length] % (size - i));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions.slice(0, count).sort((a, b) => a - b);
}

/**
 * Crash multiplier from a roll. A house edge fraction of rolls bust instantly
 * at 1.00×; the rest follow an inverse-CDF so the mean payout stays ~1−edge.
 */
export function crashPoint(roll, houseEdge = CRASH_HOUSE_EDGE) {
  if (roll < houseEdge) return 1.0;
  const r = (roll - houseEdge) / (1 - houseEdge);
  return Math.floor(100 / (1 - r)) / 100;
}

/* --- Outcome --------------------------------------------------------------- */

/**
 * Compute the full, deterministic outcome for a bet.
 *
 * @param {object} input
 * @param {'wheel'|'mines'|'case'|'crash'} input.game
 * @param {string} input.serverSeed   revealed-or-current server seed (hex)
 * @param {string} input.clientSeed   client seed (string)
 * @param {number} input.nonce        bet nonce for this seed pair
 * @param {object} [input.params]     game parameters (mines count, case tier/weights, houseEdge)
 * @returns {{ game:string, nonce:number, digest:string, roll:number, outcome:object }}
 */
export function generateOutcome({ game, serverSeed, clientSeed, nonce, params = {} }) {
  const digest = hmacHex(serverSeed, `${clientSeed}:${nonce}`);
  const roll = rollFromDigest(digest);
  const base = { game, nonce, digest, roll };

  switch (game) {
    case 'wheel': {
      const index = weightedIndex(roll, WHEEL_SEGMENTS.map((s) => s.weight));
      return { ...base, outcome: { index, label: WHEEL_SEGMENTS[index].label } };
    }

    case 'mines': {
      const mines = Number(params.mines) || 3;
      return { ...base, outcome: { mines, bombs: minesBombs(serverSeed, clientSeed, nonce, mines) } };
    }

    case 'case': {
      const weights = resolveCaseWeights(params);
      const index = weightedIndex(roll, weights);
      return { ...base, outcome: { tier: params.tier || null, index, weights } };
    }

    case 'crash': {
      const houseEdge = Number.isFinite(params.houseEdge) ? params.houseEdge : CRASH_HOUSE_EDGE;
      return { ...base, outcome: { multiplier: crashPoint(roll, houseEdge), houseEdge } };
    }

    case 'upgrade': {
      // The stake and the target are pure inputs; the outcome is one bit. The
      // chance is clamped (never widened) so a hostile caller cannot inflate
      // its own odds past the band the house agreed to.
      const chance = clampUpgradeChance(params.chance);
      return {
        ...base,
        outcome: {
          chance,
          target: typeof params.target === 'string' ? params.target : null,
          win: roll < chance,
        },
      };
    }

    default:
      throw new Error(`Unknown game: ${game}`);
  }
}

/** Clamp an Upgrade chance into the house's band (mirror of clampChance()). */
export function clampUpgradeChance(chance) {
  const n = Number(chance);
  if (!Number.isFinite(n)) return UPGRADE_MIN_CHANCE;
  return Math.min(UPGRADE_MAX_CHANCE, Math.max(UPGRADE_MIN_CHANCE, n));
}

function resolveCaseWeights(params) {
  if (Array.isArray(params.weights) && params.weights.length) {
    return params.weights.map((w) => (Number.isFinite(Number(w)) && Number(w) > 0 ? Number(w) : 0));
  }
  if (params.tier && CASE_TIERS[params.tier]) return CASE_TIERS[params.tier];
  return CASE_TIERS.bronze;
}

/* ============================================================================
   BLAZZER — client provably-fair verifier
   Pure, offline verification of any BLAZZER bet using the Web Crypto API — no
   server call, no libraries. This is the exact twin of
   server/fair/outcome-generator.js. The two MUST stay in lockstep: identical
   hash input, identical roll derivation, identical per-game mapping.

   Usage (object form):
     const r = await verifyOutcome({
       serverSeed, clientSeed, nonce, game: 'wheel', params: {},
       expectedHash, expectedOutcome,
     });
     // → { digest, roll, hash, hashMatches, outcome, outcomeMatches }

   Usage (positional form, per spec):
     await verifyOutcome(serverSeed, clientSeed, nonce, 'wheel')
   ========================================================================= */

const encoder = new TextEncoder();

/* --- Crypto primitives ----------------------------------------------------- */

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** SHA-256 of a string → hex. */
export async function sha256Hex(input) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(String(input))));
}

/** HMAC-SHA256(key, message) → hex. */
export async function hmacSha256Hex(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(key)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(String(message))));
}

/* --- Deterministic mapping (mirrors the server) ---------------------------- */

export function uint32FromHex(digestHex) {
  return Number.parseInt(digestHex.slice(0, 8), 16) >>> 0;
}

export function rollFromHex(digestHex) {
  return uint32FromHex(digestHex) / 4294967296;
}

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

/** Partial Fisher–Yates over [0,size) seeded by the digest bytes. */
export function minesBombsFromDigest(digestHex, mines, size = 25) {
  const bytes = hexToBytes(digestHex);
  const positions = Array.from({ length: size }, (_, i) => i);
  const count = Math.min(Math.max(1, mines | 0), size - 1);
  for (let i = 0; i < count; i += 1) {
    const j = i + (bytes[i % bytes.length] % (size - i));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions.slice(0, count).sort((a, b) => a - b);
}

export function crashPoint(roll, houseEdge = 0.01) {
  if (roll < houseEdge) return 1.0;
  const r = (roll - houseEdge) / (1 - houseEdge);
  return Math.floor(100 / (1 - r)) / 100;
}

/* The Upgrade chance band. MUST stay in lockstep with js/upgrade-rules.js
   (MIN_CHANCE / MAX_CHANCE) and with clampUpgradeChance() in
   server/fair/outcome-generator.js. */
export const UPGRADE_MIN_CHANCE = 0.02;
export const UPGRADE_MAX_CHANCE = 0.95;

export function clampUpgradeChance(chance) {
  const n = Number(chance);
  if (!Number.isFinite(n)) return UPGRADE_MIN_CHANCE;
  return Math.min(UPGRADE_MAX_CHANCE, Math.max(UPGRADE_MIN_CHANCE, n));
}

/* Catalogues — must match js/wheel.js and js/mysteryCase.js on the client and
   server/fair/outcome-generator.js on the server. */
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

/* --- Outcome --------------------------------------------------------------- */

function mapOutcome(game, digestHex, roll, params) {
  switch (game) {
    case 'wheel': {
      const index = weightedIndex(roll, WHEEL_SEGMENTS.map((s) => s.weight));
      return { index, label: WHEEL_SEGMENTS[index].label };
    }
    case 'mines': {
      const mines = Number(params.mines) || 3;
      return { mines, bombs: minesBombsFromDigest(digestHex, mines) };
    }
    case 'case': {
      const weights =
        Array.isArray(params.weights) && params.weights.length
          ? params.weights
          : CASE_TIERS[params.tier] || CASE_TIERS.bronze;
      return { tier: params.tier || null, index: weightedIndex(roll, weights), weights };
    }
    case 'crash': {
      const houseEdge = Number.isFinite(params.houseEdge) ? params.houseEdge : 0.01;
      return { multiplier: crashPoint(roll, houseEdge), houseEdge };
    }
    case 'upgrade': {
      const chance = clampUpgradeChance(params.chance);
      return {
        chance,
        target: typeof params.target === 'string' ? params.target : null,
        win: roll < chance,
      };
    }
    default:
      throw new Error(`Unknown game: ${game}`);
  }
}

/** Does the revealed server seed hash to the committed value? */
export async function verifyCommitment(serverSeed, expectedHash) {
  if (!expectedHash) return null;
  return (await sha256Hex(serverSeed)) === String(expectedHash).toLowerCase();
}

/**
 * Verify a bet. Accepts an options object or positional args
 * (serverSeed, clientSeed, nonce, game, params).
 */
export async function verifyOutcome(a, b, c, d, e) {
  const opts =
    a && typeof a === 'object'
      ? a
      : { serverSeed: a, clientSeed: b, nonce: c, game: d, params: e || {} };

  const { serverSeed, clientSeed, nonce, game } = opts;
  const params = opts.params || {};

  if (!serverSeed || !clientSeed || nonce === undefined || !game) {
    throw new Error('verifyOutcome requires serverSeed, clientSeed, nonce and game');
  }

  const digest = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}`);
  const roll = rollFromHex(digest);
  const outcome = mapOutcome(game, digest, roll, params);
  const hash = await sha256Hex(serverSeed);

  return {
    game,
    nonce: Number(nonce),
    digest,
    roll,
    hash,
    hashMatches: opts.expectedHash ? hash === String(opts.expectedHash).toLowerCase() : null,
    outcome,
    outcomeMatches: opts.expectedOutcome
      ? JSON.stringify(outcome) === JSON.stringify(opts.expectedOutcome)
      : null,
  };
}

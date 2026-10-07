/* ============================================================================
   BLAZZER — seed manager
   Owns the per-user provably-fair state:

     serverSeed   : 32 random bytes (hex). ENCRYPTED at rest (AES-256-GCM) and
                    never returned until the user rotates.
     serverSeedHash: SHA-256(serverSeed). Shown up front as the commitment.
     clientSeed   : user-editable, defaults to 16 random bytes (hex).
     nonce        : increments once per bet; resets to 0 on rotation.

   The server seed is the only secret; everything else is public. Because the
   commitment is published before any bet, outcomes cannot be altered after the
   fact — the user re-hashes the revealed seed to prove it.
   ========================================================================= */

import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { fairStore } from './store.js';
import { AUDIT_ACTIONS, logFairEvent } from './audit.js';
import { generateOutcome, sha256Hex } from './outcome-generator.js';

/* --- Encryption key -------------------------------------------------------- */

const KEY_ENV = 'FAIR_ENCRYPTION_KEY';

function encryptionKey() {
  const raw = process.env[KEY_ENV];
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) {
      throw new Error(`${KEY_ENV} must decode to 32 bytes (hex or base64)`);
    }
    return buf;
  }
  if (config.isProd) {
    throw new Error(`${KEY_ENV} is required in production`);
  }
  // Dev fallback: derive a stable 32-byte key from the JWT secret.
  return crypto.createHash('sha256').update(`fair:${config.jwt.secret}`).digest();
}

/** Encrypt a secret with AES-256-GCM → "v1.<iv>.<tag>.<cipher>". */
export function encryptSecret(plaintext) {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), enc.toString('hex')].join('.');
}

/** Decrypt a payload produced by encryptSecret(). */
export function decryptSecret(payload) {
  const [version, ivHex, tagHex, dataHex] = String(payload).split('.');
  if (version !== 'v1') throw new Error('Unsupported encrypted seed format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

/* --- Seed generation -------------------------------------------------------- */

export const newServerSeed = () => crypto.randomBytes(32).toString('hex');
export const newClientSeed = () => crypto.randomBytes(16).toString('hex');
export const hashServerSeed = (serverSeed) => sha256Hex(serverSeed);

const CLIENT_SEED_RE = /^[\x20-\x7E]{1,64}$/;

/** Validate a user-supplied client seed. Returns a trimmed seed or throws. */
export function validateClientSeed(value) {
  const seed = String(value ?? '').trim();
  if (!CLIENT_SEED_RE.test(seed)) {
    throw Object.assign(new Error('Client seed must be 1–64 printable characters'), { status: 422 });
  }
  return seed;
}

/* --- State ------------------------------------------------------------------ */

async function loadOrInit(userId, ip = null) {
  let state = await fairStore().getSeed(userId);
  if (state) return state;

  const serverSeed = newServerSeed();
  state = {
    serverSeedEnc: encryptSecret(serverSeed),
    serverSeedHash: hashServerSeed(serverSeed),
    clientSeed: newClientSeed(),
    nonce: 0,
    createdAt: Date.now(),
    rotatedAt: null,
  };
  await fairStore().saveSeed(userId, state);
  await logFairEvent({ userId, action: AUDIT_ACTIONS.SEED_INIT, ip, meta: { serverSeedHash: state.serverSeedHash } });
  return state;
}

/** Public state safe to return to the client (no secret). */
export async function getSeedState(userId, ip = null) {
  const state = await loadOrInit(userId, ip);
  return {
    serverSeedHash: state.serverSeedHash,
    clientSeed: state.clientSeed,
    nonce: state.nonce,
    createdAt: state.createdAt,
    rotatedAt: state.rotatedAt,
  };
}

/** Internal: the decrypted server seed, for outcome generation only. */
export async function getServerSeed(userId) {
  const state = await loadOrInit(userId);
  return decryptSecret(state.serverSeedEnc);
}

export async function setClientSeed(userId, value, ip = null) {
  const seed = validateClientSeed(value);
  const state = await loadOrInit(userId, ip);
  state.clientSeed = seed;
  await fairStore().saveSeed(userId, state);
  await logFairEvent({ userId, action: AUDIT_ACTIONS.CLIENT_SEED, ip, meta: { clientSeed: seed } });
  return { serverSeedHash: state.serverSeedHash, clientSeed: seed, nonce: state.nonce };
}

/**
 * Rotate: reveal the old server seed, commit a fresh one, reset the nonce.
 * The reveal is what lets the user verify every past bet.
 */
export async function rotateSeed(userId, ip = null) {
  const state = await loadOrInit(userId, ip);
  const oldServerSeed = decryptSecret(state.serverSeedEnc);
  const oldHash = state.serverSeedHash;

  const freshSeed = newServerSeed();
  state.serverSeedEnc = encryptSecret(freshSeed);
  state.serverSeedHash = hashServerSeed(freshSeed);
  state.nonce = 0;
  state.rotatedAt = Date.now();

  // client seed is intentionally preserved across rotation.
  await fairStore().saveSeed(userId, state);
  await logFairEvent({
    userId,
    action: AUDIT_ACTIONS.SEED_ROTATE,
    ip,
    meta: { revealedHash: oldHash, newHash: state.serverSeedHash },
  });

  return {
    revealed: { serverSeed: oldServerSeed, serverSeedHash: oldHash },
    serverSeedHash: state.serverSeedHash,
    clientSeed: state.clientSeed,
    nonce: state.nonce,
  };
}

/**
 * Consume the next nonce and produce the deterministic outcome for a bet.
 * Rejects a nonce that is not exactly the expected next value (duplicate/lag).
 */
export async function consumeOutcome(userId, { game, params = {}, amount = 0, ip = null, nonce: expectedNonce = null }) {
  const state = await loadOrInit(userId, ip);

  if (expectedNonce !== null && Number(expectedNonce) !== state.nonce) {
    throw Object.assign(
      new Error(`Nonce mismatch: expected ${state.nonce}, received ${expectedNonce}`),
      { status: 409 }
    );
  }

  const serverSeed = decryptSecret(state.serverSeedEnc);
  const result = generateOutcome({
    game,
    serverSeed,
    clientSeed: state.clientSeed,
    nonce: state.nonce,
    params,
  });

  const bet = {
    id: `b_${randomUUID()}`,
    game,
    nonce: state.nonce,
    amount,
    serverSeedHash: state.serverSeedHash,
    clientSeed: state.clientSeed,
    params,
    outcome: result.outcome,
    digest: result.digest,
    createdAt: Date.now(),
  };

  state.nonce += 1;
  await fairStore().saveSeed(userId, state);
  await fairStore().appendBet(userId, bet);
  await logFairEvent({ userId, action: AUDIT_ACTIONS.BET, ip, meta: { game, nonce: bet.nonce, outcome: bet.outcome } });

  return { bet, serverSeedHash: state.serverSeedHash, clientSeed: state.clientSeed, nextNonce: state.nonce };
}

/** Paginated bet history for the History tab. */
export async function listBets(userId, { limit = 50, before = null } = {}) {
  const state = await loadOrInit(userId);
  const bets = await fairStore().listBets(userId, { limit, before });
  return { serverSeedHash: state.serverSeedHash, clientSeed: state.clientSeed, nonce: state.nonce, bets };
}

/** Server-side verification: does the seed reproduce the stored bet? */
export async function verifyWithServer(userId, { serverSeed, clientSeed, nonce, game, params = {} }) {
  const recomputedHash = hashServerSeed(serverSeed);
  const state = await loadOrInit(userId);

  let outcome = null;
  let error = null;
  try {
    outcome = generateOutcome({ game, serverSeed, clientSeed, nonce, params }).outcome;
  } catch (err) {
    error = err.message;
  }

  // Match against the recorded bet for that nonce, if we have one.
  const history = await fairStore().listBets(userId, { limit: 200 });
  const recorded = history.find((b) => b.nonce === Number(nonce) && b.game === game);
  const matchesRecorded = recorded && outcome ? JSON.stringify(recorded.outcome) === JSON.stringify(outcome) : null;

  await logFairEvent({
    userId,
    action: AUDIT_ACTIONS.VERIFY,
    meta: { game, nonce, hashMatchesCommitment: recomputedHash === state.serverSeedHash, matchesRecorded },
  });

  return {
    hashMatchesCurrentCommitment: recomputedHash === state.serverSeedHash,
    computedHash: recomputedHash,
    currentServerSeedHash: state.serverSeedHash,
    outcome,
    matchesRecorded,
    error,
  };
}


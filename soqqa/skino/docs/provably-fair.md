# BLAZZER — Provably Fair

Every BLAZZER outcome is decided **before** you place a bet, and you can prove
it yourself without trusting our servers. This document explains exactly how,
and gives you a script to run locally.

---

## The idea in one paragraph

Before your first bet we generate a secret **server seed**, keep it hidden, and
publish its **SHA-256 hash** — a commitment. You may set your own **client
seed**. Each bet increments a **nonce**. The result is derived from
`HMAC-SHA256(serverSeed, "clientSeed:nonce")`. Because the hash was published up
front, we cannot change the server seed without breaking the commitment. When
you **rotate**, we reveal the old server seed; you hash it and check it matches
the commitment, then recompute every past bet.

---

## The algorithm (exact, identical on client and server)

```
commitment = SHA-256(serverSeed)                 // hex, published before betting
digest     = HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`)   // 64 hex chars
roll       = uint32(digest[0..8]) / 2^32         // float in [0, 1)
outcome    = map(roll, game)
```

- `uint32(digest[0..8])` = the first 8 hex characters read as a big-endian
  unsigned 32-bit integer.
- `serverSeed` is 32 random bytes written as 64 hex chars (used as the HMAC key,
  UTF-8).
- `clientSeed` is 1–64 printable characters (default: 16 random bytes as hex).
- `nonce` starts at 0 and increments once per bet; it resets to 0 on rotation.

### Per-game mapping

| Game | Mapping |
| --- | --- |
| **Wheel** | Weighted pick: walk the segment weights subtracting from `roll × Σweights`. The 12 weights are `[4,4,4,3,3,2,1,0.5,0.2,0.15,0.06,0.02]`. |
| **Mines** | Partial Fisher–Yates over `[0..24]`, taking the first *mines* positions, using the digest bytes as the randomness: `j = i + bytes[i] % (25 − i)`. Bombs are returned sorted. |
| **Case** | Weighted pick over the tier's prize weights (bronze `[34,26,16,6,18]`, silver `[30,24,14,6,26]`, gold `[28,22,14,6,30]`, neon `[26,22,14,6,30]`). |
| **Crash** | Inverse-CDF with a 1% house edge: bust at 1.00× when `roll < 0.01`, otherwise `floor(100 / (1 − r)) / 100` where `r = (roll − 0.01) / 0.99`. |

The reference implementations are:
- server: `server/fair/outcome-generator.js`
- client (offline): `js/fair-verify.js`

They **must** be changed together.

---

## Endpoints

All require a Bearer JWT (mint one at `GET /api/live/token`) and are
rate-limited.

| Method | Path | Limit | Purpose |
| --- | --- | --- | --- |
| GET | `/api/fair/seeds` | 120/min | current commitment, client seed, nonce |
| POST | `/api/fair/client-seed` | 5/min | set your client seed |
| POST | `/api/fair/rotate` | 1/min | reveal old seed, commit a new one |
| GET | `/api/fair/history` | 120/min | past bets with proofs (paged) |
| POST | `/api/fair/verify` | 120/min | server-side verification |
| POST | `/api/fair/outcome` | 120/min | consume the next nonce → outcome (game integration) |

---

## Verify a bet (copy-paste, no dependencies)

Save as `verify.mjs` and run `node verify.mjs`:

```js
import crypto from 'node:crypto';

const serverSeed = process.argv[2]; // revealed seed (64 hex)
const clientSeed = process.argv[3]; // your client seed
const nonce = Number(process.argv[4]); // bet nonce
const game = process.argv[5] || 'wheel'; // wheel | mines | case | crash

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (k, m) => crypto.createHmac('sha256', k).update(m, 'utf8').digest('hex');

const WHEEL_WEIGHTS = [4, 4, 4, 3, 3, 2, 1, 0.5, 0.2, 0.15, 0.06, 0.02];

function weightedIndex(roll, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let t = roll * total;
  for (let i = 0; i < weights.length; i += 1) if ((t -= weights[i]) < 0) return i;
  return weights.length - 1;
}

function minesBombs(digestHex, mines, size = 25) {
  const bytes = Buffer.from(digestHex, 'hex');
  const a = Array.from({ length: size }, (_, i) => i);
  for (let i = 0; i < mines; i += 1) {
    const j = i + (bytes[i % bytes.length] % (size - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, mines).sort((x, y) => x - y);
}

const digest = hmac(serverSeed, `${clientSeed}:${nonce}`);
const roll = Number.parseInt(digest.slice(0, 8), 16) / 4294967296;

let outcome;
if (game === 'wheel') {
  const i = weightedIndex(roll, WHEEL_WEIGHTS);
  outcome = { index: i };
} else if (game === 'mines') {
  outcome = { bombs: minesBombs(digest, 3) };
} else if (game === 'case') {
  outcome = { index: weightedIndex(roll, [34, 26, 16, 6, 18]) };
} else {
  outcome = { multiplier: roll < 0.01 ? 1 : Math.floor(100 / (1 - (roll - 0.01) / 0.99)) / 100 };
}

console.log('commitment check:', sha256(serverSeed));
console.log('digest          :', digest);
console.log('roll            :', roll.toFixed(10));
console.log('outcome         :', outcome);
```

Compare `commitment check` with the hash the site showed you **before** the bet.
If they match and the outcome matches what you saw, the bet is proven fair.

---

## Security & operations

- Server seeds are encrypted at rest with **AES-256-GCM** (`FAIR_ENCRYPTION_KEY`,
  32 bytes). The plaintext is never returned until you rotate.
- Rotation is limited to **once per 60 seconds**; client-seed edits to **5 per
  minute**.
- Every seed init, rotation, client-seed change, bet and verification is written
  to an **audit trail** (user, action, IP, time).
- A nonce can only be consumed in order — a duplicate or out-of-order nonce is
  rejected with a `409` and a clear message.
- Multiple open tabs stay in sync via a `BroadcastChannel`; the nonce advances
  server-side regardless, so a stale tab can never reuse a nonce.
- Rotating mid-session is safe: the bet already in flight used the old seed,
  and the next bet uses the new one.

## Persistence

- With Postgres enabled the fair models (`fair_seeds`, `fair_bets`,
  `fair_audits`) hold everything.
- Otherwise the subsystem writes an atomic JSON file at
  `server/fair/data/fair.json` (git-ignored) — seeds still survive restarts.

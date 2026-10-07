/* ============================================================================
   BLAZZER — live feed simulator
   Fires synthetic drops at the ingest endpoint so the feed can be tested under
   load (defaults to ~100 drops/sec). Usage:

     LIVE_SERVICE_KEY=dev-service-key npm run simulate
     SIM_RATE=500 node server/scripts/simulate.js

   Requires the server to be running. Ends cleanly on Ctrl+C.
   ========================================================================= */

import { config } from '../config.js';

const endpoint =
  process.env.SIM_URL || `http://127.0.0.1:${config.port}/api/live/drop`;
const serviceKey = process.env.LIVE_SERVICE_KEY || 'dev-service-key';
const rate = Math.max(1, Number.parseInt(process.env.SIM_RATE || '100', 10));
const TICK_MS = 100;
const PER_TICK = Math.max(1, Math.round((rate * TICK_MS) / 1000));

const NAMES = ['Aztec', 'Nova', 'Vortex', 'Krypt', 'Mako', 'Riven', 'Zephyr', 'Onyx'];
const WEAPONS = ['AK-47', 'AWP', 'M4A4', 'Desert Eagle', 'USP-S', 'Glock-18'];
const FINISHES = ['Slate', 'Blaze', 'Asiimov', 'Neon Rider', 'Hyper Beast', 'Printstream'];
const RARITIES = ['Mil-Spec', 'Restricted', 'Classified', 'Covert', 'Contraband'];
const GRADIENTS = [
  'linear-gradient(135deg,#5ed2e2,#1f7d92)',
  'linear-gradient(135deg,#a98cf0,#4b2fa0)',
  'linear-gradient(135deg,#e8c56a,#8a6a1f)',
  'linear-gradient(135deg,#e08a8a,#8a2f2f)',
];
const SOURCES = ['wheel', 'mines', 'case', 'crash', 'trade'];
const CATEGORIES = ['skin', 'case', 'crypto'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Occasionally emit a large win so the big/huge-win paths get exercised. */
function value() {
  const roll = Math.random();
  if (roll > 0.995) return 100_000 + Math.floor(Math.random() * 100_000); // huge
  if (roll > 0.97) return 10_000 + Math.floor(Math.random() * 40_000); // big
  return 25 + Math.floor(Math.random() * 2_000);
}

function randomDrop() {
  const category = pick(CATEGORIES);
  return {
    userId: `sim_${Math.floor(Math.random() * 200)}`,
    username: `${pick(NAMES)}${Math.floor(Math.random() * 90)}`,
    item: {
      id: `it_${Math.floor(Math.random() * 1000)}`,
      name: `${pick(WEAPONS)} | ${pick(FINISHES)}`,
      rarity: pick(RARITIES),
      gradient: pick(GRADIENTS),
      category,
    },
    value: value(),
    source: pick(SOURCES),
    currency: 'CRYSTALS',
  };
}

let sent = 0;
let failed = 0;

async function tick() {
  const batch = Array.from({ length: PER_TICK }, randomDrop);
  await Promise.all(
    batch.map(async (drop) => {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-service-key': serviceKey },
          body: JSON.stringify(drop),
        });
        if (res.ok) sent += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    })
  );
}

const timer = setInterval(tick, TICK_MS);

const report = setInterval(() => {
  console.log(`[simulate] sent=${sent} failed=${failed} (~${rate}/s target)`);
}, 2_000);
report.unref?.();

console.log(`[simulate] targeting ${endpoint} at ~${rate} drops/sec. Ctrl+C to stop.`);

function stop() {
  clearInterval(timer);
  clearInterval(report);
  console.log(`\n[simulate] stopped. sent=${sent} failed=${failed}`);
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

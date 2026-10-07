/* ============================================================================
   BLAZZER — drop ingest pipeline
   Takes a raw drop from a game service, applies anti-spam policy, merges rapid
   drops per user, persists to the store and broadcasts to every socket node.
   This is the only place a drop becomes visible to the public feed.
   ========================================================================= */

import { config } from '../config.js';
import { bus, TOPICS } from '../broadcast.js';
import { dropsStore, dayKey } from '../store/dropsStore.js';
import { bumpDailyStat } from '../store/db.js';
import { DropThrottle } from '../throttle.js';
import { normalizeDrop } from './normalize.js';

/* The throttle needs a publish target; build the pipeline around it. */
const throttle = new DropThrottle(publishDrop);

/** Anti-spam policy — returns a reason string when a drop must be suppressed. */
function suppressionReason(drop) {
  if (drop.isBot) return 'bot';
  if (config.live.excludedUserIds.includes(drop.userId)) return 'excluded';
  if (drop.value <= 0 && drop.category !== 'skin') return 'zero-value';
  return null;
}

/** Persist, aggregate and fan out a drop (throttle target).
 *  Never throws: a storage hiccup must not crash the process. */
async function publishDrop(drop) {
  try {
    await dropsStore.add(drop);
    const stats = await dropsStore.bump(drop);
    await bumpDailyStat({ date: dayKey(drop.timestamp), value: drop.value });
    bus.publish(TOPICS.DROP, drop);
    bus.publish(TOPICS.STATS, stats);
  } catch (err) {
    console.warn('[ingest] publish failed:', err.message);
  }
}

/**
 * @param {unknown} raw
 * @returns {Promise<{ok:boolean, status?:number, errors?:string[], skipped?:string, drop?:object}>}
 */
export async function ingestDrop(raw) {
  const normalized = normalizeDrop(raw);
  if (!normalized.ok) {
    return { ok: false, status: 422, errors: normalized.errors };
  }

  const reason = suppressionReason(normalized.drop);
  if (reason) {
    return { ok: false, status: 202, skipped: reason };
  }

  throttle.push(normalized.drop);
  return { ok: true, drop: normalized.drop };
}

/** Flush and cancel all pending merges (shutdown). */
export function stopIngest() {
  throttle.stop();
}

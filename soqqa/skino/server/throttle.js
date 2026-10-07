/* ============================================================================
   BLAZZER — drop throttle
   Merges rapid drops from the same user so the feed never floods (at most one
   broadcast per user per window), while headline wins cut straight through.
   Timers are unref'd and cleared on stop(), so the process can exit cleanly.
   ========================================================================= */

import { config } from './config.js';

export class DropThrottle {
  constructor(publish, options = {}) {
    this.publish = publish;
    this.windowMs = options.windowMs ?? config.live.mergeWindowMs;
    this.bigWin = options.bigWin ?? config.live.bigWin;
    this.pending = new Map(); // userId -> { drop, timer }
  }

  /** Queue a drop: immediate for big wins, merged within the window otherwise. */
  push(drop) {
    if (drop.value >= this.bigWin) {
      this.flush(drop.userId); // flush any earlier small drop first
      this.publish(drop);
      return;
    }

    const existing = this.pending.get(drop.userId);
    if (existing) {
      existing.drop = mergeDrops(existing.drop, drop);
      return; // timer already scheduled
    }

    const record = { drop, timer: null };
    record.timer = setTimeout(() => {
      this.pending.delete(drop.userId);
      this.publish(record.drop);
    }, this.windowMs);
    record.timer.unref?.();
    this.pending.set(drop.userId, record);
  }

  /** Immediately emit a user's buffered drop, if any. */
  flush(userId) {
    const entry = this.pending.get(userId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(userId);
    this.publish(entry.drop);
  }

  /** Cancel every pending timer (shutdown). */
  stop() {
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
  }
}

function mergeDrops(first, next) {
  return {
    ...next,
    value: first.value + next.value,
    mergedCount: (first.mergedCount || 1) + 1,
    timestamp: next.timestamp,
  };
}

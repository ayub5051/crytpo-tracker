/* ============================================================================
   BLAZZER — drops store
   The live feed's data layer. Recent drops live in a capped Redis list (so a
   page refresh can replay them); daily totals live in a Redis hash. Without
   Redis both degrade to in-process structures with identical semantics, so the
   server runs anywhere.
   ========================================================================= */

import { config } from '../config.js';

const KEY_RECENT = 'blazzer:drops:recent';
const STATS_TTL_SECONDS = 3 * 24 * 60 * 60;
const statsKey = (date) => `blazzer:stats:${date}`;

/** Local calendar day key (UTC) — used to bucket daily aggregates. */
export function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function emptyStats(date = dayKey()) {
  return { date, totalValue: 0, count: 0, byCategory: {}, bySource: {} };
}

class DropsStore {
  constructor() {
    this.redis = null;
    this.memory = []; // newest-first
    this.daily = emptyStats();
  }

  attachRedis(redis) {
    this.redis = redis;
  }

  get backing() {
    return this.redis ? 'redis' : 'memory';
  }

  /** Append a drop, trimming to the configured ring-buffer size. */
  async add(drop) {
    if (this.redis) {
      await this.redis
        .multi()
        .lpush(KEY_RECENT, JSON.stringify(drop))
        .ltrim(KEY_RECENT, 0, config.live.keepLast - 1)
        .exec();
      return;
    }
    this.memory.unshift(drop);
    if (this.memory.length > config.live.keepLast) {
      this.memory.length = config.live.keepLast;
    }
  }

  /** Newest-first slice of recent drops. */
  async recent(limit = 30) {
    const n = Math.max(1, Math.min(Math.trunc(limit) || 30, config.live.keepLast));
    if (this.redis) {
      const rows = await this.redis.lrange(KEY_RECENT, 0, n - 1);
      return rows
        .map((row) => {
          try {
            return JSON.parse(row);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }
    return this.memory.slice(0, n);
  }

  /** Fold a drop into today's aggregate and return the fresh totals. */
  async bump(drop) {
    const date = dayKey(drop.timestamp);
    if (this.redis) {
      const key = statsKey(date);
      await this.redis
        .multi()
        .hincrby(key, 'totalValue', drop.value)
        .hincrby(key, 'count', 1)
        .hincrby(key, `cat:${drop.category}`, drop.value)
        .hincrby(key, `src:${drop.source}`, 1)
        .expire(key, STATS_TTL_SECONDS)
        .exec();
      return this.stats(date);
    }

    if (this.daily.date !== date) this.daily = emptyStats(date);
    this.daily.totalValue += drop.value;
    this.daily.count += 1;
    this.daily.byCategory[drop.category] =
      (this.daily.byCategory[drop.category] || 0) + drop.value;
    this.daily.bySource[drop.source] = (this.daily.bySource[drop.source] || 0) + 1;
    return { ...this.daily };
  }

  async stats(date = dayKey()) {
    if (this.redis) {
      const raw = await this.redis.hgetall(statsKey(date));
      const out = emptyStats(date);
      out.count = Number(raw.count || 0);
      out.totalValue = Number(raw.totalValue || 0);
      for (const [field, value] of Object.entries(raw)) {
        if (field.startsWith('cat:')) out.byCategory[field.slice(4)] = Number(value);
        else if (field.startsWith('src:')) out.bySource[field.slice(4)] = Number(value);
      }
      return out;
    }
    if (this.daily.date !== date) return emptyStats(date);
    return { ...this.daily };
  }

  /**
   * Drop anything older than the retention window. The ring buffer already caps
   * volume; this keeps the time window honest even under bursts.
   */
  async cleanup(now = Date.now()) {
    const cutoff = now - config.live.retentionMs;
    if (this.redis) {
      const rows = await this.redis.lrange(KEY_RECENT, 0, -1);
      const fresh = rows.filter((row) => {
        try {
          return (JSON.parse(row).timestamp || 0) >= cutoff;
        } catch {
          return false;
        }
      });
      if (fresh.length !== rows.length) {
        const pipeline = this.redis.multi();
        pipeline.del(KEY_RECENT);
        if (fresh.length) pipeline.rpush(KEY_RECENT, ...fresh);
        await pipeline.exec();
      }
      return rows.length - fresh.length;
    }
    const before = this.memory.length;
    this.memory = this.memory.filter((drop) => (drop.timestamp || 0) >= cutoff);
    return before - this.memory.length;
  }
}

export const dropsStore = new DropsStore();

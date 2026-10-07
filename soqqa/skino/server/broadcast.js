/* ============================================================================
   BLAZZER — broadcast bus
   A tiny publish/subscribe layer. On one node it is an in-process EventEmitter;
   when Redis is configured it relays through a channel so every WebSocket node
   sees every drop. Consumers receive `(payload)` per subscribed topic.
   ========================================================================= */

import { EventEmitter } from 'node:events';
import { config } from './config.js';

const CHANNEL = 'blazzer:live';

export const TOPICS = {
  DROP: 'drop',
  STATS: 'stats',
  ONLINE: 'online',
};

class Bus {
  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0); // one listener per connected socket
    this.pub = null;
    this.sub = null;
  }

  /**
   * Optionally upgrade to Redis pub/sub. `redisFactory` must return a fresh
   * client so pub and sub do not share a connection.
   */
  async connect(redisFactory) {
    if (!config.redis.url || !redisFactory) return false;
    try {
      const pub = redisFactory();
      const sub = redisFactory();
      await sub.subscribe(CHANNEL);
      sub.on('message', (_channel, message) => {
        try {
          const envelope = JSON.parse(message);
          this.emitter.emit(envelope.topic, envelope.payload);
        } catch {
          /* ignore malformed frames */
        }
      });
      this.pub = pub;
      this.sub = sub;
      console.log('[bus] redis pub/sub connected');
      return true;
    } catch (err) {
      console.warn('[bus] redis pub/sub unavailable, staying in-process:', err.message);
      this.pub = null;
      this.sub = null;
      return false;
    }
  }

  publish(topic, payload) {
    // With Redis, publish only — the subscriber (a separate connection) echoes
    // it back to this node too, so emitting locally as well would double up.
    if (this.pub) {
      this.pub.publish(CHANNEL, JSON.stringify({ topic, payload })).catch((err) => {
        console.warn('[bus] publish failed:', err.message);
      });
      return;
    }
    this.emitter.emit(topic, payload);
  }

  /** Subscribe to a topic; returns an unsubscribe function. */
  on(topic, handler) {
    this.emitter.on(topic, handler);
    return () => this.emitter.off(topic, handler);
  }

  async close() {
    try {
      await this.sub?.quit();
    } catch {
      /* already closed */
    }
    try {
      await this.pub?.quit();
    } catch {
      /* already closed */
    }
    this.sub = null;
    this.pub = null;
    this.emitter.removeAllListeners();
  }
}

export const bus = new Bus();

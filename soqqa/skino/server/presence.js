/* ============================================================================
   BLAZZER — presence
   Tracks live WebSocket connections so the feed can show an online count. Kept
   in-process (accurate per node); a Redis-backed counter is the natural next
   step once the socket tier runs on more than one node.
   ========================================================================= */

import { config } from './config.js';

class Presence {
  constructor() {
    this.connections = new Map(); // connectionId -> meta
    this.baseline = config.live.onlineBase;
  }

  add(id, meta = {}) {
    this.connections.set(id, { ...meta, at: Date.now() });
  }

  remove(id) {
    this.connections.delete(id);
  }

  /** Real socket count on this node. */
  count() {
    return this.connections.size;
  }

  /** Figure shown in the UI: real count plus the configured demo baseline. */
  display() {
    return Math.max(1, this.count() + this.baseline);
  }

  clear() {
    this.connections.clear();
  }
}

export const presence = new Presence();

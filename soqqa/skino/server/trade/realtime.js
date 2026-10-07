/* ============================================================================
   BLAZZER — trade realtime (Stage 3.3)
   Reuses the Stage 1 WebSocket tier: when a trade changes we push a compact
   frame to just the two parties' sockets, so the open trade page updates
   without a refresh (< 200ms on a warm connection).

   The live socket records its user via presence (connectionId -> { userId });
   we read that map rather than editing the Stage 1 socket code. Until
   attachTradeRealtime() runs, publishTradeChange() is a no-op — so the trade
   manager never depends on the socket tier being up.
   ========================================================================= */

import { presence } from '../presence.js';

const MAX_BUFFERED_BYTES = 1 * 1024 * 1024;

let wss = null;

/** Called once at boot with the live WebSocket server. */
export function attachTradeRealtime(liveWss) {
  wss = liveWss || null;
  return { detach: () => { wss = null; } };
}

/** The public shape a socket receives — never the whole trade object graph. */
function frame(trade, event) {
  return {
    type: 'trade',
    event, // created | updated | confirmed | ready | completed | cancelled | expired
    tradeId: trade.id,
    status: trade.status,
    initiatorId: trade.initiatorId,
    receiverId: trade.receiverId,
    initiatorConfirmed: Boolean(trade.initiatorConfirmed),
    receiverConfirmed: Boolean(trade.receiverConfirmed),
    initiatorFinalConfirmed: Boolean(trade.initiatorFinalConfirmed),
    receiverFinalConfirmed: Boolean(trade.receiverFinalConfirmed),
    initiatorCount: Array.isArray(trade.initiatorItems) ? trade.initiatorItems.length : 0,
    receiverCount: Array.isArray(trade.receiverItems) ? trade.receiverItems.length : 0,
    at: Date.now(),
  };
}

/**
 * Push a trade change to its two parties. Best-effort: never throws into a
 * request path.
 *
 * @param {object} trade
 * @param {string} [event]
 */
export function publishTradeChange(trade, event = 'updated') {
  if (!wss || !trade) return;
  const parties = new Set([trade.initiatorId, trade.receiverId].filter(Boolean));
  const payload = JSON.stringify(frame(trade, event));
  for (const socket of wss.clients) {
    try {
      if (socket.readyState !== 1) continue; // OPEN
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) continue; // shed load
      const userId = presence.connections.get(socket.connectionId)?.userId;
      if (!parties.has(userId)) continue;
      socket.send(payload);
    } catch {
      /* socket died between the check and the send */
    }
  }
}

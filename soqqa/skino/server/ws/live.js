/* ============================================================================
   BLAZZER — live WebSocket server
   Attaches a `ws` server to the HTTP server at `/live`. Each socket
   authenticates with a JWT in the handshake, receives a hello snapshot
   (recent drops + stats), then streams every broadcast drop. A heartbeat
   prunes dead sockets and backpressure guards keep memory flat under load.
   ========================================================================= */

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { tokenFromUpgrade, verifyToken } from '../auth.js';
import { bus, TOPICS } from '../broadcast.js';
import { presence } from '../presence.js';
import { dropsStore } from '../store/dropsStore.js';
import { createTokenBucket } from '../rateLimit.js';

const HEARTBEAT_MS = 30_000;
const MAX_PAYLOAD_BYTES = 4 * 1024;
const MAX_BUFFERED_BYTES = 1 * 1024 * 1024; // ~1 MB of unflushed frames -> skip
const SNAPSHOT_SIZE = 30;

/** Send JSON unless the socket is gone or falling behind. */
function send(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return; // shed load, stay 60fps
  try {
    socket.send(JSON.stringify(message));
  } catch {
    /* socket died between the check and the send */
  }
}

function closeWith(socket, code, reason) {
  try {
    socket.close(code, reason);
  } catch {
    socket.terminate();
  }
}

export function attachLiveSocket(server) {
  const wss = new WebSocketServer({
    server,
    path: config.live.path,
    maxPayload: MAX_PAYLOAD_BYTES,
    clientTracking: true,
  });

  wss.on('connection', async (socket, req) => {
    // --- Authenticate the handshake -----------------------------------------
    const rawToken = tokenFromUpgrade(req);
    let claims;
    try {
      if (!rawToken) throw new Error('missing token');
      claims = verifyToken(rawToken);
    } catch {
      closeWith(socket, 4401, 'Unauthorized');
      return;
    }

    const connectionId = randomUUID();
    socket.isAlive = true;
    socket.connectionId = connectionId;
    const takeMessage = createTokenBucket({ rate: 8, burst: 16 });

    presence.add(connectionId, { userId: claims.sub });
    broadcastOnline();

    // --- Hello: replay recent activity so the panel is never empty ----------
    try {
      const [drops, stats] = await Promise.all([dropsStore.recent(SNAPSHOT_SIZE), dropsStore.stats()]);
      send(socket, {
        type: 'hello',
        uid: connectionId,
        drops,
        stats: { ...stats, online: presence.display() },
      });
    } catch (err) {
      console.warn('[ws] hello snapshot failed:', err.message);
      send(socket, { type: 'hello', drops: [], stats: { online: presence.display() } });
    }

    // --- Live fan-out --------------------------------------------------------
    const unsubscribe = [
      // Flattened to the agreed contract: { type:'drop', ...dropFields }.
      bus.on(TOPICS.DROP, (drop) => send(socket, { type: 'drop', ...drop })),
      bus.on(TOPICS.STATS, (stats) => send(socket, { type: 'stats', stats })),
      bus.on(TOPICS.ONLINE, (payload) => send(socket, { type: 'online', online: payload.online })),
    ];

    // --- Inbound (client keepalive) -----------------------------------------
    socket.on('message', (raw) => {
      if (!takeMessage(1)) return; // per-connection message budget
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message?.type === 'ping') {
        send(socket, { type: 'pong', t: Date.now() });
      }
    });

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('error', () => {
      /* handled by close */
    });

    socket.on('close', () => {
      unsubscribe.forEach((off) => off());
      presence.remove(connectionId);
      broadcastOnline();
    });
  });

  // Heartbeat: drop sockets that missed a full cycle.
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    wss,
    close() {
      clearInterval(heartbeat);
      for (const socket of wss.clients) {
        closeWith(socket, 1001, 'Server shutting down');
      }
      wss.close();
    },
  };
}

function broadcastOnline() {
  bus.publish(TOPICS.ONLINE, { online: presence.display() });
}

/* ============================================================================
   BLAZZER — trade realtime (client, Stage 3.3)
   Subscribes to the Stage 1 WebSocket (`/live`) and filters for the compact
   `{ type: 'trade', tradeId }` frames, so an open trade page updates the moment
   the other side adds an item or confirms — no refresh.

   Best-effort by design: with no server (the local-first demo) it quietly does
   nothing. Every socket and timer is torn down by close().
   ========================================================================= */

const WS_PATH = '/live';
const RECONNECT_BASE = 800;
const RECONNECT_MAX = 15_000;

function wsUrlFor(token) {
  const override = window.BLAZZER_TRADE?.url || window.BLAZZER_LIVE?.url;
  if (override) return `${String(override).replace(/\/$/, '')}${WS_PATH}?token=${encodeURIComponent(token)}`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${WS_PATH}?token=${encodeURIComponent(token)}`;
}

async function fetchToken() {
  try {
    const res = await fetch('/api/live/token', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.token || null;
  } catch {
    return null;
  }
}

/**
 * @param {{tradeId:string, onMessage?:(frame:object)=>void}} options
 * @returns {{close:()=>void}}
 */
export function connectTradeRealtime({ tradeId, onMessage } = {}) {
  // No host and no explicit URL means the demo is running without a server.
  if (!location.host && !window.BLAZZER_TRADE?.url && !window.BLAZZER_LIVE?.url) {
    return { close() {} };
  }

  let socket = null;
  let timer = 0;
  let retries = 0;
  let closed = false;

  async function open() {
    if (closed) return;
    const token = window.BLAZZER_TRADE?.token || (await fetchToken());
    if (!token || closed) return;

    try {
      socket = new WebSocket(wsUrlFor(token));
    } catch {
      schedule();
      return;
    }

    socket.addEventListener('open', () => {
      retries = 0;
    });

    socket.addEventListener('message', (event) => {
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (frame?.type !== 'trade') return;
      if (tradeId && frame.tradeId && frame.tradeId !== tradeId) return;
      onMessage?.(frame);
    });

    socket.addEventListener('close', () => {
      socket = null;
      schedule();
    });

    socket.addEventListener('error', () => {
      try {
        socket?.close();
      } catch {
        /* already closing */
      }
    });
  }

  function schedule() {
    if (closed || timer) return;
    const delay = Math.min(RECONNECT_MAX, RECONNECT_BASE * 1.7 ** retries);
    retries += 1;
    timer = window.setTimeout(() => {
      timer = 0;
      open();
    }, delay + delay * 0.2 * Math.random());
  }

  open();

  return {
    close() {
      closed = true;
      if (timer) window.clearTimeout(timer);
      timer = 0;
      try {
        socket?.close();
      } catch {
        /* already closing */
      }
      socket = null;
    },
  };
}

# BLAZZER — Live Drops Feed (Stage 1)

Real-time activity rail showing what players are winning right now. Express +
native `ws` + optional Redis/Postgres, serving the static client from the same
origin.

Everything is **optional except Node**: with neither Redis nor Postgres the feed
runs on in-process stores (single node), which is perfect for local development.

## Layout

```
skino/
  package.json                 server deps + scripts (ESM)
  .env.example                 every env var, documented
  server/
    index.js                   entry: Express + static + WS + lifecycle
    config.js                  env-driven config
    auth.js                    JWT issue/verify, WS handshake token
    util.js                    masking, sanitizing, identicons
    broadcast.js               pub/sub bus (in-process | Redis)
    presence.js                online connection count
    rateLimit.js               HTTP limiters + WS token bucket
    throttle.js                per-user drop merge
    live/
      normalize.js             validate + sanitize + enrich a drop
      ingest.js                anti-spam -> merge -> persist -> broadcast
    store/
      dropsStore.js            recent ring buffer + daily stats (Redis|memory)
      db.js                    optional Prisma/Postgres aggregates
    ws/live.js                 WebSocket server (/live)
    api/drops.js               REST routes
    scripts/simulate.js        synthetic drop generator (load test)
    prisma/schema.prisma       DailyStat model
  js/live-feed.js              client panel + socket logic
  css/live-feed.css            styles + animations
```

## Setup

```bash
cd skino
cp .env.example .env
npm install

# development (no Redis / Postgres needed)
npm run dev                       # http://localhost:8787

# optional: enable Postgres daily aggregates
npx prisma migrate dev --name init
npx prisma generate
# then set DATABASE_ENABLED=true and DATABASE_URL=... in .env

# optional: enable Redis (recent drops + multi-node pub/sub)
# set REDIS_URL=redis://127.0.0.1:6379

# load test the feed
LIVE_SERVICE_KEY=your-key SIM_RATE=200 npm run simulate
```

## REST

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | — | liveness + backing stores |
| GET | `/api/live/token` | — | mint WS handshake JWT (rate-limited) |
| GET | `/api/live/drops?filter=&limit=` | — | snapshot (REST fallback) |
| GET | `/api/live/stats` | — | today's totals + online |
| POST | `/api/live/drop` | `x-service-key` | internal ingestion |

## WebSocket (`/live`)

Connect with `?token=<jwt>`. Messages (server → client):

| type | payload |
| --- | --- |
| `hello` | `{ drops, stats }` snapshot on connect |
| `drop` | `{ drop }` a new win |
| `stats` | today's totals after each drop |
| `online` | connection count changes |
| `pong` | reply to client `{type:'ping'}` |

Server pings every 30s and terminates sockets that miss a cycle.

## Anti-spam

- Bots and configured `LIVE_EXCLUDED_USERS` never reach the feed.
- Drops merge per user within `LIVE_MERGE_MS` (default 2s); wins ≥ `LIVE_BIG_WIN`
  bypass the merge.
- Per-connection message budget (token bucket) plus HTTP limits on every route.
- Usernames are masked (`Az***77`) before broadcast.

## Scaling notes

- Redis pub/sub fans drops across nodes; each node relays to its own sockets.
- `presence` is per-node today; swap for a Redis `SCARD` counter when the socket
  tier runs multi-node.
- `dropsStore` is the only component holding recent state; make it Redis-backed
  in production so any node can serve a snapshot.

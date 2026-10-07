# BLAZZER — Inventory & Trading

Everything you own lives in one place: the **Inventory**. This document explains
how items work, how they are valued, and what the market, trading, upgrade and
gift tools do around them.

> Status: **Stage 3.1 (inventory)**, **Stage 3.2 (marketplace)** and
> **Stage 3.3 (trading)** are live. Upgrade and gift arrive in later
> sub-stages; their buttons say so when tapped.

---

## What an item is

Every skin you win or buy is a real, individual **item instance** — not an
anonymous counter. Two copies of the same skin are two separate items. Each one
remembers:

| Field | Meaning |
|---|---|
| `uid` | a unique id for that physical item |
| `id` | which skin it is (e.g. `ak-47-slate`) |
| `obtainedAt` | when you got it |
| `obtainedVia` | how: `wheel`, `mines`, `case`, `trade`, `gift`, `purchase` |
| `stattrak` | whether it counts kills (StatTrak™) |
| `floatValue` | optional wear float, shown to six decimals |
| `stickers` | up to five applied stickers, each with a slot |
| `isListed` / `price` | whether it is on the market, and for how much |
| `tradeLocked` / `tradeLockedUntil` | 7-day anti-fraud lock after receiving it |

Because each copy is distinct, stickers, wear and lock state are always
truthful — you can list one copy and keep another.

---

## The inventory screen

- **Top bar** — total inventory value (counts up on load), a 7-day trend
  (`↑ 5% this week`), and your item count.
- **Search + sort** — search by weapon or finish; sort by newest, price, rarity
  or weapon.
- **Filters** — rarity (coloured chips), weapon category, wear, StatTrak only,
  Stickers only.
- **Bulk select** — turn it on, tap cards, then **Sell Selected**. Bulk selling
  pays the buy-back rate (70% of catalogue value).
- **Item detail** — tap any card (outside bulk mode) for the full record: wear,
  float, provenance, stickers (with remove), and actions.
- **Sell** — opens the marketplace listing modal (see below).

---

## The marketplace

The Market view is a live secondary market. Each card shows the skin, its price,
the seller (an identicon, a username and a 1–5 star rating), plus a
**Just listed** badge (under 30 minutes old) or an amber **Ends in …** badge when
the listing expires within eight hours.

### Buying

1. Tap a listing → the detail modal (metadata, wear, float, seller, price).
2. **Buy** → a confirmation showing the price and your balance **after**.
3. Confirm → the sale settles atomically: the item lands in your inventory and
   the balance ticks down, with the shared purchase celebration.

A purchase is guarded by an **idempotency key**, so a retried request can never
charge twice. If the listing was cancelled, expired or already sold while you
were looking, you get a clear "no longer available" message and no partial
state.

### Selling

1. Inventory → **Sell** (or My listings → **Edit price**).
2. Pick a price — a suggested band from recent comparable sales is shown, plus
   `−10% / −5% / Suggested / +5% / +10%` shortcuts.
3. Choose a duration: **1h / 6h / 24h / 3d / 7d** (default 24h).
4. The fee preview spells out exactly what you take home.

The platform keeps a **7% commission** on every sale:

```
buyer pays      listing.price
platform fee    round(listing.price * 0.07)
seller receives listing.price - fee
```

The fee is credited to a tracked system account.

### My listings

The **My listings** button opens a panel of your active listings, each with a
live expiry countdown and **Edit price** / **Cancel listing** actions. Cancelling
returns the item to your inventory.

### Filters

The filter drawer (sidebar on desktop, bottom sheet on mobile) covers price
range, rarity, weapon category, wear, StatTrak-only and a minimum seller rating.
Filters apply instantly (debounced 200 ms), are reflected in the URL so a
filtered view is shareable, and persist across reloads.

---

## How items are valued

Values are the catalogue price in **Crystals** (◆), the single in-app currency.

- **Buy-back (selling to the house):** 70% of catalogue value.
- **Market sales:** priced by the seller, from a suggested band derived from
  recent comparable sales, minus the **7% commission**.

The floor, ceiling and commission are enforced server-side (`server/market/`)
so a crafted client cannot list or buy outside the rules.

---

## Provenance & provably-fair

Items you win have a provenance tag (`How I got this` in the detail modal). That
links to the **Provably Fair** panel, where you can verify the seeds behind the
spin that produced the item. See `docs/provably-fair.md`.

Every item movement is also written to an append-only **transfer audit** on the
server (grant, remove, sell, buy, trade, gift, upgrade) so double-spends are
provably impossible and disputes are answerable. Market purchases add a `buy`
entry, with the listing id, price, fee and payout in the metadata.

---

## Architecture

The demo is **local-first**: LocalStorage is authoritative so the market works
with no server. When `window.BLAZZER_MARKET.sync === true` the client mirrors
each action to the API; a missing server never breaks the UI.

Server surfaces (`server/market/`):

| Endpoint | Purpose |
|---|---|
| `GET /api/market/browse` | paginated, filterable listings |
| `GET /api/market/item/:id` | one listing's detail |
| `GET /api/market/my-listings` | your active listings |
| `GET /api/market/suggest-price` | suggested price for a catalogue item |
| `POST /api/market/list` | create a listing |
| `POST /api/market/buy/:id` | purchase (accepts `Idempotency-Key`) |
| `POST /api/market/cancel/:id` | cancel your listing |
| `POST /api/market/edit/:id` | re-price your listing |

Every mutation runs inside the project's pessimistic per-item/user locks and
re-reads the listing, item and wallet inside the lock, so a racing buyer or a
cancel-during-purchase can never double-spend or half-settle.

---

## Trading (Stage 3.3)

Peer-to-peer item swaps — no currency involved. Selecting items in your
inventory and choosing **Trade** (or the item modal's **Trade** button) opens a
draft with your side pre-filled and a share link (`/trade/<id>`).

The trade page is two columns — *your items* and *their items* — with per-side
totals and a live **fairness** indicator (fair within 5%, otherwise *you gain* /
*you lose*). Both sides add items from their own inventory, confirm, then
confirm the final "cannot be undone" step; only then does the atomic swap run.
Received items are **trade-locked for 7 days**.

States: pending → ready → completed, plus cancelled and expired (24h TTL). A
trade opened by a non-party is read-only. Changes stream over the Stage 1
WebSocket so an open page updates without a refresh.

The demo is local-first: with no server the counterparty is a seeded demo
trader (`blazzer:trade:pool`) and you drive both sides. Point the client at a
server (`window.BLAZZER_TRADE.sync = true`) for real two-account trades.

API: `POST /api/trade/create`, `GET /api/trade/:id`, `GET /api/trade/history`,
`POST /api/trade/:id/{add-item,remove-item,confirm,final-confirm,execute,cancel}`.

---

## Coming next

| Sub-stage | Adds |
|---|---|
| 3.4 | **Upgrade** — combine items toward a target, provably-fair odds |
| 3.5 | **Gifts + anti-fraud** — send items with a message; floor/ceiling, circular-trade and same-IP guards |

Until each lands, its button shows a short "arrives in Stage 3.x" notice rather
than pretending to work.

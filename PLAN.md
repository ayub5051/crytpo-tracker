# SOQQA — Casino-Style Demo App · Project Plan & Structure

> **Status:** Planning only. No application code is implemented in this commit.
> **Scope:** Frontend-only demo. **No real money, no payments, no backend, no accounts.**
> **Language:** UI copy is 100% Uzbek (`lang="uz"`). This document is written in English so it stays readable for developers; exact Uzbek strings are provided in [§7 UI Copy](#7-ui-copy-uzbek).

---

## 1. Product Summary

**SOQQA** — a "golden coin" themed, high-end dark gambling-style demo app. Players get a free demo balance, play a 3-reel slot machine and a Wheel of Fortune, and can review every spin in a history log. Everything persists in `localStorage`.

**Goals**

| # | Goal | Success looks like |
|---|------|--------------------|
| G1 | Premium dark gambling feel | Gold/neon accents, glow, smooth 60fps animations |
| G2 | Simple, honest demo loop | Bet → spin → result → balance updates instantly |
| G3 | Persistence | Balance, history, stats, settings survive reload |
| G4 | Clean, scalable code | Small ES modules, one responsibility per file, no framework |
| G5 | Responsible demo framing | Visible "demo coins only" disclaimers everywhere money is implied |

**Non-goals (explicitly out of scope)**

- Real payments, deposits, withdrawals, crypto, or any money movement.
- Backend, API, database, auth, multiplayer, leaderboards.
- Build tooling, bundlers, npm dependencies, frameworks (React/Vue/jQuery).
- RNG fairness auditing for real wagers (this is a toy; RTP is tuned for fun, not for gambling).

---

## 2. Tech Decisions

| Area | Decision | Why |
|------|----------|-----|
| Markup | Single `index.html` + view templates rendered by JS | Multi-page would need reloads; a SPA keeps the balance chip alive and animations uninterrupted |
| Navigation | Hash router (`#/`, `#/slots`, `#/wheel`, `#/history`) | Zero-config, works with `file://`-style static hosting, deep-linkable |
| Scripts | Native ES Modules (`<script type="module">`) | Real module boundaries without a bundler |
| Styles | Plain CSS with custom properties + a few `@import`s | One stylesheet entry point, token-driven theming |
| State | Tiny `store` module with a pub/sub (`subscribe/notify`) | Re-renders only the components that care |
| Persistence | `localStorage` behind a safe wrapper | Requirement; wrapper survives quota errors and corrupt JSON |
| Randomness | Central `rng.js` with weighted selection | One place to tune odds/RTP and to seed for tests |
| Fonts/icons | Google Fonts (display + UI), inline SVG symbols | Matches existing project conventions (preconnect + font link) |
| Sound | Optional WebAudio blips (no asset files) or silent | Keeps the repo asset-free; toggleable in settings |

> **Important dev note:** ES modules do **not** work over `file://`. The dev server line is in [§10 Running Locally](#10-running-locally).

---

## 3. File / Folder Architecture

Target layout for the future implementation. Every file is created in the implementation stages of [§9](#9-implementation-stages) — **not** now.

```
soqqa/
├── index.html                     # Single-page shell: head, header, view containers, modal/toast roots
│
├── assets/
│   ├── icons/
│   │   └── sprite.svg             # Inline-able SVG sprite: coin, cherry, bell, diamond, seven, star, wheel
│   └── img/
│       └── logo.svg               # SOQQA wordmark / coin logo
│
├── css/
│   ├── main.css                   # Single entry: tokens → base → layout → components → pages
│   ├── base/
│   │   ├── _reset.css             # Minimal reset + box-sizing + media defaults
│   │   ├── _tokens.css            # CSS custom properties: colors, gold/neon ramp, spacing, radii, shadows, easing, z-index
│   │   ├── _typography.css        # Font stacks, fluid type scale (clamp), headings, numerals
│   │   ├── _animations.css        # @keyframes: glow-pulse, shimmer, float, reel-blur, win-pop, confetti-fall, screen-shake
│   │   └── _utilities.css         # .hidden, .sr-only, .text-gold, .glow, flex/grid helpers
│   ├── layout/
│   │   ├── _header.css            # Sticky header, balance chip, nav links, settings toggle
│   │   ├── _footer.css            # Disclaimer bar, version, reset link
│   │   └── _layout.css            # Page shell, view container, responsive grid, safe-area padding
│   ├── components/
│   │   ├── _buttons.css           # Variants: primary(neon/gold), ghost, danger, icon; hover glow + active press
│   │   ├── _cards.css             # Panel/card surfaces, gradient borders, inner highlight
│   │   ├── _reels.css             # Reel window, reel strip, symbol cells, win-line indicator, blur/spin states
│   │   ├── _wheel.css             # Wheel disc (conic-gradient), segment labels, pointer, hub, spin state
│   │   ├── _bet-controls.css      # Bet selector, +/- steppers, quick-bet chips, max-bet, keyboard hints
│   │   ├── _history.css           # History table/list, badges (win/loss), pagination, empty state
│   │   ├── _modal.css             # Result dialog, backdrop, enter/exit transitions, win/loss theming
│   │   ├── _toast.css             # Toast stack, severity variants, auto-dismiss progress bar
│   │   └── _stats.css             # Stat tiles (total spins, biggest win, net result)
│   └── pages/
│       ├── _landing.css           # Hero, animated background aurora, CTA buttons, feature cards
│       ├── _slots.css             # Slot cabinet: paytable, reels area, controls, win banner
│       └── _wheel.css             # Wheel page: pointer layout, multiplier legend, spin button
│
└── js/
    ├── main.js                    # Entry point: bootstrap store → mount views → register routes → first render
    ├── config.js                  # All tunable constants: symbols, weights, paytable, bet ladder, wheel segments, limits, storage keys
    ├── router.js                  # Hash router: parse `#/x`, guard routes, mount/unmount views, scroll restore
    │
    ├── store/
    │   ├── storageKeys.js         # Namespaced, versioned key strings (single source of truth)
    │   ├── storage.js             # Safe localStorage wrapper: get/set/remove/json parse, quota + corruption handling
    │   ├── state.js               # In-memory state tree + subscribe/notify pub/sub + selectors
    │   ├── balance.js             # Demo balance service: get, add, deduct, reset, daily bonus, insufficient-funds guard
    │   ├── history.js             # Spin history repository: append (capped), read, clear, aggregate
    │   └── settings.js            # User settings: sound, animations, reduced-motion override, last bet
    │
    ├── games/
    │   ├── slots.js               # Pure slot engine: spin(bet) → result object (no DOM)
    │   ├── wheel.js               # Pure wheel engine: spin(bet) → { segmentIndex, multiplier, payout }
    │   └── paytable.js            # Paytable lookup + human-readable payout rows (Uzbek labels)
    │
    ├── ui/
    │   ├── header.js              # Balance chip + nav active state + settings affordances
    │   ├── reelView.js            # Renders reels, owns spin/stop animations, highlights winning symbols
    │   ├── wheelView.js           # Renders wheel, animates rotation, maps rotation → segment
    │   ├── betControls.js         # Bet ladder widget; clamps to balance; remembers last bet
    │   ├── historyView.js         # Renders history list + summary stats + clear action
    │   ├── statsView.js           # Renders aggregate stat tiles
    │   ├── resultModal.js         # Win/loss dialog with payout, multiplier, replay button
    │   ├── toast.js               # Transient notifications (quota error, insufficient funds, bonus granted)
    │   ├── confetti.js            # Canvas particle burst/rain for celebrations
    │   ├── sound.js               # Optional WebAudio blips; no-op when disabled or unsupported
    │   └── format.js              # Number/coin/time/percent formatters + multiplier labels (Uzbek locale)
    │
    ├── views/
    │   ├── landingView.js         # Home route: hero, CTA, disclaimer, quick stats, reset-all action
    │   ├── slotsView.js           # Slots route: wires slots.js ↔ reelView ↔ betControls ↔ history
    │   ├── wheelView.js           # Wheel route: wires wheel.js ↔ wheelView ↔ betControls ↔ history
    │   └── historyView.js         # History route: list, filters (game type), stats, clear
    │
    └── utils/
        ├── rng.js                 # crypto.getRandomValues-backed RNG: int, pick, weightedPick, shuffle, seeded mode for tests
        ├── dom.js                 # el/createEl/clone, class toggles, safe innerHTML, event delegation helpers
        ├── events.js              # Lightweight emitter (on/off/emit) and debounce/throttle helpers
        ├── animate.js             # waitForTransition, nextFrame, prefersReducedMotion, duration scaling
        └── constants.js           # Enums: GameType, Outcome, ToastKind, RouteId (frozen objects)
```

### Why this shape

- **`games/` never touches the DOM.** Engines are pure functions → unit-testable, reusable by slots, wheel, and any future third game.
- **`ui/` never touches `localStorage`.** Views compose engines + store; only `store/` persists.
- **`config.js` is the only place with odds and payout numbers.** Tuning RTP never means hunting through code.
- **Views are mounted/unmounted by the router**, so listeners are cleaned up and animations don't leak between routes.

---

## 4. Responsibilities of Every File

### Root
| File | Responsibility |
|------|----------------|
| `index.html` | Document shell: `lang="uz"`, meta viewport + theme-color, font preconnect/links, `<link rel="stylesheet" href="css/main.css">`, `<script type="module" src="js/main.js">`. Contains: animated background layer, `<header id="app-header">`, `<main id="view-root">` (with empty `<section data-view="…">` anchors), `<div id="modal-root">`, `<div id="toast-root">`, `<canvas id="confetti-canvas">`, footer disclaimer. Semantic landmarks + `aria-live` region for results. |

### `css/`
| File | Responsibility |
|------|----------------|
| `main.css` | Declares `@import` order (tokens → reset → typography → animations → utilities → layout → components → pages). Nothing else. |
| `base/_tokens.css` | The design system: `--bg-900/800/700`, `--gold-400/500/600`, `--neon-cyan/pink/violet`, `--text-hi/mid/low`, spacing scale, radii, `--glow-*` shadow presets, `--ease-out-back`, `--dur-fast/base/slow`, `--z-header/modal/toast/confetti`, reel cell size, wheel size. Light-mode is out of scope; only a high-contrast fallback for `prefers-contrast: more`. |
| `base/_reset.css`, `_typography.css` | Element normalization, fluid type with `clamp()`, tabular numerals for balances so digits don't jitter during count-up. |
| `base/_animations.css` | Shared keyframes + `.is-*` state classes used by JS (`is-spinning`, `is-winning`, `is-losing`, `is-disabled`). |
| `layout/*` | Sticky blurred header, nav, footer disclaimer, responsive page grid, three breakpoints: mobile ≤ 640, tablet ≤ 1024, desktop > 1024. |
| `components/_reels.css` | Reel window with masked overflow, reel strip (`transform: translate3d`), symbol cells, motion blur while spinning, stop bounce, win pulse ring, payline overlay. |
| `components/_wheel.css` | Wheel disc via `conic-gradient` + segment dividers, top pointer, hub, idle slow rotation, spin `transform: rotate()` with cubic-bezier ease-out. |
| `components/_modal.css` | Result dialog + backdrop, scale/fade in, win (gold) vs loss (muted) theming, payout count-up. |
| `components/_confetti.css` (optional) | Only if confetti uses DOM particles instead of canvas; canvas is preferred. |
| `pages/*` | Page-specific composition only. No new colors or magic numbers — always reference tokens. |

### `js/`
| File | Responsibility |
|------|----------------|
| `main.js` | Boots: hydrate store from storage → migrate/seed defaults → build header → register routes → `router.start()`. Installs global error handler → toast. |
| `config.js` | `STORAGE_VERSION`, `STARTING_BALANCE` (10 000), `MIN_BET`, `MAX_BET`, `BET_LADDER`, `HISTORY_LIMIT` (100), `SLOT_SYMBOLS` (+weights/payouts), `SLOT_WEIGHTS`, `WHEEL_SEGMENTS`, `RTP_TARGET`, `ANIMATION_DURATIONS`, `DAILY_BONUS` rules. |
| `router.js` | `register(routeId, { mount, unmount })`, `start()`, `navigate(routeId)`, unknown-route fallback to `#/`, updates nav active state, cancels in-flight view animations on unmount. |
| `store/storageKeys.js` | Exports frozen key map: `SOQQA.v1.profile`, `.balance`, `.history`, `.stats`, `.settings`. |
| `store/storage.js` | `read(key, fallback)`, `write(key, value)`, `remove(key)`, `clearAll()`, `available()` detection (private-mode safe), try/catch on `JSON.parse`, `QuotaExceededError` → toast + memory fallback, debounced writes (~150 ms). |
| `store/state.js` | In-memory tree `{ balance, history, stats, settings, ui }`; `getState()`, `setState(patch)`, `subscribe(fn)`, `notify()`. Single writer path so UI can't drift from storage. |
| `store/balance.js` | `getBalance()`, `canAfford(bet)`, `deduct(bet)`, `credit(amount)`, `reset()`, `grantDailyBonus()` (once per 24 h, only when balance < threshold). Guards negative balances. Records `balanceAfter` snapshots for history. |
| `store/history.js` | `add(entry)`, `list({ game, limit })`, `clear()`, `aggregates()` (total spins, total bet, total won, net, biggest win, best multiplier). Caps array at `HISTORY_LIMIT`, newest first. |
| `store/settings.js` | `get/set` for `{ sound, animations, lastBet, seenIntro }`; merges with defaults; exposes `effectiveAnimations()` combining user setting + `prefers-reduced-motion`. |
| `games/slots.js` | `spin(bet)` → `{ symbols: [s1,s2,s3], outcome, multiplier, payout, winLine, id, timestamp }`. Weighted symbol selection per reel, paytable evaluation, optional near-miss flavor (cosmetic only). Never mutates balance. |
| `games/wheel.js` | `spin(bet)` → `{ segmentIndex, multiplier, payout, outcome }` using `weightedPick(WHEEL_SEGMENTS)`. Exposes `segmentAngle(i)` so the view can land exactly on the chosen segment. |
| `games/paytable.js` | Pure lookups: `multiplierFor(symbols)`, `paytableRows()` for rendering the Uzbek paytable list. |
| `ui/*` | One DOM concern per file (see table in §3). All accept `root` element + callbacks; all expose `render(state)` and `destroy()`. |
| `ui/format.js` | `formatCoins(n)`, `formatSigned(n)`, `formatMultiplier(x)`, `timeAgo(ts)` in Uzbek (`hozir`, `5 daqiqa oldin`, `kecha`), `formatDateTime(ts)` via `Intl.DateTimeFormat('uz-UZ')`. |
| `ui/confetti.js` | Canvas particle system: `burst(x, y, opts)`, `rain(duration)`, `stop()`. Respects reduced-motion and low-power/`visibilitychange`. |
| `utils/rng.js` | `int(min,max)`, `pick(arr)`, `weightedPick(items, weightOf)`, `chance(p)`, `setSeed(n)` (test mode → deterministic LCG). Uses `crypto.getRandomValues` when available, `Math.random` fallback. |
| `utils/dom.js` | `qs/qsa`, `create(tag, props, children)`, `setText`, `toggleClass`, `on(el, type, handler, opts)`, `delegate(root, selector, type, handler)`. |
| `utils/events.js` | `createEmitter()` and `debounce(fn, ms)` / `throttle(fn, ms)` — used to block double-spins and spam clicks. |
| `utils/animate.js` | `nextFrame()`, `wait(ms)`, `waitForTransition(el)`, `prefersReducedMotion()`, `scaledDuration(ms)` (returns ~0 when motion is reduced). |
| `utils/constants.js` | Frozen enums shared by engines and views: `GameType.SLOTS|WHEEL`, `Outcome.WIN|LOSS|PUSH`, `ToastKind.*`, `RouteId.*`. |

---

## 5. UI/UX Flow

### 5.1 Screen map

```
                      #/  LANDING
        hero · logo · demo-balance chip · CTA buttons · stats · disclaimer
              │                                     │
      "Slotlarni o'ynash"                 "Omad charxini aylantirish"
              ▼                                     ▼
        #/slots  ─────────────────────►   #/wheel
        reels · paytable · bet · SPIN      wheel · legend · bet · SPIN

              └──────────► #/history  ◄──────────┘
        every spin listed: game · bet · result · payout · balanceAfter · time

        Global (all routes): header (balance chip, nav, settings) · footer (demo disclaimer)
```

### 5.2 Primary loop (identical structure in both games)

```
1. Player lands on a game route
2. Bet controls show current bet (default = lastBet or ladder[1])
3. System checks balance >= bet  → otherwise SPIN disabled + hint + "Bonus olish" if eligible
4. Player presses SPIN (button / Space / Enter)
5. Guard: isSpinning? → ignore input (debounce + state flag) + controls disabled
6. Balance deducted immediately → header balance count-down animation
7. Reveal animation runs (reels stagger-stop / wheel rotates ~4 s)
8. Engine result evaluated → payout credited → balance count-up animation
9. Result modal: outcome, multiplier, payout; confetti + win sound only when payout > 0
10. History entry appended, stats updated, header reflects new balance
11. "Yana o'ynash" (replay) keeps bet and re-spins; "Yopish" returns to the game
12. If balance == 0 → modal offers daily bonus / reset-to-starting-balance (demo only, never payment)
```

### 5.3 Landing page
- Animated aurora/gradient background + floating coin particles (CSS only, `transform`/`opacity` for GPU compositing).
- Brand lockup, one-line value prop in Uzbek, two glowing CTAs (Slots, Wheel).
- Three quick stat tiles pulled from history aggregates (Jami aylanishlar / Umumiy tikish / Eng katta yutuq).
- Persistent demo disclaimer + "Demo balansni tiklash" action (with confirm dialog).

### 5.4 Micro-interactions & polish
- Buttons: gradient border + outer glow that intensifies on hover; `transform: translateY(1px)` on press; disabled state desaturated.
- Balance chip: `card-flip`/count-up when it changes; brief green flash on credit, red flash on debit.
- Winning symbols: pulse ring + brightness bump + short screen-edge glow; loss: subtle desaturate + gentle shake (disabled under reduced motion).
- Toasts slide from top-right: insufficient funds, corrupted-data recovery, daily bonus granted, storage full.
- Sound design (optional, off by default): reel tick, win chime, button click generated via WebAudio oscillator — no binary assets.

### 5.5 Keyboard & accessibility
- `Space`/`Enter` = spin when focus is not in an input; `←/→` adjust bet; `Esc` closes modal.
- Modal: focus trap, `role="dialog"`, `aria-modal="true"`, restore focus to spin button on close.
- Results announced through `aria-live="polite"`; reels marked `aria-hidden="true"` with a text summary alternative.
- Color is never the only signal (win/loss also carry icons + text labels).
- Full `prefers-reduced-motion` path: no confetti, no blur, instant reveals, ≤150 ms fades.

### 5.6 Responsive behavior
| Breakpoint | Layout |
|-----------|--------|
| ≤ 640 px | Single column; reels scale to viewport width; bet controls become a sticky bottom bar; nav collapses to icon row; modal is a bottom sheet |
| 641–1024 px | Two-column game layout (cabinet + paytable/history sidebar) |
| > 1024 px | Centered cabinet max-width ~1100 px, wheel side-by-side with legend, history as a right rail |

---

## 6. Game Logic

### 6.1 Slots — 3 reels, 1 payline

**Symbols** (draft weights/payouts — tune in `config.js` during Stage 4):

| ID | Symbol | Weight (per reel) | 3-of-a-kind | 2-of-a-kind |
|----|--------|-------------------|-------------|-------------|
| `wild` | ⭐ (yulduz) | 2 | ×25 | — |
| `seven` | 7️⃣ | 4 | ×20 | ×2 |
| `diamond` | 💎 | 6 | ×10 | ×1.5 |
| `bell` | 🔔 | 9 | ×6 | ×1 |
| `clover` | 🍀 | 14 | ×4 | — |
| `cherry` | 🍒 | 18 | ×2 | — |
| `coin` | 🪙 | 22 | ×1.5 | — |
| `blank` | (bo'sh) | 25 | — | — |
| `wild` (wildcard) | ⭐ substitut | — | substitutes any symbol; does not pay on 2-of-a-kind | — |

**Algorithm**

```js
// games/slots.js (signature only — implementation happens in Stage 4)
spin(bet):
  1. For each of the 3 reels: symbol = weightedPick(SLOT_SYMBOLS, weight)
     (one independent draw per reel — this keeps the RTP computable and honest)
  2. Resolve wild: if a wild is present, evaluate the best substitution
  3. multiplier = paytableRows[symbol].threeOfAKind when all three match
                 OR paytableRows[symbol].twoOfAKind when first two match (left-to-right)
  4. payout = round(bet * multiplier); outcome = payout > 0 ? WIN : LOSS
  5. return { symbols, multiplier, payout, outcome, winLine }
```

- **No balance logic inside the engine** — the view calls `balance.deduct(bet)` before and `balance.credit(payout)` after, so the same engine can be reused by tests and future games.
- **RTP tuning:** with the draft table, expected return should land ≈ 0.90–0.95. Stage 4 includes a `node`-run simulation (10⁶ spins via `rng.setSeed`) to verify before shipping the numbers.

### 6.2 Wheel of Fortune

12 weighted segments (visual area equals label but selection is **weighted**, never "equal-area = equal-odds"):

| Multiplier | Odds (weight) | Notes |
|-----------|---------------|-------|
| ×0 (yutuq yo'q) | 30 | most common |
| ×1.2 | 24 | break-even-ish |
| ×1.5 | 18 | |
| ×2 | 12 | |
| ×3 | 8 | |
| ×5 | 5 | |
| ×10 | 2 | rare |
| ×20 | 1 | jackpot, strong celebration |

**Algorithm**

```js
spin(bet):
  1. segmentIndex = weightedPick(WHEEL_SEGMENTS)
  2. angle = segmentAngle(segmentIndex) + fullSpins(4–6) * 360 + jitter(±(segAngle/2 - 2°))
  3. multiplier = segment.multiplier; payout = round(bet * multiplier)
  4. return { segmentIndex, angle, multiplier, payout, outcome }
```

The view applies `transform: rotate(angle deg)` with a 3.5–4.5 s `cubic-bezier(0.12, 0.72, 0.05, 1)` ease-out; the result is decided **before** the animation starts, so the visual always matches the math. Sound tick can be driven by segment-crossing calculations from `transitionend`/`requestAnimationFrame`.

### 6.3 Shared rules
- Coins are integers; any fractional payout is rounded up in the player's favor (documented in `format.js` + paytable copy).
- Bet ladder: `[50, 100, 250, 500, 1 000, 2 500, 5 000]`, clamped to `MIN_BET`/`MAX_BET` and to current balance.
- `MIN_BET = 50`, `MAX_BET = 5 000`, `STARTING_BALANCE = 10 000`.
- Daily bonus: if balance < `MIN_BET`, allow one top-up of 5 000 every 24 h (timestamp stored in `settings`/`profile`). Purely a demo convenience; never presented as a purchase.

### 6.4 Animation pipeline (shared)
```
click → guard(isSpinning) → lock controls → play spin anim → await transitionend/timeout
      → commit result to DOM (symbols / rotation) → evaluate → credit → modal + confetti
      → append history → unlock controls
```
Every unlock happens in a `finally`-style path so a missing `transitionend` (background tab) can never permanently lock the UI; a `setTimeout` fallback always fires.

---

## 7. UI Copy (Uzbek)

| Key | Uzbek string |
|-----|--------------|
| `app.title` | SOQQA |
| `app.tagline` | Omad o'yinlari — faqat demo |
| `nav.home` | Bosh sahifa |
| `nav.slots` | Slotlar |
| `nav.wheel` | Omad charxi |
| `nav.history` | Tarix |
| `balance.label` | Demo balans |
| `balance.reset` | Balansni tiklash |
| `balance.bonus` | Bonus olish |
| `btn.play` | O'ynash |
| `btn.spin` | Aylantirish |
| `btn.replay` | Yana o'ynash |
| `btn.close` | Yopish |
| `btn.clearHistory` | Tarixni tozalash |
| `btn.confirm` | Tasdiqlash |
| `btn.cancel` | Bekor qilish |
| `bet.label` | Tikish miqdori |
| `bet.max` | Maksimal |
| `slots.title` | Slot o'yini |
| `slots.paytable` | Yutuq jadvali |
| `slots.line` | Yutuq chizig'i |
| `wheel.title` | Omad charxi |
| `wheel.legend` | Koeffitsiyentlar |
| `result.win` | Yutuq! |
| `result.bigWin` | Katta yutuq! 🎉 |
| `result.loss` | Yutuq yo'q |
| `result.payout` | Yutuq: {amount} soqqa |
| `result.multiplier` | Koeffitsiyent: ×{mult} |
| `toast.insufficient` | Mablag' yetarli emas |
| `toast.bonus` | Bonus qo'shildi: {amount} soqqa |
| `toast.cleared` | Tarix tozalandi |
| `toast.storageFull` | Xotira to'lib qoldi — ma'lumot saqlanmadi |
| `toast.corrupted` | Saqlangan ma'lumot buzilgan, noldan boshlandi |
| `history.title` | Aylanishlar tarixi |
| `history.empty` | Hozircha o'yin o'ynalmagan |
| `history.col.game` | O'yin |
| `history.col.bet` | Tikish |
| `history.col.result` | Natija |
| `history.col.time` | Vaqt |
| `stats.spins` | Jami aylanishlar |
| `stats.bet` | Umumiy tikish |
| `stats.won` | Umumiy yutuq |
| `stats.biggest` | Eng katta yutuq |
| `stats.net` | Sof natija |
| `settings.title` | Sozlamalar |
| `settings.sound` | Ovoz |
| `settings.animations` | Animatsiyalar |
| `disclaimer` | Bu o'yin faqat demo maqsadida. Haqiqiy pul ishlatilmaydi va yutuq real qiymatga ega emas. |
| `confirm.resetBalance` | Demo balansni {amount} soqqaga tiklaysizmi? |
| `confirm.clearHistory` | Butun tarixni o'chirib tashlaysizmi? Bu amalni qaytarib bo'lmaydi. |

Rules: all amounts use `soqqa` as the unit; dates via `Intl.DateTimeFormat('uz-UZ')`; apostrophes in Uzbek words use `'` (o'ynash) consistently.

---

## 8. LocalStorage Data Structure

**Namespace:** every key is prefixed `SOQQA.v1.` — bumping `v1` → `v2` triggers a migration instead of a crash.

| Key | Type | Purpose |
|-----|------|---------|
| `SOQQA.v1.profile` | object | Identity/versioning metadata, daily-bonus claim time |
| `SOQQA.v1.balance` | object | Demo coin balance |
| `SOQQA.v1.history` | array | Capped spin log (newest first) |
| `SOQQA.v1.stats` | object | Aggregates kept incrementally (fast, no full-array scan) |
| `SOQQA.v1.settings` | object | Sound/animation/last-bet preferences |

### 8.1 Schemas

```jsonc
// SOQQA.v1.profile
{
  "version": 1,
  "createdAt": 1757000000000,
  "lastSeenAt": 1757003600000,
  "lastBonusAt": null,          // ms epoch of last daily bonus claim
  "currency": "SOQQA"
}

// SOQQA.v1.balance
{
  "coins": 10000,               // integer, never negative
  "updatedAt": 1757003600000
}

// SOQQA.v1.history  (array, newest first, max HISTORY_LIMIT = 100)
[
  {
    "id": "spin_1757003600000_a1b2c3",
    "game": "slots",                  // "slots" | "wheel"
    "bet": 100,
    "symbols": ["cherry", "cherry", "bell"],   // slots only
    "segmentIndex": null,                      // wheel only
    "multiplier": 2,
    "payout": 200,
    "net": 100,                       // payout - bet
    "outcome": "win",                 // "win" | "loss"
    "balanceAfter": 10100,
    "timestamp": 1757003600000
  }
]

// SOQQA.v1.stats
{
  "totalSpins": 12,
  "slotsSpins": 8,
  "wheelSpins": 4,
  "totalBet": 1200,
  "totalWon": 900,
  "biggestWin": 500,
  "bestMultiplier": 5,
  "balanceAfter": 9700,
  "updatedAt": 1757003600000
}

// SOQQA.v1.settings
{
  "sound": false,
  "animations": true,
  "lastBet": 100,
  "seenIntro": true
}
```

### 8.2 Rules & safeguards
1. **All reads go through `storage.read(key, fallback)`** — missing/corrupt/legacy values fall back to defaults and self-heal on the next write.
2. **Writes are debounced (~150 ms)** and wrapped in try/catch; `QuotaExceededError` → drop oldest history entries and retry once, else keep an in-memory-only session and toast the player.
3. **Every write stamps `updatedAt`** for debugging.
4. **Schema validation on boot:** if `version` mismatches, run ordered migrations; if parsing fails entirely, clear the namespace, seed defaults, and toast `toast.corrupted`.
5. **Privacy note:** no personal data is stored; history and balance live only in the player's browser and never leave the device.
6. **Growth bound:** history is hard-capped at 100 entries (~30 KB worst case) so quota pressure is essentially impossible.

---

## 9. Implementation Stages

Each stage ends with a runnable, verifiable app. Commit after each stage (one concern per commit).

| Stage | Name | Deliverables | Exit criteria |
|-------|------|--------------|---------------|
| **0** | Scaffold | `soqqa/` tree, `index.html` shell, `css/main.css` + token/reset/typography files, empty `js/main.js` module, README dev-server note | Page loads with themed background, no console errors, tokens resolve |
| **1** | Design system & layout | `_tokens`, buttons, cards, header with balance chip, footer disclaimer, nav, landing page hero + CTAs | Dark gold/neon look matches intent; responsive at 360/768/1280 px; keyboard focus visible |
| **2** | Storage & state layer | `storageKeys`, `storage`, `state`, `balance`, `settings`, `format`, `utils/*` | Balance persists across reload; corrupt-JSON self-heal; unit-check of `weightedPick`/`formatCoins` |
| **3** | Router & views | `router.js`, `landingView`, route stubs for slots/wheel/history, nav active states, unmount cleanup | Hash routes switch views, no listener leaks, back/forward works |
| **4** | Slots engine + cabinet | `config` slots table, `paytable`, `games/slots.js`, `reelView.js`, `betControls.js`, paytable UI, spin animation, win highlight | 3 reels spin with staggered stops; payouts match paytable; RTP simulation ≈ target; balance math exact |
| **5** | Wheel of Fortune | `games/wheel.js`, `wheelView.js` (conic-gradient disc, pointer, rotation), legend | Wheel always lands on the pre-decided segment; result matches the modal; no visual/math mismatch |
| **6** | History, stats & persistence polish | `store/history.js`, `historyView`, `statsView`, JSON schemas in §8, cap + clear + confirm dialogs | Every spin appears in history with correct `balanceAfter`; stats equal history aggregates; survives reload |
| **7** | Celebration & feedback | `confetti.js`, `resultModal.js`, `toast.js`, `sound.js` (optional), win/loss theming, screen glow | Confetti only on wins; modal accurate; toasts for errors; reduced-motion path fully silent/simple |
| **8** | Settings, edge cases & QA | Settings toggles, reset-all flow, daily bonus, insufficient-funds state, background-tab safety, quota fallback, full testing checklist | Every item in §11 passes; Lighthouse a11y ≥ 90 on the landing and slots routes |
| **9** | Documentation & release | README (features, structure, run steps), code comments in Uzbek/English, final commit + tag `v1.0.0-demo` | Fresh clone runs with one command; docs match the shipped UI |

**Definition of Done (per stage):** no console errors, responsive at all three breakpoints, keyboard-operable, reduced-motion respected, and no real-money wording anywhere in the UI.

---

## 10. Running Locally

```bash
# Static server (ES modules need http://, not file://)
python3 -m http.server 5500
#   → http://localhost:5500/
```
Alternatives: VS Code "Live Server" extension, `npx serve .`. No install, no build step, no dependencies.

---

## 11. Testing Checklist

Manual-first (no test framework required). Mark each item ✅ / ❌ on the PR.

### A. Functional — Balance
- [ ] Fresh visit seeds exactly 10 000 demo coins.
- [ ] Spin deducts the bet immediately, before the animation ends.
- [ ] Win credits `bet × multiplier` exactly once (no double-credit on fast clicks).
- [ ] Balance never goes negative, even with rapid clicking / keyboard spam.
- [ ] Bet controls clamp to balance; SPIN disables at balance < MIN_BET.
- [ ] Reset restores 10 000 only after confirmation; daily bonus respects the 24 h window.
- [ ] Balance chip animates and matches `SOQQA.v1.balance` after every action.

### B. Functional — Slots
- [ ] 3 reels always stop on visible symbols (no half-symbols, no empty cells).
- [ ] Every 3-of-a-kind in the paytable pays the documented multiplier.
- [ ] Wild substitution evaluates correctly (including wild + wild + symbol).
- [ ] Non-winning spins show the loss state and payout 0.
- [ ] Spin is ignored while a spin is in progress.
- [ ] Simulated 10⁶ spins: RTP is within ±2% of the configured target.

### C. Functional — Wheel
- [ ] Pointer always lands inside the segment returned by the engine.
- [ ] Payout equals `bet × segment multiplier` for every segment type.
- [ ] Weighted distribution roughly matches configured odds over 10 000 spins.
- [ ] Jackpot (×20) triggers the strongest celebration and history flags it correctly.

### D. Persistence
- [ ] Reload preserves balance, history, stats, and settings.
- [ ] A second tab opened after a spin reads the same stored state on load.
- [ ] Deleting a key in DevTools falls back to defaults without crashing.
- [ ] Writing `"{not json"` into a key triggers self-heal + `toast.corrupted`.
- [ ] History is capped at 100 (oldest entries drop, newest kept).
- [ ] "Tarixni tozalash" empties history but keeps the balance.

### E. UI / UX / Animation
- [ ] No layout shift/jank while reels spin (transform-only animations, 60 fps target).
- [ ] Win celebration fires only on wins; loss animation is subtle.
- [ ] Modals trap focus, close on `Esc`/backdrop, and restore focus.
- [ ] Toasts stack, auto-dismiss, and never cover the spin button.
- [ ] `prefers-reduced-motion: reduce` → no confetti/blur, instant reveals, app still fully usable.
- [ ] Works at 360 px, 768 px, 1280 px, and 1920 px with no overflow or clipping.
- [ ] Current Chrome/Firefox/Safari (+ mobile Safari/Chrome) all render the wheel and reels correctly.

### F. Accessibility
- [ ] All interactive elements reachable and operable by keyboard alone.
- [ ] `aria-live` announces results; reels are `aria-hidden` with a text summary.
- [ ] Contrast ≥ 4.5:1 for body text and ≥ 3:1 for large text on the dark theme.
- [ ] Win/loss communicated by icon + text, not color alone.
- [ ] Cash-out/settings labels are meaningful out of context (no icon-only buttons without labels).

### G. Compliance & safety
- [ ] Every game screen shows the demo disclaimer.
- [ ] No wording implying real money, winnings, deposits, or withdrawals anywhere.
- [ ] No network requests for game data (fully offline after fonts load).
- [ ] No third-party trackers/analytics.
- [ ] Landing page states coins have no real value.

### H. Code quality
- [ ] No file exceeds ~250 lines; each module has a single responsibility.
- [ ] `games/*` import no DOM APIs; `ui/*` never call `storage` directly.
- [ ] No magic numbers outside `config.js` / `_tokens.css`.
- [ ] No leftover `console.log`, `debugger`, or commented-out code.
- [ ] All user-visible strings come from one place (copy table §7 / a `copy.js` if it grows).

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `localStorage` blocked (private mode) | No persistence | `storage.available()` check → in-memory fallback + one-time toast |
| Quota exceeded | Writes fail silently | Cap history at 100, catch error, prune oldest, retry, toast |
| Missing `transitionend` (background tab) | UI locks forever | Always pair animations with a `setTimeout` fallback before unlocking |
| RTP tuned by accident high/low | Demo feels broken or unfair | Simulated 10⁶-spin check in Stage 4 gates the shipped paytable |
| "Casino" framing misread as real gambling | Trust/legal concern | Persistent Uzbek disclaimer, no money wording, no payments anywhere |
| Scope creep (more games, accounts) | Never ships | Non-goals list in §1 is binding; coinflip/other games are post-v1 stretch only |
| ES modules fail over `file://` | Blank page for testers | README documents the static-server command |

---

## 13. Post-v1 (Stretch, not planned work)

- Coinflip as a third game (reuses `betControls`, `history`, `resultModal` unchanged).
- Achievements/badges from `stats` aggregates.
- Seeded "practice mode" share link for reproducible spins.
- PWA offline install + local notification for the daily bonus.
- Multi-language copy layer (`copy.uz.js` / `copy.en.js`) behind the same §7 keys.

---

*End of plan. Implementation begins with Stage 0 and proceeds stage by stage with a commit per stage.*

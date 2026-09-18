# SOQQA — Omad o'yinlari (demo)

A dark, Uzbek-language casino-**style** demo built with nothing but HTML, CSS and vanilla
JavaScript. It ships three games — a 3-reel slot machine, a 12-segment wheel of fortune and
a 5×5 Mines board — on top of a persistent demo balance and a 50-entry history.

> ### ⚠️ Demo only
> **Haqiqiy pul ishlatilmaydi.** SOQQA moves *invented* coins around a browser
> `localStorage` key. There is no deposit, withdrawal, payment, account or server — and
> none is planned. The economy below is a simulated, configurable maths model, nothing
> more.

---

## At a glance

| | |
|---|---|
| **Stack** | HTML5 · CSS3 · ES modules (vanilla JavaScript) |
| **Dependencies** | none — no framework, no bundler, no build step |
| **Persistence** | `localStorage`, namespaced under `SOQQA.v1.*` |
| **Starting balance** | 1 000 000 demo coins |
| **Games** | 3-reel slots · 12-segment Omad charxi · 5×5 Mines |
| **Routes** | `#/` · `#/slots` · `#/wheel` · `#/mines` · `#/history` |
| **Language** | Uzbek (`<html lang="uz">`) |
| **Tests** | 17 dependency-free suites · 1388 assertions (`npm test`) |

---

## Features

### Landing page (`#/`)
Hero section with the demo disclaimer, two calls to action, and four live stat tiles
(total spins, total won, biggest win) that read straight from the store.

### Demo balance
Starts at **1 000 000 soqqa**, survives reloads, and is shown in the sticky header.
Wins and losses animate the number with a green/red flash; the balance can never go
negative and can be reset from the footer (with a confirmation).

### Slots (`#/slots`)
- Three reels, one mid-row payline, independent per-reel draws from a **weighted symbol
  table**.
- Spins deduct the bet first and credit the payout after, so the balance can never
  drift out of sync with the history.
- Every payout comes from a data-only paytable (`js/games/paytable.js`), including the
  wild, which substitutes for any other symbol but never for itself.
- **Premium 3D vector symbols.** The drums carry no emoji: all seven are hand-built SVG
  on one 64×64 artboard — golden 7, brilliant diamond, brass bell, ruby cherry, emerald
  clover, the SOQQA coin and a gold wild star — and they share a single art direction
  rather than reading as seven unrelated drawings. Every one is cast from the same recipe:
  a metallic body ramp with a hard reflection break (which is what makes a ramp read as
  metal instead of yellow paint), a lit bevel face, an extruded side sitting in shadow, a
  diagonal gloss band clipped to the silhouette, and a warm bounce light along the
  lower-right edge. Organics swap the gloss band for rim-lit spheres with a hot specular
  core; the clover's leaflet is defined once and rotated into its four lobes, so the four
  cannot fall out of symmetry. There is **no `<filter>` anywhere in the sprite** — depth
  comes from gradients and flat shapes, which keeps the drum layers cheap to raster and
  stops the art going soft behind the glass. The whole set lives in one sprite at the top
  of `index.html` and scales losslessly, so the same art serves the drums, the paytable,
  the history rows and the wild legend.
  - Measured ink boxes: wild 51.5×49.5, seven 41.7×45.4, diamond 40.1×44.0, bell 42.4×49.7,
    clover 47.5×48.1, cherry 44.2×52.6, coin 50.0×51.8 — every one inside the artboard and
    at least 40 units on its short axis, so no symbol shrinks next to its neighbours.
  - `tests/symbols.test.mjs` fails if a symbol in `js/config.js` has no matching artwork,
    if any artwork overflows the artboard, if a symbol drops below its weight floor, or if
    a filter creeps back in. Overflow is **measured, not eyeballed**: the suite walks every
    element, group, `<use>` and transform and unions the geometry, using the control hull
    of each curve (so the hull contains the curve and a pass genuinely means it fits),
    expanded by half the widest stroke to account for outline ink. Clipped layers — the
    gloss bands, which are deliberately larger than the silhouette they are painted into —
    are measured against their clip instead of their own ink.
- **Real, continuous reels — no symbol swapping.** Each drum is a long strip of vector
  symbols, built once at boot, that slides behind a three-row aperture. A spin moves one
  number (`--reel-offset`); it never inserts, removes or re-points a cell. The strip
  repeats a 14-cell cycle in which every symbol appears twice, so any fourteen
  consecutive cells already hold the drawn symbol — a turn just scrolls far enough to
  bring it home. The player watches the target symbol travel down the drum and settle on
  the line, and the resting cell *is* the engine's result rather than a repaint of it.
- Reel choreography with real weight to it — **≈ 2.9 seconds** per spin, in four phases:
  rapid acceleration, a full-speed hold, a long gradual brake, then a mechanical landing.
  The drums arrive at **1.8 s · 2.3 s · 2.8 s**, so anticipation builds left → right and
  each drum stays locked while the ones to its right keep turning. The landing is a
  **damped bounce**: a slight overshoot past the line, a rebound, and a micro-settle onto
  the exact cell, with the housing taking the same bounce as a pixel-scale nudge.
- **Crisp, sharp symbols — there is no motion blur.** No blur filter, no ghosting and no
  fading anywhere on the strips: a spin writes exactly one number (`--reel-offset`) and
  nothing else, so every symbol stays perfectly legible at every frame from take-off to
  lock. The speed profile is what sells the motion, and keeping the spin to a single
  `transform` keeps the whole drum on the compositor.
- **Stealthy, high-contrast cabinet.** The slots panel and its drums are deliberately
  under-lit: near-black surfaces, deep drum vignettes, a single diagonal glass
  reflection, and *no* ambient gold glow and *no* painted win line at rest. Lighting is
  earned: a win sweeps a band of light across the glass, strokes a **golden ring around
  each winning symbol** that pulses with a neon halo, and breathes the cabinet frame; a
  significant win adds a bloom, and the ×50+ tier runs the full jackpot light show — two
  sweeps and a tighter, faster bloom. A losing stop stays dark and quiet, and the gold
  glint on a locking drum is scoped to turns the engine has already decided pay, so a miss
  never flashes anything.
- Every animated property is `transform`, `opacity`, `filter` or `box-shadow` — never a
  layout property — so the drums are promoted to their own layer for the turn and nothing
  on the page reflows around them.
- The paytable panel is rendered from configuration, so the on-screen odds can never
  disagree with the maths.

### Omad charxi — wheel of fortune (`#/wheel`)
- 12 segments, each with its own multiplier and its own **weight** — the wheel is
  *weighted*, not equal-area, and the in-app legend prints the real probability next to
  every multiplier so the game stays honest.
- The result is decided **before** the animation: the engine returns the winning segment
  *and* the exact landing angle, so the disc always stops where the payout says it did.
- **Svetomuzika — and the flash IS the rotation.** The frame carries **24 lamps**, each a
  drilled socket holding a **hot bulb core** and the **halo** it spills onto the brass.
  The marquee is the **odd half of the ring flashing against the even half**, ~**7 flashes
  a second** at speed easing down to a slow warm pulse as the wheel dies. It is not on a
  timer: `js/ui/wheelDisc.js` integrates a band angle from the drum's own angular velocity
  and writes each lamp's brightness as **`--lamp-lit`** (0…1, snapped to **8 steps**,
  written only on the frames a lamp actually crosses a step), so one flash happens per
  **90° of band travel**. Both halves read the *same* wave exactly 180° apart, which is
  what keeps the split honest — when the odd bulbs are at their brightest the even ones are
  at their dimmest by construction, not because two clocks agree. Riding on top as a bias
  is a **travelling head with a long tail**, which is what keeps the ring legible as a wheel
  *turning* rather than as a ring blinking. A CSS keyframe could not do any of it: its
  duration is fixed, so it cannot follow the wheel, and re-timing a running animation every
  frame jumps the phase — the one thing a marquee must never do.
- **The ring is never dark.** A marquee bulb is a light source that is *on*, so
  `--lamp-lit` is never zero: every socket carries its own **resting level**
  (`idleLit ± idleVariation`, 0.125…0.375 on a fixed per-bulb pattern, so the ring comes
  back to exactly the same glow after every spin). The travelling head then rides *on top*
  of it, which is why the chase is a wave through a lit ring rather than a run of dots
  switching on: the halo ranges **0.48 → 1.00** (×2.1) and the bulb core **0.42 → 0.96**
  (×2.3) between a resting bulb and one under the head.
- **The softest half of the flash crosses over.** The wave is a raised cosine rather than a
  square, so the two halves *cross* instead of snapping — a bulb on a dimmer ramps, and
  that ramp is what gives the ring its warm gold/amber pulse. On a **confirmed win** the
  same ring switches to a hard strobe: a true square wave (`steps(1, end)`, so a bulb is on
  or off and never in between) with **odd and even on opposite phases**, ~**2.4 times a
  second**, stepping up to ~**4.5** on the top tier. The parity comes from an attribute the
  view writes when it builds the sockets, so the stylesheet cannot disagree with the order
  they were appended in.
- **When the drum stops, the lights wind down — and the machine gives one heavy clunk.**
  The ring's rate and the head's excess brightness decay from the *same instant* — the pin
  catch — over **560 ms**, so the head dissolves back into the resting ring and the
  flywheel is visibly still by the time the drum has finished its rebound. The whole ring
  also **surges** on the catch: a pulse over **420 ms** in **2 flashes** that lifts *every*
  bulb at once — which no chase can do, since a chase always leaves a run of bulbs behind
  its head, and that difference is what tells the player the wheel has *caught* rather than
  merely stopped moving. Measured from the catch rather than from the end of the rotation,
  all of it adds no time to the spin.
- **Lighting is composited, not repainted.** During the spin the only animated property in
  the whole lamp subtree is `opacity` (with `transform` derived from it): no `filter`, no
  `box-shadow`, no layout, and `will-change: opacity, transform` is promised only while the
  ring is moving. This matters: filters or shadows on animating elements force a re-raster
  of the whole ring every frame, which is exactly how a bulb sequence ends up looking
  frozen.
- **One atmosphere, and it only ever gets fainter.** Behind the drum is a single soft wash
  of warm light — the machine's own light falling on the wall behind it — peaking at **0.12**
  at the centre, *under the opaque drum*, so the strongest part anyone can actually see is
  about **0.05** right at the frame, reaching 0.70 of a wheel diameter out and fading to
  nothing before the edge. Practically no glow, which is the point: it is there so the wheel
  does not read as a disc floating in a void, not to be looked at. A plain `background` on a
  pseudo-element with no filter and no animation, so it costs nothing per frame and can never
  end up on the bulbs' layer budget. The seat the drum drops into is still a warm dark
  **brown** rather than a neutral black.
- **Ultra-premium cabinet**: a brass frame built from **four concentric turned rings** — a
  machined outer bevel, a dark reflective groove, the main band with a hard-break metal
  ramp and a specular arc along its top, and a lit guide rail — over a **recessed well**
  whose inner shadow seats the drum *inside* the frame. The knob is a turned brass
  centrepiece with no lettering (a conic brushing sweep, a collared step, a domed face and
  a recessed boss), and the landing pin is a 3D gold arrow with a lit side, a shadowed
  flank and a pivot above the wheel. The drum is 12 wedges in strictly alternating **deep
  ruby** and **gold-black**, each on a six-stop *metal* recipe — base, body, **reflection
  break**, lit band, hot rim — with a raised metal separator and a polished stud on every
  seam. The reflection break is what makes it read as a machined surface instead of
  coloured paper, and the two palettes are deliberately far apart at every band the player
  can see.
- **Mechanical physics, 4.0 s — and the drum ARRIVES, it is not stopped.** The drum
  **kicks** off the line — 65 % of its top speed within 100 ms, from a sub-linear ramp, the
  way a heavy wheel driven by a motor behaves — holds a peak of **3.2–4.8 rev/s** (a wedge
  passes every frame, so the segments genuinely blur), then brakes on a **blend of a
  constant deceleration and a power decay** (`brakeLinearShare`, shipped at **0.78**), which
  is what a friction-limited wheel actually does. The share is **measured, not chosen by
  taste**: across the last **1.5 s** of the brake — the stretch the player is actually
  watching — the deceleration varies by **1.33×**, against **1.94×** at the 0.55 this
  replaced. The pegs therefore come up at a near-constant tempo instead of arriving on
  whatever the curve happened to be doing, and a test fails if that variation ever climbs
  back above **1.8×**. The remaining 22 % of decay is what keeps the drum from feeling like
  it is running on rails.

  The blend is the fix for the whole feel of the stop. A pure `(1 − u)^exponent` decay has
  a slope of **zero** as it arrives, so it flattens: the drum stopped decelerating at about
  60 % of the way through, coasted onto the pin at **half a revolution per second**, and the
  catch had to absorb **0.235 deg/ms — 3.92° of travel lost in a single frame**. That is
  what a sudden stop *is*. Measured now, across every spin the engine can draw:

  | | before | now |
  |---|---|---|
  | speed at the pin catch | 0.50 rev/s | **0.14 rev/s** |
  | deceleration on the last frame, as a share of the opening one | 4.3 % | **31 %** |
  | travel spent within 1.25× the catch speed | 22 % | **< 8 %** |
  | velocity step at the hand-off | 3.92°/frame | **1.3°/frame** |
  | deceleration variation across the last 1.5 s | 1.94× | **1.33×** |

  The pin then catches a wheel that is genuinely creeping: the wheel ticks **5° past** the
  target, **snaps back onto it**, bounces once the other way and settles exactly on the
  drawn angle with zero velocity. The clock is a `requestAnimationFrame` loop over the
  closed-form curve in `js/ui/wheelDisc.js` + `js/ui/wheelPhysics.js` — **no CSS transition
  anywhere on the drum**, which matters: a `transition: transform` there would fight the
  loop and swallow the tick past the pin, and a cabin test fails if one ever appears.
- **Pin flick — a hinged flapper, not a fade.** The angle and angular velocity are read
  every frame, and the deflection is derived from them, so each rim peg lifts the tip as it
  passes. Two things make it read as mechanism: the arm **springs back past its rest
  position** after every peg (up to **−0.19** of full deflection, ≈ **2.5°** of swing, at
  ~18° past the peg) the way a real hinged flapper overshoots, and the speed gate is
  **sub-linear** (`^0.6`) so the arm does *not* go limp as the wheel crawls — a peg at 15 %
  of full speed still lifts it to **0.32** instead of the **0.15** a linear gate would give.
  The ticks therefore stay definite all the way down, which is the half of the stop the eye
  actually watches. It finally takes **one deliberate click as it seats**, delivered as its
  own pulse over the last **300 ms** of the spin: across the landing the drum is inside a
  few degrees at a fraction of a degree per millisecond, far too little to move the arm on
  its own, and a machine that just stops has no moment of arrival.
- **The celebration reads as a ladder, not a switch.** Any paying stop lights the wedge the
  pointer stopped on and throws a gold spill onto the frame around the drum; a ×5+ win
  takes the whole ring onto the **odd/even strobe**, bloomed; a **×20** jackpot steps the
  same strobe up a gear. A miss stays completely dark — lighting is earned, and every one of
  those selectors is scoped to a state only a confirmed result can set.
- **Every number is outlined, not just shadowed.** The drum alternates deep ruby and
  **pale gold**, and the labels are near-white: a single soft shadow left `×1.2` at
  something close to no contrast at all on the light half of the wheel. Each label now
  carries a **hard dark ring** — eight `text-shadow` layers plus the 2 px drop-off — so the
  glyph reads on gold, on ruby, and across the seam lines between them. The ring lives in a
  custom property precisely so the states can add their own glow *without replacing it*:
  `text-shadow` is one property, so writing the jackpot rule the obvious way would have
  left the biggest number on the wheel as the only one with no outline.
- **A glow is a PROFILE, not an alpha — and this is the rule the suite enforces.** Any layer
  whose brightness rises again as it goes outward reads as its own glowing circle: a peak at
  a second radius, or a hole with light behind it. Two or three of those stacked is a set of
  concentric rings *however faint each one is*, and dimming them does not help, because the
  eye finds an edge at any alpha. That is exactly what the two attempts before this one
  shipped, and the fix was not a smaller number — it was deleting layers. So `assertNoRing`
  now requires that **every stop is dimmer than the one inside it** in both remaining layers,
  that they are one warm hue family (the previous recipe ran amber → crimson → the page's
  violet and teal, which at this size read as colour banding rather than as physics), and that
  the aura's brightest stop is the **innermost** one, under the drum, never at a radius of its
  own. Measured over the visible band, the old composite rose on its way out **53 times**
  between 0.50 and 0.90 of a wheel diameter; it now rises **zero** times and peaks at the
  frame. The spill onto the panel is likewise a **single** dim pass over the black drop shadow
  that seats the machine, and the well around the drum keeps its own layered lighting — the
  dark seat, the amber bounce the rim throws into its cavity, the crimson falloff, the inner
  shadow that seats the drum — at dialled-back alphas, so the cavity is warm without being the
  brightest thing in the section.
- **The neon ring is gone, and the clip bug that hid its falloff is now a rule.** There is no
  `.wheel-neon` layer and no `neon-breathe` keyframes any more, and the assertions guard the
  *absence* so it cannot come back. Worth recording why it looked wrong, because the mistake
  is invisible in the stylesheet and obvious on screen: a `circle` gradient with no explicit
  size is sized to **`farthest-corner`**, so its radius is **0.7071 ×** the element's width —
  while the element, at `border-radius: 50%`, is a circle of half that. Every stop past
  **70.71 %** is painted outside the element and discarded. That layer wrote its falloff at
  **78 %**, **88 %** and **96 %**, so **three of its four coloured stops never rendered at
  all**: it ended in a hard, fully-saturated edge at whatever alpha it had reached by
  70.71 %, wrapped all the way round the wheel. The backdrop had the same fault in miniature,
  where a fade to `transparent 80 %` was really a step at 0.047. `assertFalloffInsideDisc`
  now applies the fix as a single rule — every light layer has to reach `transparent` *before*
  the clip — and the frame keeps its **hot gold → amber → magenta filament** at up to 0.92
  under a 2.6-unit halo at 0.42. That is a lit **edge**, not a halo: it sits on the metal
  rather than around it, so it is unchanged.
- **Deep bases, with the CHROMA put back in the lit bands.** The first pass at this
  bought depth the wrong way: it sank the bases (right) and then muted the lit bands too
  (wrong), leaving a bronze body stop at a channel spread of 146 and a dull red at 155. The
  drum's average pixel was dark mud and the machine read flat however good the geometry
  underneath it was — because luminance is not what separates a metal from a painted
  surface, **chroma** is. The bases still sit in shadow; every *lit* band now carries real
  chroma again (gold's body band spread 206 against 146 before, ruby's 182 against 155) and
  climbs clear of its own base, so the eye reads polished metal rather than a printed
  colour. The contract is asserted in both directions — a chroma *floor* on the lit bands,
  and the same luminance *ceilings* on the bases as before. Three face layers give each slice
  a *surface* rather than a printed colour: a polished **lip** cut just inside the rim
  (inset a couple of degrees at each end so neighbouring lips never merge across a seam), a
  dark **throat** where the slices run under the knob's collar so they look inlaid into a
  recessed well, and a long diagonal **sheen** — the room's reflection lying across the
  drum. The palette contract still holds: the ramps alternate, break back into shadow at
  band 3, climb to the rim, and stay clearly apart at every band the player can see.
- **Smoothness is three deliberate choices, not a property of the curve.** (1) **One
  monotonic clock** — the frame's position is read off `performance.now()`, never
  `Date.now()`, which is quantised to a millisecond and can be stepped *backwards* by an
  NTP correction mid-spin; either one puts a visible kink in a 4.0 s rotation. (2) **One
  compositor layer** — the drum's transform carries `translateZ(0)` beside the rotation,
  so the browser transforms a texture instead of re-rasterising twelve wedge paths and
  their gradients sixty times a second. That re-rasterisation is what reads as shimmer or
  stepping at speed, and it is the one thing the curve cannot fix. (3) **No layout, ever** —
  a frame writes the drum's transform, at most one custom property on the pin, and
  `--lamp-lit` on the bulbs that actually crossed a brightness step. A smoothness audit
  watches the real loop frame by frame and asserts what a stutter would violate: the spin
  reads `performance.now()` and the file holds no wall-clock read but the documented
  fallback, every frame keeps `translateZ(0)` on the drum, the drum never steps backwards
  on its way up to speed, the travel beat passes through 20+ distinct positions, and no
  single hop is out of scale with a typical one (the shipped ratio is ~1.7×, guarded at
  3×).
- **4 000 ms — the top of the suspense band — with the extra time spent in the brake.**
  The travel beat runs **3 120 ms** and the landing **880 ms**. Because the ramp is a
  *share* of the travel it stays a ~218 ms kick, and because the drum covers the same total
  distance, a longer spin is strictly slower on the way in and never faster anywhere — the
  last stretch turns from a deceleration into a slow, heavy wind-down. The **turn count is
  untouched**, which is the point: more time over the same distance reads as mass, whereas
  more turns would read as a faster motor.
- The disc, its colours and its labels are all painted from one config array, so a
  multiplier can never drift away from its wedge.

### Mines — 5×5 xazina (`#/mines`)
- A **5×5 board of 25 tiles** with the mine count chosen by the player, **1 to 24**. Each
tile is a button holding a real 3D flip: two back-to-back faces on a `preserve-3d` inner
that turns 180° about Y, with `backface-visibility` hiding each from the other so the coin
never shows through the lid mid-turn. The board supplies **one** `perspective` for all 25
tiles, so they share a vanishing point instead of each carrying its own and reading as a
sticker swap.
- **The odds are the board, not a table.** After `k` safe reveals the chance of still being
alive is the hypergeometric `P(k) = C(25 − mines, k) / C(25, k)`, and the multiplier is
`0.97 / P(k)` floored to two decimals. Nothing is hand-written: pick a different mine count
and all 24 rungs move with it. `js/games/mines.js` computes `P(k)` as a chain of ratios
(accurate to **6.5 × 10⁻¹⁶** relative against exact BigInt arithmetic at all 300 legal
combinations), and the floor means the number the panel prints is **exactly** the number
the payout is computed from.
- **One flat 3 % house margin, everywhere.** Because the multiplier is the edge divided by
the odds, cashing out after *any* number of reveals returns the same thing — measured over
the whole board, the return sits in **0.9625 … 0.9700** and never leaves it. There is no
lucky rung and no unlucky one.
- The ladder, for the default three mines:

  | Tiles turned | 1 | 2 | 3 | 4 | 5 | … | 22 |
  |---|---:|---:|---:|---:|---:|---:|---:|
  | Multiplier | ×1.1 | ×1.25 | ×1.44 | ×1.67 | ×1.95 | … | ×2 231 |

- **The board is dealt once.** Mine positions are drawn when the round starts and never
consulted by the payout logic again, so a round's difficulty cannot shift under the player.
The draw is Fisher–Yates over all 25 tiles, and the suite measures it over 4 000 rounds —
every tile lands within **2.4σ** of the 12 % it should, with no round ever drawing the same
tile twice. (The first tile is **not** protected: a free first pick would make the game
more generous than the odds it prints.)
- **Start → turn → cash out.** The stake is taken when the round starts; a safe tile lifts
the multiplier and drops a rising `×1.25 / +250` ribbon on the tile it came from; **Pulni
olish** (cash out) banks the multiplier and pays **once** — the engine closes the round
before it computes the payout, so a double click, a keyboard repeat and the overlay's
replay all get `reason: 'over'` and nothing else. A mine ends the round, then shows
**every** tile it left, sequentially.
- The cash-out button is the only gilded control in the app and it is **grey until it is
worth pressing** — it arms only once at least one tile has been turned, breathes a slow gold
pulse while it is live, and keeps a sheen crossing it on a loop while the player decides.
A cash out past `MINES.bigWinMultiplier` (×5) is promoted to the `is-big` tier, which the
stylesheet answers with a brighter table glow and a ripple that pulses twice instead of
once.
- **The turn has weight.** A **460 ms** flip on a `cubic-bezier(0.4, 0.72, 0.26, 1.08)` — the
curve passes the upright by **1.8°** and settles back onto it, so the lid lands like a piece
of metal instead of stopping dead on 180°, which is what a plain ease-out does. The suite
solves the shipped curve from the stylesheet and fails it if that overshoot ever leaves a
**0.7° … 10.8°** band, or if it stops settling back. The gem that turns under it is a
**lit vault**: a warm bounce above, a prismatic conic ring suggesting facets, a bloom, and
**four sparks** thrown along their own spokes from one set of keyframes (`MINES.gemSparks`).
A mine throws a **dark-red shockwave** with a second, slower ring drawn on the tile itself
(no cartoon explosion) and then a rim that **breathes** on the tile the player actually
opened.
- **The end of the round is choreographed, not repainted.** The mine lands **alone**; a
`revealLeadMs` beat is held; then the board turns **outward from the hit tile, ring by ring**
(Chebyshev distance, so the diagonals belong to their square ring), with unturned tiles held
back at half opacity so the wave reads as light spreading. The gap between two tiles comes
from a **1 700 ms** budget (≈71 ms for a 24-tile wave) rather than the old ~46 ms rush, and
the integration suite measures the real order and the real median gap against that config.
The hold-back is an **opacity, not a `filter`** — 24 rasterising elements for the length of
every reveal is exactly the cost this board cannot pay.
- **Nothing animates on a `filter`.** The gem's contact shadow lives on the static art slot
and the art under it scales with a bare transform, so a reveal composites a transform and an
opacity and nothing else.
- `--mines-flip-ms` and `--mines-ripple-step` are written onto the grid **from
`MINES.flipMs` and `MINES.winRippleStepMs`**, so the stylesheet and the view's own timers can
never disagree about how long a tile takes to turn or how fast the win ripple runs; the
stylesheet's own declarations are the pre-boot defaults and tests fail if they drift. Each
tile carries `--mines-order`, its place on the board, which is what the ripple sweeps in
reading order.
- The board is square at every width (`aspect-ratio: 1 / 1` on the grid and on each tile),
so the 25 tiles stay perfectly aligned and never stretch or overflow.

### Win celebrations & the result overlay
Both games share one animated overlay (`js/ui/resultModal.js`), opened the instant the
last drum (or the disc) stops:

- **Tiered titles** — `Tabriklaymiz!` for any ordinary win, `Katta yutuq!` a step up, and
  `Jekpot!` at the top, with their own icon and palette (`is-win` / `is-big-win` /
  `is-jackpot`).
- The signed net amount, a fact row (**bet · multiplier · symbols** on the slots,
  **bet · multiplier · segment** on the wheel, **bet · multiplier · board** on Mines) and
  the resulting balance.
- **A confetti burst on every win, fired the moment the reels stop (or the wheel comes to
  rest)** — gold and neon
  ribbons tumbling under gravity with additive golden-white glints, scaled by the
  multiplier. The top tier throws a *fan* of three origins across the viewport instead of
  one pop.
- The overlay traps Tab focus, closes on Escape, backdrop click or its own button,
  restores focus to where it came from, offers *Yana o’ynash* (which replays through the
  cabinet, guard and all) and becomes a scrollable bottom sheet on phones. On
  `prefers-reduced-motion` it appears instantly and skips the particles entirely.

Everything above is decoded **after** the last reel lands. A losing spin on the slots opens
no overlay at all: it shows only its inline Uzbek message, so a miss stays clean.

### Spin history (`#/history`)
- The **50 most recent** spins, newest first, persisted across reloads.
- Each row shows the game, the bet, the outcome, the payout and the balance it left
  behind; wheel rows show `Sektor 9` instead of reel symbols, and Mines rows show
  `7 katak · 5 mina` — each game's row says what that game actually decided.
- Lifetime statistics are stored separately from the history, so trimming the list never
  rewrites the player's totals.
- Clearing the history asks for confirmation and reports back with a toast.

### Quality-of-life
- Hash router with clean view toggling, unknown-hash fallback and `aria-current` nav state.
- Toasts for errors, recoveries and confirmations — all in Uzbek.
- Controls lock while a spin is animating (duplicate spins are ignored) and a timeout
  safety net guarantees the cabinet can never stay frozen; a failed animation refunds
  the stake rather than swallowing it.
- `:focus-visible` rings everywhere, reduced-motion and increased-contrast support,
  and a responsive layout down to a 320 px viewport.

---

## Requirements

- A modern browser (see [Browser support](#browser-support)).
- **Nothing else**, to play. The app is static files.

Optional, only for tooling:

| Tool | Needed for |
|---|---|
| Python 3 | serving the app locally (`python3 -m http.server`) |
| Node.js 18+ | running the test suite (`node tests/run-tests.mjs`) |

---

## Installation

There is no install step, no `npm install` and no build:

```bash
git clone <repository-url>
cd soqqa        # the project folder inside the repo
```

If you already have the files, just make sure you are inside the `soqqa/` folder — the one
that contains `index.html`.

---

## Running locally

ES modules are subject to the browser's same-origin policy, so **opening `index.html`
directly from disk (`file://`) will not work** — Chrome, Firefox and Safari all refuse to
load `js/main.js` as a module from a `file://` URL. Serve the folder over HTTP instead.

This is the one failure that makes the whole page look crashed: no module loads, so nothing
is wired, so the spin button does nothing and no state class is ever applied. The page now
reports it instead of sitting there silently — if the app has not booted within 1.8 s, an
on-screen panel appears with the exact command above. It is driven by CSS alone (a delayed
reveal cancelled by `html[data-booted="true"]`, which `js/main.js` sets as the last thing
`boot()` does), because a script could never fire in the very situation it reports. If you
see that panel over HTTP, the module graph failed to load and the browser console will say
which file.

The zero-configuration way, using the standard library:

```bash
cd soqqa
python3 -m http.server 5500
```

Then open **<http://localhost:5500/>**.

If the page looks unchanged after an edit, hard-reload once and check that the stylesheet
URL carries the current version: `index.html` links `style.css?v=N` and `js/main.js?v=N`,
and bumping `N` is what guarantees a browser holding a cached copy is handed the new file
rather than the one it already has. A test fails if the two tokens ever disagree.

Any other static file server works identically — pick whichever you already have:

```bash
# Node, if you prefer
npx --yes serve -l 5500 .

# PHP
php -S localhost:5500
```

Also wired up as a shortcut in `package.json`:

```bash
npm run serve     # → python3 -m http.server 5500
```

Stop the server with `Ctrl+C`.

---

## Deployment

There is no build step, no bundler and no server-side code: the folder **is** the
deployable artifact. Copy `soqqa/` anywhere that serves files over HTTP and it runs.

### Subfolder safety

Every asset URL in `index.html` is relative — `style.css?v=N`, `js/main.js?v=N`, and own
module imports that are all `./`-relative — and there is **no leading `/` anywhere** in the
HTML, CSS or JS. The app therefore works unchanged at a domain root (`https://example.com/`)
or under any prefix (`https://example.com/games/soqqa/`). The favicon is an inline
`data:` URI for the same reason: it needs no path resolution and it removes the automatic
`/favicon.ico` request, which is what keeps the console clean on first load.

### Vercel

`vercel.json` holds the whole configuration:

| Rule | Why |
| --- | --- |
| `cleanUrls` | `/index.html` is served as `/`, so the app's root is one canonical URL |
| hardening headers on `/(.*)` | `nosniff`, a referrer policy, `SAMEORIGIN` framing and a `Permissions-Policy` that switches off geolocation, camera and microphone |
| `immutable` on `css/js/mjs/svg/woff2` | these are the token-versioned files, so a year of caching is safe — the token in the URL is what changes when the content does |
| `max-age=0, must-revalidate` on `/` and `*.html` | the HTML is **not** versioned, so it must never be cached or a new token would never be seen |

That last row is the one that matters: long-caching the assets is only safe because the
document that points at them is always revalidated.

Point the Vercel project at `soqqa/` as its **Root Directory** (it is not the repository
root) and deploy. Because routing is hash-based (`#/slots`), every route is the same
document: there are no rewrites to configure and no 404 fallback to add.

### Any other static host

Netlify, GitHub Pages, Cloudflare Pages, S3, nginx — all identical. Upload the folder; no
configuration is required. On GitHub Pages, serve the `soqqa/` directory as the site root.

### Deliberately not included

- **A Content-Security-Policy.** The app loads Google Fonts and uses inline SVG plus a few
  inline `style` attributes, so a CSP strict enough to be worth having would need a
  nonce/hash inventory that cannot be verified in this repo. A wrong CSP breaks production
  silently, so it is left to the host rather than guessed at here.
- **`og:image`.** The demo ships no raster art, and a preview tag pointing at a file that
  does not exist is worse than no tag at all. The other Open Graph and Twitter tags are in
  `index.html`; add an image alongside them if a card is ever produced.

---

## Project structure

```
soqqa/
├── index.html              # the only page: header, 4 view sections, modal + toast roots
├── style.css               # the whole theme, in 14 numbered sections
├── package.json            # no dependencies — only the test/serve scripts + ESM flag
├── README.md               # this file
│
├── js/
│   ├── config.js           # ← SINGLE SOURCE OF TRUTH: odds, payouts, bets, copy, keys
│   ├── main.js             # bootstrap: storage → store → views → router (exports boot())
│   ├── router.js           # hash router: #/ · #/slots · #/wheel · #/mines · #/history
│   │
│   ├── games/              # pure game maths — never touches the DOM or storage
│   │   ├── betting.js      # shared bet guard (multiple of MIN_BET, inside the ladder)
│   │   ├── mines.js        # 5×5 board: draw, exact hypergeometric odds, cash-out guard
│   │   ├── paytable.js     # slot line evaluation: symbols → paying symbol + multiplier
│   │   ├── slots.js        # 3-reel engine: draw, payout, injectable RNG
│   │   └── wheel.js        # 12-segment engine: segment pick, payout, landing geometry
│   │
│   ├── store/              # the only layer that knows about persistence
│   │   ├── storage.js      # localStorage adapter: never throws, injectable backend
│   │   └── state.js        # central store: balance, history, stats, settings, pub/sub
│   │
│   ├── ui/                 # one DOM concern each — never touches storage or game maths
│   │   ├── balanceView.js  # animated balance chip
│   │   ├── betControls.js  # bet stepper + quick-bet chips + affordability clamping
│   │   ├── confetti.js     # canvas celebration particles (ribbons + additive glints)
│   │   ├── format.js       # number/time/percent formatting (no Intl dependency)
│   │   ├── historyView.js  # history list + empty state
│   │   ├── mineControls.js # the mine-count −/+ stepper and its quick chips
│   │   ├── minesGrid.js    # the 25-tile board: 3D flip, sparks, ribbons, outward reveal wave
│   │   ├── reelPhysics.js  # pure reel maths: strips, travel curve, landing plan
│   │   ├── reelView.js     # reel DOM + frame loop (no maths of its own)
│   │   ├── resultModal.js  # shared win/loss overlay, tier ladder, focus trap
│   │   ├── statsView.js    # stat tiles
│   │   ├── symbolArt.js    # vector-symbol helpers (sprite ids + inline art)
│   │   ├── toast.js        # transient Uzbek notifications
│   │   ├── wheelPhysics.js # pure wheel maths: travel curve, landing rebound, pin flick
│   │   └── wheelDisc.js    # ruby/gold face + lamp ring + rAF rotation + lit wedge
│   │
│   ├── views/              # the only place store + engine + UI meet
│   │   ├── minesView.js    # round controller for Mines (start → turn → cash out)
│   │   ├── slotsView.js    # spin controller for the slots
│   │   └── wheelView.js    # spin controller for the wheel
│   │
│   └── utils/
│       └── rng.js          # seeded/weighted random helpers
│
└── tests/                  # dependency-free Node suites
    ├── run-tests.mjs       # runner (npm test)
    ├── helpers.mjs         # assertion helpers + failing/blocked storage doubles
    ├── fakeDom.mjs         # minimal DOM shim so real UI modules run under Node
    ├── state.test.mjs      # store, persistence, corruption, quota
    ├── slots.test.mjs      # slot engine maths + seeded determinism
    ├── rtp.test.mjs        # exact RTP audit over all 343 symbol combinations
    ├── mines.test.mjs      # board odds vs BigInt, the RTP grid, draw bias, round guards
    ├── mines-ui.test.mjs   # end-to-end Mines round through the UI layer
    ├── wheel.test.mjs      # wheel engine maths, landing geometry, exact RTP
    ├── wheel-physics.test.mjs # exact wheel trajectory, the tick, the pin flick curve
    ├── wheel-band.test.mjs    # the rim light band: gain, clamp, blinks per pass, settle
    ├── wheel-cabin.test.mjs # rim/bulb/pin/knob markup + the built face geometry
    ├── wiring.test.mjs     # DOM selector contract + import graph
    ├── symbols.test.mjs    # vector artwork, sprite refs, cabinet lighting contract
    ├── reel-physics.test.mjs # exact reel trajectory, landing plans, strip coverage
    ├── ui-flow.test.mjs    # end-to-end slots spin through the UI layer
    ├── wheel-ui.test.mjs   # end-to-end wheel spin through the UI layer
    ├── boot.test.mjs       # main.js boot smoke test
    └── release.test.mjs    # docs, Uzbek typography, console + responsive floors
```

---

## Architecture

One rule per layer, enforced by convention and by the wiring test:

```
                     ┌──────────────────────────────────────────────┐
   index.html ──────▶│  config.js   (odds, payouts, copy, keys)     │
                     └──────────────────────────────────────────────┘
                                        │
        ┌───────────────┬───────────────┼───────────────┬──────────────┐
        ▼               ▼               ▼               ▼              ▼
   games/*          store/*          ui/*           views/*        router.js
  pure maths      persistence      DOM only      the wiring      hash routing
  no DOM          no DOM          no storage     all three       no logic
  no storage      no maths        no maths
                                        │
                                        ▼
                                   main.js  (boots and connects everything, once)
```

| Layer | May do | Must never do |
|---|---|---|
| `js/config.js` | hold every tunable number and Uzbek string | contain logic |
| `js/games/*` | pure maths on plain values | touch the DOM, storage, or `Date.now()` |
| `js/store/*` | persist and validate state, publish events | touch the DOM or compute payouts |
| `js/ui/*` | read/write its own elements | touch storage or game maths |
| `js/views/*` | orchestrate one screen | own persistence or payout rules |
| `js/utils/*` | pure helpers (seeded and weighted RNG) | touch the DOM, storage or config |

**Adding another game** means: describe it in `config.js`, add a pure engine under
`js/games/`, add its DOM pieces under `js/ui/`, add a controller under `js/views/`, mark
the section with `data-view="/your-route"` in `index.html`, and register it in `main.js`.
Nothing else needs to change — Mines went in exactly that way, down to reusing the shared
bet selector, the shared overlay and the store's own history record.

---

## Game logic and economy

Everything below lives in `js/config.js`. Retune the game by editing that one file — the
UI, the paytable panel and the legend all re-render from it, and the test suite fails if
the maths drifts out of band.

### Slots

One independent weighted draw per reel. `weight` is the relative chance per reel, and the
weights total 100.

| Symbol (art) | Name | Weight | Three of a kind | First two |
|---|---|---:|---:|---:|
| gold star | Yulduz (wild) | 5 | ×50 | — |
| golden 7 | Yettilik | 6 | ×60 | ×10 |
| faceted gem | Olmos | 9 | ×38 | ×6 |
| golden bell | Qo'ng'iroq | 12 | ×18 | ×5 |
| clover | Yonca | 15 | ×8 | ×2 |
| cherries | Gilos | 19 | ×4 | ×1.5 |
| SOQQA coin | Soqqa | 34 | ×2 | — |

All seven are vector art (`#soqqa-sym-<id>` in the `index.html` sprite); the table above
names the drawing rather than a font glyph, because the drums no longer depend on emoji
rendering at all.

- Wilds substitute for any symbol but never for each other — so `wild + wild + coin` pays
  as a coin triple, not as a wild triple.
- **Exact RTP 90.66 %**, hit rate **20.65 %**, biggest possible win **×60**.
- Multipliers apply to the stake; payouts are rounded in the player's favour.

### Omad charxi (wheel)

12 segments, clockwise from 12 o'clock, one every 30°. `weight` is the chance of landing
on that segment; the wedges are drawn in the same order, so the odds and the picture can
never disagree.

| # | Multiplier | Weight | Chance |
|---:|---:|---:|---:|
| 1 | ×0 | 19 | 19 % |
| 2 | ×1.2 | 4 | 4 % |
| 3 | ×0 | 18 | 18 % |
| 4 | ×1.5 | 6 | 6 % |
| 5 | ×0 | 18 | 18 % |
| 6 | ×2 | 5 | 5 % |
| 7 | ×0 | 18 | 18 % |
| 8 | ×1.2 | 3 | 3 % |
| 9 | ×3 | 4 | 4 % |
| 10 | ×5 | 2 | 2 % |
| 11 | ×10 | 2 | 2 % |
| 12 | ×20 | 1 | 1 % |

- **Exact RTP 0.894**, hit rate **27 %**, jackpot **×20** at 1 %.
- Spin choreography: 4–6 full turns, ≤13° landing jitter (always inside the paid wedge),
  4 200 ms rotation, 160 ms when reduced motion is on.

### Mines

The board is 25 tiles and the player picks the mine count, so there is no multiplier table
to keep in sync — the ladder *is* the geometry. After `k` safe reveals:

```
P(k)         = C(25 − mines, k) / C(25, k)      # the hypergeometric draw, without replacement
multiplier(k) = floor( 0.97 / P(k) × 100 ) / 100  # floored, so the printed number is the paid number
```

- `MINES.edge` (**0.97**) is the only margin in the game, and it is *per cash-out point*
rather than per round: the expected return of banking after any number of reveals is the
same 97 %, so no number of reveals is a better bet than another.
- `P(k)` is computed as a **chain of ratios** rather than one binomial division, which is
the form that survives a larger board — and is accurate to **6.5 × 10⁻¹⁶** relative against
exact BigInt arithmetic at all 300 legal (mine count, reveals) pairs.
- Nothing can drift: the panel, the preview, the floating ribbon and the payout all call the
same `minesMultiplier()`. `tests/mines.test.mjs` audits every rung against the exact
probability and fails if the return ever leaves the band.
- The mine count is bounded by the board: **1 … 24** on 25 tiles, so at least one tile is
always safe. Quick chips offer 1 · 3 · 5 · 10 · 24, and the default is 3.
- A round is over the moment a mine is hit or the player cashes out, and the payout comes
from exactly one place — the engine's `cashOut()`, which closes the round *before* it
computes anything to pay.

### Betting

- Ladder: **1 000 · 5 000 · 10 000 · 25 000 · 50 000 · 100 000 · 250 000** soqqa.
- Quick-bet chips: 1 000 · 5 000 · 25 000 · 100 000.
- A bet is only legal when it is a whole multiple of 1 000 and within the ladder; bets
  above the balance are rejected before any coins move.
- The bet is deducted *before* the animation and the payout credited after it, through a
  single store API that refuses anything that would push the balance below zero.
- The last bet used is remembered across reloads.

### Animation timings

Slots: all three drums start together (they share one motor) and each runs its own
four-phase timeline, arriving at **1 800 / 2 300 / 2 800 ms**.

| Phase | Drum 1 (1 800 ms) | Drum 2 (2 300 ms) | Drum 3 (2 800 ms) |
|---|---|---|---|
| Acceleration (smoothstep into full speed) | 0–500 | 0–500 | 0–500 |
| Full speed (drums at their top rate) | 500–896 | 500–1 048 | 500–1 200 |
| Brake (long, `(1-u)^1.35` decay) | 896–1 461 | 1 048–1 830 | 1 200–2 200 |
| Landing (overshoot → rebound → settle) | 1 461–1 800 | 1 830–2 300 | 2 200–2 800 |

Each turn covers **24–37 cells** (one to three full cycles) at a top speed of about
**22–30 cells per second**, so the drawn symbol is plainly visible travelling down the
drum before it arrives. The loop drives everything from wall-clock time, so a dropped
frame can never stretch the schedule, and because there is no blur to hide behind the
deceleration has to be real: by the time a drum hands over to its landing beat it is
crawling at **under half** its top speed.

The landing is a damped oscillation: the drum runs a fraction of a cell past the line,
rebounds to about **53 %** of that, swings back to **20 %**, and micro-settles to **3 %**
before the residue hits exactly zero — so the resting offset is the cell the engine drew,
not an approximation of it. The drum housing takes the same bounce at pixel scale, and on a
paying turn the glass glints and the winning cells take a golden ring; `--reel-lock-ms` is
written per drum so that cue matches each drum's own landing beat
(`REEL_TURN.phases.landingMs` is the reference value the stylesheet carries and the tests
compare against).

A full spin resolves at **≈ 2.86 s** (2 800 ms + a 60 ms settle before the result is
revealed), the balance counts up over 520 ms, and the UI lock has a hard 3 200 ms ceiling
so a dropped frame or a backgrounded tab can never deadlock the cabinet.

The trajectory is pure maths (`js/ui/reelPhysics.js`), so `tests/reel-physics.test.mjs`
asserts it exactly — monotonic travel, a continuous hand-off, the overshoot and rebound
amplitudes, and an exact landing — for every drum, every symbol and every starting cell,
rather than by watching frames.

### Celebration thresholds

**Every paying spin celebrates.** The moment the last reel stops, the winner gets the
confetti burst and the overlay; what the multiplier changes is how loud it is.

| Multiplier | Title | Explosion |
|---|---|---|
| any win | `Tabriklaymiz!` | gold/neon burst + golden ring on the winning symbols, and on the wheel a pulsing gold sector over the wedge the pointer stopped on |
| slots ×10+, wheel ×5+ | `Katta yutuq!` | bigger burst, cabinet bloom, band of light across the glass, the wheel's drum bloomed and all 24 lamps put onto the odd/even strobe |
| slots ×50+, wheel ×20 | `Jekpot!` | a fan of three bursts, double sweep, the tightest bloom |

The burst hides nothing: the ladder lives in `celebrationFor()` next to the overlay, so the
cabinet's own fallback (when no overlay is available) is the identical one. Below the
paying line nothing at all fires — a losing stop leaves the cabinet exactly as dark as it
was before the spin.

---

## LocalStorage

All keys are namespaced and versioned under **`SOQQA.v1`**, so a future schema can migrate
without guessing which generation of data it is looking at.

| Key | Contents |
|---|---|
| `SOQQA.v1.balance` | `{ "coins": 1000000, "updatedAt": 1757000000000 }` |
| `SOQQA.v1.history` | array of round records, newest first, max 50 |
| `SOQQA.v1.stats` | lifetime counters (survive history trimming) |
| `SOQQA.v1.settings` | `{ "lastBet": 1000 }` |

A round record looks like this. All three games share one record shape, and each fills only
the fields its own game decided — the other games' fields stay `null`:

```jsonc
{
  "id": "spin_1757000000000",
  "game": "slots",              // "slots" | "wheel" | "mines"
  "bet": 5000,
  "symbols": ["seven", "seven", "coin"],  // slots only
  "line": "seven",              // the paying symbol, or null
  "matchType": "three",         // "three" | "two" | null
  "segmentIndex": null,         // 0–11 for wheel rounds, null otherwise
  "mines": null,                // how many mines the board hid, for mines rounds
  "tiles": null,                // how many tiles were turned over, for mines rounds
  "multiplier": 10,
  "payout": 50000,
  "net": 45000,
  "outcome": "win",             // "win" | "loss"
  "balanceAfter": 1045000,
  "timestamp": 1757000000000
}
```

A mines record for a three-mine round cashed out after seven tiles reads
`"game": "mines", "mines": 3, "tiles": 7, "multiplier": 2.73`. Both numbers are validated
on the way back in: the mine count is snapped into the board's legal range and the tile
count is clamped to the number of tiles that board could actually have left, so a corrupt
record cannot claim more reveals than the board had tiles.

`SOQQA.v1.stats` holds:

```jsonc
{
  "totalSpins": 0, "slotsSpins": 0, "wheelSpins": 0, "minesRounds": 0,
  "totalBet": 0, "totalWon": 0,
  "biggestWin": 0, "bestMultiplier": 0, "net": 0
}
```

A counter added in a later schema is treated as `0` on an older save rather than discarding
the player's lifetime totals.

### How bad data is handled

The storage layer (`js/store/storage.js`) is the only module that touches `localStorage`,
and **it never throws**. The store (`js/store/state.js`) then validates everything it
reads:

- **Missing keys** → safe defaults (1 000 000 coins, empty history).
- **Corrupt JSON** → the value is ignored and the default is used.
- **Wrong types / out-of-range values** → repaired: bets are snapped onto the ladder,
  negative payouts dropped, unknown symbols discarded, segment indexes clamped to 0–11.
- **Individual bad history records** → dropped without losing the good ones; a count is
  reported.
- **An older schema** (for example, a save from before the wheel existed) keeps its
  lifetime totals instead of being rebuilt from scratch.
- **Blocked storage** (private mode, disabled cookies) → the app silently switches to an
  in-memory backend and keeps working for the session.
- **Quota exceeded / write failures** → the game continues in memory and the player is
  told, in Uzbek, that changes could not be saved.

Anything that had to be repaired is reported through `getRecoveryReport()` and surfaced
to the player as a toast at boot, rather than failing silently.

### Resetting your data

Open DevTools → Application → Local Storage → `http://localhost:5500` and delete the
`SOQQA.v1.*` keys, or press **Demo balansni tiklash** in the footer to reset just the
balance. Then reload.

---

## Uzbek text and typography

All player-facing text is Uzbek, and `<html lang="uz">` tells the browser (and screen
readers) so.

- Every string is centralised in the `COPY` object in `js/config.js` — including the
  win/loss templates and the modal copy — so wording is changed in one place.
- The **typographic apostrophe `’` (U+2019)** is used consistently in `o’yin`, `g’altak`,
  `So’nggi`, `Boshlang’ich`, `ko’ring` and friends. In the HTML it appears as a literal
  `’`; in JavaScript it is written as the `\u2019` escape so the source stays ASCII-safe.
  A plain ASCII `'` is never used inside a word, and `tests/release.test.mjs` fails the
  build if one creeps back in.
- Numbers are grouped with a space (`1 000 000`), never a comma, and formatted by
  `js/ui/format.js` without relying on `Intl`, so the output is identical in every browser.

Glossary of the main UI terms:

| Uzbek | Meaning |
|---|---|
| `Balans` / `Demo balans` | balance / demo balance |
| `soqqa` | coin (also the app's name) |
| `Aylantirish` | spin |
| `Tikish miqdori` | bet amount |
| `Yutuq jadvali` | paytable |
| `Koeffitsiyentlar` | multipliers |
| `Omad charxi` | wheel of fortune |
| `Sektor` | segment |
| `Aylanishlar tarixi` | spin history |
| `Yutuq!` / `Katta yutuq!` / `Jekpot!` | win / big win / jackpot |
| `Yutuq yo'q` | no win |

There is deliberately **no** vocabulary for deposits, withdrawals or payments anywhere in
the codebase — `tests/wiring.test.mjs` asserts that.

---

## Responsiveness and accessibility

- **Fluid layout**: `min(1200px, …)` shells, `minmax(0, 1fr)` grid tracks and `clamp()`
  type, so nothing overflows horizontally at any width.
- **Breakpoints** at 1024 px (single-column game layout) and 640 px (compact header with a
  scrollable nav, single-column tiles, full-width spin button, history rows collapsed to
  their essential columns, result modal becomes a bottom sheet).
- **The wheel** is sized with `--wheel-size: min(384px, 82vw)` so it scales with the
  viewport, and the result modal is height-bounded and scrollable so a tall win panel can
  never clip its own buttons on a short landscape screen.
- **Touch targets** are ≥ 44 px for the stepper buttons, bet chips and primary actions.
- **Motion**: `prefers-reduced-motion` drops the reel travel, the housing nudge, the
  confetti, the sheen sweeps, the ring pulse, the wheel's odd/even strobe and
  its frame spill, and the transitions. The bands still land on the engine's exact symbols
  and the wheel still lands on the correct segment — they just arrive at once, and the win
  highlight survives. The spin's own chase needs no entry there: it is script-driven, and
  the reduced-motion spin is a single short hop, so the band barely moves.
- **Contrast**: `prefers-contrast: more` lifts the muted text and border tones.
- **Keyboard**: every control is a real button, focus is always visible, the modal traps
  Tab, Escape closes it, and focus returns to the button that opened it.
- **Screen readers**: `aria-live` regions for the spin summary and toasts, `aria-label` on
  icon-only controls, `aria-current="page"` on the active nav link and `aria-hidden` on
  decorative icons and canvases.
- **No stray text chrome.** Nothing outside a real form control is selectable, shows a
  caret or offers a text I-beam, so a drag across a title, a label, a card, a reel or the
  empty space between them can never sweep a highlight or blink a caret, and a tap on a
  touch screen cannot flash a highlight box. That guarantee is deliberately built twice,
  because the declaration alone is not enough:
  - **The declaration.** `user-select: none`, `caret-color: transparent` and
    `cursor: default` sit on `*` in the reset rather than on `body`, because the I-beam a
    browser offers over text comes from the user agent: a declaration on the element
    itself always outranks it, an inherited one is not guaranteed to. Links and buttons
    get their pointer back through an explicit allowlist — load-bearing, not decorative,
    since an author `cursor` on `*` would otherwise beat the UA rule that gives a link
    its hand. The opt-in for real controls is equally explicit: `input`, `textarea`,
    `select` and `contenteditable` restore `user-select: text`, a live caret and the
    native I-beam, and they must state `text` rather than `auto`, because `auto` resolves
    to the parent's used value and would inherit the `none`.
  - **The event guard** (`js/ui/chrome.js`). An engine can still let a selection drag
    begin, and a double- or triple-click never starts one at all, so the same rule is
    enforced at the event level: capture-phase `selectstart` and `dragstart` cancel a
    drag into the chrome, and `mousedown` cancels a multi-click before it selects a word
    or a paragraph. A *single* click is left strictly alone on purpose — cancelling it
    would cancel the focus it performs and break keyboard flow — and all three step
    aside for anything genuinely editable. `tests/chrome.test.mjs` drives the real
    handlers rather than reading the source.

To check it yourself: open DevTools → Device Toolbar and step through 320 / 375 / 768 /
1024 / 1440 px, with the console open.

---

## Testing

The whole suite is dependency-free Node — no test framework, no `node_modules`:

```bash
cd soqqa
npm test                    # or: node tests/run-tests.mjs
```

It prints a per-suite breakdown and exits non-zero if anything fails. Set
`SOQQA_TEST_DEBUG=1` to see a stack trace when a suite crashes.

| Suite | Covers |
|---|---|
| `storage & state manager` | defaults, persistence, corruption repair, trimming, quota, blocked storage |
| `slots engine` | paytable maths, wilds, seeded determinism, 100 000-spin RTP/hit-rate band |
| `payout table audit (RTP)` | exact return-to-player over all 343 reel combinations |
| `wheel engine` | segment odds, landing geometry across 500 spins, exact RTP, distribution |
| `wheel physics (exact)` | the 3–4 s budget, the measured kick, the real peak against the mean, the exact landing on every segment and wobble, the tick past the pin measured on the frame grid (it must never spill into the next wedge), monotonic travel, the damped rebound, the flapper's spring-back and its bounded range, the seat click joining the flicks continuously at both edges and why it is needed (the wobble at the landing is orders too slow to produce a tick) — and then **the stop itself**, audited over every turn count and wobble the engine can draw: that the blend means what its knob says (a straight line at one end, a power decay at the other), that neither extreme ships, that the drum is a genuine creep at the pin, that the brake is **still braking on its last frame** and has not faded away by then, that the drum **never coasts** at a constant speed, that the speed step at the hand-off stays too small to read as a wall, and that the tick is a few degrees |
| `wheel rim band (exact)` | the light band driven by the drum rather than a clock, its configured gain and its clamp biting at real speeds, the head building in with the ramp and holding full strength across the plateau, the band slowing with the wheel and never re-accelerating or rewinding at the pin catch, the flywheel settle reaching a standstill, the ring never being dark (a resting level above zero on the step grid, and the same ring after every spin), the head dissolving back into it, the surge on the catch lifting **every** lamp at once and chattering in two flashes, the travelling head still present as a bias, the flash cadence taken off the band rather than a clock, **one on/off per bulb per pass** over a circular sweep, the two halves held exactly 180° apart, the comet shape (several lamps lit at once, at different strengths), the stepping, and that no 60 Hz frame moves the head more than one bulb |
| `wheel cabin contract` | the rim's four concentric turned rings, its recess and its specular arc, the 24-lamp ring and its one-ring geometry, the lamp/halo sizes that keep the sockets apart and the lit ring continuous, the lamp being lit by the number the view writes rather than by a stylesheet clock, the bulb's response curve evaluated at the resting and headed levels it is actually seen at (a lit-ring floor, and a head most of the way brighter again), the result strobe being a hard `steps(1, end)` switch on **both** halves of the ring, 50 % out of phase, keyed off the parity attribute the view writes rather than an `:nth-child` that could silently drift, its cadence agreeing with config to the millisecond, its bright state a real lift and its dark half still a bulb rather than a hole, the flash cadence capped slow enough to resolve on a 60 Hz frame, the backdrop being one soft warm wash and the only atmosphere layer, its peak held in a band rather than at a floor, every light layer reaching transparent inside the 70.71 % at which a round element clips its own gradient, both remaining layers being monotone so that neither can read as a ring and both being one warm hue family, the aura peaking under the drum rather than at a radius of its own, the neon layer being absent along with its keyframes and its reduced-motion entry, the spill onto the panel being a single dim warm pass over a deep black seat, the layered lighting of that well rather than a flat 1 px ring, the aura carrying no filter at all and never animating, the eight-layer outline that keeps every multiplier legible on gold as well as ruby and the shared custom property that stops a state from silently replacing it, the letterless brass knob and the band of the ramp it has to cover, the vector pin, the config↔CSS flick budget and the no-drift fallbacks, that nothing animates the lamps while the drum merely spins, the chase being opacity/transform-only with no filter or shadow in the animated subtree, the win spill, the jackpot tier, and the built face: one wedge per segment, alternating six-stop ruby/gold metal ramps that stay apart at every visible band and carry a chroma floor on the lit bands, a stud on every seam, unique ids and every filling resolving |
| `DOM wiring contract` | every queried selector exists in `index.html`, import graph, styled dynamic classes, the non-selectable chrome and its editable-control opt-in, and the CTA sheen repeating while the pointer rests on the button rather than sweeping once — together with the reason an `infinite` count is safe there, that a pass carries the band out of the clipped box at both ends so the loop seam is off-screen |
| `chrome guards (selection & caret)` | the event-level selection/caret guard: what counts as editable, capture-phase registration, and that a single click still focuses |
| `symbol artwork contract` | sprite coverage, the measured ink box of every symbol against the artboard, the shared-ramp recipe, no filters, cell → sprite wiring, no emoji, dark-at-rest lighting |
| `reel physics (exact)` | strip periodicity and aperture coverage, every landing plan, the full trajectory, the schedule, and the absence of any blur budget |
| `slots UI flow` | end-to-end spin against a stub DOM, sampling the live reels: continuous motion (no teleports), travel distance, crisp scroll (nothing but the offset is written), staggered locks, landing accuracy, locking, duplicate-spin guard, overlay tiers, replay, reduced motion |
| `wheel UI flow` | end-to-end spin: deduction, credit, modal tiers, replay, refund on failure, the drum landing on the engine's exact angle, the pin flick and the ring's marquee driven by the live frame loop — the svetomuzika measured off the **real sockets** (the two halves observed at clearly different brightnesses, and then observed **swapping**, which is the one thing a single shared value can never do), lamps snapped to steps, the whole ring observed surging together on the catch, every lamp returning to its own resting glow rather than to black, each socket carrying the parity its strobe hangs off, and the strobe selector observed reaching **both** halves — and, matched against the real built tree, that every state class the stylesheet hangs an animation off actually reaches its elements |
| `mines engine` | the board's odds against exact BigInt arithmetic at all 300 legal combinations, the multiplier as the floored edge over them, the whole RTP grid, monotone ladders, the draw's bias over 4 000 rounds, the first tile not being protected, the round's edges attacked directly (duplicate reveals, reveals on a dead round, cash-out before a tile, cash-out twice), and the shipped look measured rather than described — the flip's easing solved from the stylesheet and bounded, the spark spray, the ripple against its config, the payout held above every other reading, and the sheen that must be invisible at rest |
| `mines UI flow` | end-to-end Mines round: the HUD re-priced off the engine at the click rather than a turn later, the settings frozen through the round and through the end-of-round reveal, a duplicate click counting once, the payout landing exactly once (and not twice), the loss path revealing all 25 tiles, **the end-of-round wave measured from the tiles' own class changes** (it starts beside the mine, only moves outward, every tile turns once, the beat is held, the median gap matches the config, the hold-back is released), the celebration tier, the balance/history round trip, reduced motion, and every number landing in the same store the other two games use |
| `application boot` | `main.js` boots, exposes `window.SOQQA` and starts at 1 000 000 |
| `release readiness` | README accuracy, Uzbek apostrophes, console hygiene, responsive floors, the production meta (title, the Open Graph and Twitter tags, and no `og:image` pointing at art the demo does not ship), that no asset URL is rooted at the domain so any subfolder deployment works, and the deploy config itself — that it is valid JSON, every header rule is well formed, the token-versioned assets are cached `immutable`, and the document stays `must-revalidate` so a new token is actually seen |

Adding a suite is three lines: create `tests/your.test.mjs` exporting
`runYourTests(suite)`, then register it in the `SUITES` array in `tests/run-tests.mjs`.

---

## Browser support

| Browser | Version |
|---|---|
| Chrome / Edge | 108+ |
| Firefox | 101+ |
| Safari / iOS Safari | 15.4+ |

The floor comes from two modern CSS features: `100dvh` for the mobile-safe overlay and
`conic-gradient` for the wheel's lit winning wedge. Everything else degrades gracefully on
older engines — the modal still scrolls via its `100vh` fallback, and a browser without
`conic-gradient` simply shows a flat wedge highlight instead of a gradient one. The wheel's
face, rim, bulbs and pin are plain SVG, gradients and box-shadows.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Blank page, console says *"Failed to load module script"* | You opened `index.html` from `file://`. Serve it over HTTP (see [Running locally](#running-locally)). |
| A dark panel reads *"O’yin yuklanmadi"* with a `python3 -m http.server` command | The built-in boot fallback: no module ever ran. Either you opened the file from disk, or a module 404s / throws before `boot()` finishes. The console names the file. |
| The page loads but the fonts look plain | Google Fonts is unreachable (offline / blocked). The `Cinzel` + `Inter` stacks fall back to serif and system-ui — gameplay is unaffected. |
| Balance resets on every reload | Storage is blocked (private browsing, or a strict cookie setting). The app switches to in-memory play and warns you with a toast. |
| Everything froze mid-spin | Should be impossible — a safety net clears every timer, seats the drums, unlocks the UI and refunds the stake. If you can reproduce it, that is a bug worth reporting. |
| The wheel legend shows different percentages than the wedges look | By design. The wheel is weighted, not equal-area; the printed percentage is the real chance. |

---

## Not included (on purpose)

- Real money: no deposits, withdrawals, payments or purchases of any kind.
- No accounts, no server, no telemetry, no analytics.
- No frameworks, bundlers, preprocessors or runtime dependencies.

---

## License

Demo project for educational purposes. SOQQA coins have no monetary value.

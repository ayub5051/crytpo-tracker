/* ============================================================================
   SOQQA — configuration (single source of truth)
   ----------------------------------------------------------------------------
   Every tunable number lives here: storage keys, starting balance, bet ladder
   and the slot symbol table (weights + payout table). Changing the economy or
   the odds must never require touching the engine, the store or the UI.
   ========================================================================= */

/* --- App ----------------------------------------------------------------- */
export const APP = Object.freeze({
  name: 'SOQQA',
  schemaVersion: 1,
});

/* --- Storage ------------------------------------------------------------- */
/** Every key is namespaced + versioned so a future schema can migrate safely. */
export const STORAGE_NAMESPACE = 'SOQQA.v1';

export const STORAGE_KEYS = Object.freeze({
  balance: `${STORAGE_NAMESPACE}.balance`,
  history: `${STORAGE_NAMESPACE}.history`,
  stats: `${STORAGE_NAMESPACE}.stats`,
  settings: `${STORAGE_NAMESPACE}.settings`,
});

/* --- Economy ------------------------------------------------------------- */
/** Demo-only coins. No real money, ever. */
export const STARTING_BALANCE = 1_000_000;

/** Spin history is trimmed to this many most-recent records. */
export const HISTORY_LIMIT = 50;

/** Bets must be multiples of MIN_BET inside [MIN_BET, MAX_BET]. */
export const BET_LADDER = Object.freeze([1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000]);
export const MIN_BET = BET_LADDER[0];
export const MAX_BET = BET_LADDER[BET_LADDER.length - 1];
export const DEFAULT_BET = BET_LADDER[0];

/** Amounts shown as quick-bet chips in the cabinet. */
export const QUICK_BETS = Object.freeze([1_000, 5_000, 25_000, 100_000]);

/* --- Slot symbols -------------------------------------------------------- */
/**
 * `weight`  — relative odds of landing on a reel (one independent draw/reel).
 * `triple`  — multiplier when all three reels match the symbol.
 * `pair`    — multiplier when the first two reels match (0 = not paid).
 * `wild`    — substitutes for any other symbol; never substitutes for itself.
 * `emoji`   — a plain-text glyph kept purely as a fallback/label. The drums, the
 *             paytable and the history rows all paint the premium vector artwork
 *             from the sprite in index.html instead (js/ui/symbolArt.js), so no
 *             part of the UI depends on emoji rendering any more.
 *
 * Weights must total 100: see tests/rtp.test.mjs, which enumerates every
 * combination and fails if the return-to-player drifts out of the target band.
 */
export const SYMBOLS = Object.freeze({
  wild: Object.freeze({ id: 'wild', emoji: '⭐', name: 'Yulduz', weight: 5, triple: 50, pair: 0 }),
  seven: Object.freeze({ id: 'seven', emoji: '7️⃣', name: 'Yettilik', weight: 6, triple: 60, pair: 10 }),
  diamond: Object.freeze({ id: 'diamond', emoji: '💎', name: 'Olmos', weight: 9, triple: 38, pair: 6 }),
  bell: Object.freeze({ id: 'bell', emoji: '🔔', name: 'Qo\u2019ng\u2019iroq', weight: 12, triple: 18, pair: 5 }),
  clover: Object.freeze({ id: 'clover', emoji: '🍀', name: 'Yonca', weight: 15, triple: 8, pair: 2 }),
  cherry: Object.freeze({ id: 'cherry', emoji: '🍒', name: 'Gilos', weight: 19, triple: 4, pair: 1.5 }),
  coin: Object.freeze({ id: 'coin', emoji: '🪙', name: 'Soqqa', weight: 34, triple: 2, pair: 0 }),
});

/** Draw order == index order used by the RNG; keep the weights in this order. */
export const SYMBOL_ORDER = Object.freeze(['wild', 'seven', 'diamond', 'bell', 'clover', 'cherry', 'coin']);

export const REEL_COUNT = 3;
export const WILD_ID = 'wild';

/** RTP/hit-rate target used by tests and by the config tuning script. */
export const RTP_TARGET = Object.freeze({ min: 0.85, max: 0.95, nominal: 0.895 });

/* --- Omad charxi (wheel of fortune) -------------------------------------- */
/**
 * 12 segments, clockwise from 12 o'clock: segment `i` is centred on the angle
 * `30 · i` degrees — exactly where the disc paints it, because the view builds
 * its conic-gradient straight from this array. Label, colour and odds can
 * therefore never drift apart.
 *
 * `weight` is the chance of landing on the segment. The visual area is *not*
 * the odds (see PLAN.md §6.2): the wheel is weighted, and the in-app legend
 * prints the real percentage so the game stays honest.
 *
 * Weights must total 100, and the expected return must stay inside
 * WHEEL_RTP_TARGET — tests/wheel.test.mjs audits both across every segment.
 */
export const WHEEL_SEGMENTS = Object.freeze([
  Object.freeze({ multiplier: 0, weight: 19 }),
  Object.freeze({ multiplier: 1.2, weight: 4 }),
  Object.freeze({ multiplier: 0, weight: 18 }),
  Object.freeze({ multiplier: 1.5, weight: 6 }),
  Object.freeze({ multiplier: 0, weight: 18 }),
  Object.freeze({ multiplier: 2, weight: 5 }),
  Object.freeze({ multiplier: 0, weight: 18 }),
  Object.freeze({ multiplier: 1.2, weight: 3 }),
  Object.freeze({ multiplier: 3, weight: 4 }),
  Object.freeze({ multiplier: 5, weight: 2 }),
  Object.freeze({ multiplier: 10, weight: 2 }),
  Object.freeze({ multiplier: 20, weight: 1 }),
]);

/**
 * Spin choreography. Full turns first, then the landing inside the segment.
 *
 * The motion is a closed-form curve rather than a CSS transition, so the
 * landing can be asserted exactly (js/ui/wheelPhysics.js): the wheel ramps up
 * from rest, brakes to a crawl, arrives slightly PAST the target, and the pin
 * flicks it back in a damped rebound that settles exactly on it.
 */
export const WHEEL_SPIN = Object.freeze({
  minTurns: 4,
  maxTurns: 6,
  /** Landing wobble, in degrees. Must stay < half a segment (15°) so the
      pointer can never spill over into the neighbouring segment. */
  jitterDeg: 13,
  /**
   * Total spin length, in ms — the top of the 3–4 s suspense band the cabinet
   * is tuned for.
   *
   * At 4000 ms the travel beat runs 3120 ms and the landing 880 ms. The extra
   * time over the previous 3800 ms is spent in the brake rather than the ramp
   * (which is a share of the travel, so it stays a ~218 ms kick), and it is what
   * turns the last stretch from a deceleration into a slow, heavy wind-down: the
   * drum covers the same total distance, so a longer spin is strictly slower on
   * the way in, never faster anywhere, and the drum is still creeping when the
   * pin catches it rather than arriving with pace to shed.
   *
   * A heavier wheel needs MORE time for the same distance, never fewer turns —
   * the turn count is untouched, so this reads as mass, not as a faster motor.
   */
  durationMs: 4000,
  /** Share of `durationMs` spent travelling; the rest is the landing beat.
      Lowered to 0.78 so a little more of the extra second lands in the slow
      final approach, where the player is actually watching the segments come. */
  brakeShare: 0.78,
  /**
   * How far past the target the wheel ticks before the pin catches it, in
   * degrees. Capped at runtime against the segment's remaining room, so the
   * bounce can never carry the pointer over the edge into the next wedge.
   */
  overshootDeg: 5,
  /** Travel shape: share of the travel spent ramping up, then at full speed. */
  accelShare: 0.07,
  peakShare: 0.16,
  /**
   * The ramp rises as `(u / accelShare) ** rampExponent`. Below 1 it is a KICK:
   * the wheel is at two thirds of full speed a tenth of a second in, the way a
   * heavy drum yanked by a motor behaves, instead of winding up linearly.
   */
  rampExponent: 0.62,
  /**
   * The brake is a BLEND, and the blend is the whole point.
   *
   * A pure power decay — `(1 - u) ** brakeExponent` — has a slope of zero as it
   * reaches the end, so it flattens: past about 60 % of the way through, the
   * drum stops decelerating at all and coasts onto `brakeFloor` at a constant
   * speed. Measured on the previous setting, the deceleration fell to 1/23rd of
   * its opening value and the drum was still doing **half a revolution per
   * second** when the pin caught it — which then had to stop it in a single
   * frame. That coast-then-slam is exactly what reads as "the wheel just stops".
   *
   * `brakeLinearShare` is how much of the brake is instead a CONSTANT
   * deceleration (a straight line in velocity), which is what friction actually
   * gives you: a wheel slows by the same amount every millisecond, so its slope
   * at the catch is not zero and it arrives genuinely creeping.
   *
   *   v(u) = floor + (1 - floor) · d · ((1 - w) + w · d ** (exponent - 1))
   *   where d = (1 - u) / (1 - peakShare)   and   w = brakeLinearShare
   */
  brakeExponent: 3,
  /**
   * Measured, not guessed. Across the last 1.5 s of the brake — the stretch the
   * player is actually watching — a share of 0.55 let the deceleration vary by
   * 2.12×, so the tail read as a curve that kept changing its mind. At 0.78 the
   * same window varies by 1.37×: the wheel sheds speed at a near-constant rate
   * as the pegs come up, which is what friction alone actually does, so the
   * last few segments arrive at a predictable tempo instead of arriving on
   * whatever the curve happened to be doing. The remaining 22 % of decay is
   * what keeps the drum from feeling like it is running on rails.
   */
  brakeLinearShare: 0.78,
  /**
   * ...onto a floor, so the wheel is still creeping when the pin catches it.
   * Deliberately small. A flapper is a light spring-loaded arm: it can only stop
   * a wheel that is nearly stopped, so a floor high enough to leave the drum at
   * a visible spin makes the catch a collision rather than a catch.
   */
  brakeFloor: 0.03,
  /**
   * Damping and swing count of the landing rebound, in normalised landing time.
   * Lowering the damping softens the very first frame of the rock-back, which is
   * the other half of the hand-off: the smaller the gap between the speed the
   * drum arrives at and the speed the rebound starts at, the less the catch
   * reads as a wall.
   */
  landingDamping: 2,
  landingSwings: 2,
  /** Angular velocity (deg/ms) at which a spoke deflects the pin fully. */
  pinFullFlickSpeed: 0.9,
  /**
   * The exponent the flick's speed gate is raised to.
   *
   * A linear gate is wrong at exactly the moment the stop has to sell itself: it
   * fades the arm out as the wheel crawls, so the last few pegs — the ones you
   * are waiting for — tick against a pin that has gone limp. A real flapper is
   * the other way round. It is a spring loaded arm that each peg has to lift, so
   * at speed it rides the pegs and blurs, while at a crawl it flips the whole
   * way, deliberately, bulb by bulb, all the way down to the stop. Below 1 the
   * gate reaches its deflection much earlier in the brake and holds it.
   */
  pinFlickGamma: 0.6,
  /**
   * How far the arm springs BACK past its rest position after a peg has left it,
   * as a fraction of the full deflection. 0 would be a number fading out; this is
   * the overshoot of a real hinged flapper, and it is what makes a tick read as
   * mechanism rather than as decay.
   */
  pinBackswing: 0.3,
  /**
   * The final click, as the drum's rebound dies and the last peg seats against
   * the arm. Delivered as its own short pulse — the wheel's own wobble is only a
   * few degrees, too little to generate a tick on its own, and a machine that
   * stops without that last click does not sound or look finished. `Ms` is how
   * long before the end of the spin the pulse runs; `Depth` is its share of the
   * full deflection.
   */
  pinSeatClickMs: 300,
  pinSeatClickDepth: 0.6,
  /** How far the pin swings when a spoke passes under it, in degrees. Read by
      style.css as `--wheel-pin-flick`; a test fails if the two ever drift. */
  pinFlickDeg: 13,
  /** Rotation length when the player prefers reduced motion. */
  reducedMotionDurationMs: 160,
  /** Grace period after the rotation before the win highlight lands. */
  settleDelayMs: 260,
});

/**
 * Presentation of the brass frame around the wheel (see style.css §9), and the
 * schedule its marquee lamps blink on.
 *
 * The ring is NOT on a timer. A CSS keyframe chase cannot follow the drum — its
 * duration is fixed, and re-timing a running animation every frame makes the
 * phase jump, which is exactly the stutter a marquee must never have. So
 * js/ui/wheelDisc.js integrates the light band's angle from the drum's own
 * angular velocity, frame by frame: the chase *is* the rotation, it travels the
 * way the drum turns, and it slows with it continuously, with no phase jump
 * anywhere. Only the result chase — which is a steady loop at a fixed cadence,
 * not a physical quantity — is left to the stylesheet, where it costs no script
 * at all.
 */
export const WHEEL_FRAME = Object.freeze({
  /** Bulbs studded around the rim. Even numbers chase cleanly. */
  bulbCount: 24,
  /** How far out the lamps sit, in face-artboard units (the disc is 100 wide). */
  bulbRadius: 47.4,

  /* --- the ring at rest --------------------------------------------------
     A marquee bulb is never dark. The ring of a powered machine holds a warm,
     even glow between spins, and the chase is something it does ON TOP of that
     — which is the difference between a cabinet that is switched on and one
     whose lights have simply gone out. `idleLit` is that resting brightness
     (0 = dark, 1 = full); `idleVariation` is the small difference a real row of
     bulbs always has from one another, so the ring is not a perfect circle of
     identical dots. Both must land exactly on the `litLevels` grid below, or a
     bulb's resting state and its chased state would step differently — a test
     fails if they drift. */
  idleLit: 0.25,
  idleVariation: 0.125,

  /* --- the travelling light band ---------------------------------------- */
  /** How far the band sweeps, in degrees: a sharp head with a long tail. */
  sweepArcDeg: 118,
  /** Its brightness falls off behind the head as `(1 - d / arc) ** tailExponent`,
      which is what turns a moving gap into a comet: a bright head leading a
      long dim tail, so several bulbs are lit at once, at different strengths. */
  tailExponent: 1.6,
  /** The band travels this many times the drum's surface speed… */
  chaseGain: 1.6,
  /** …clamped to rev/s, so a fast drum does not turn the ring into a blur. */
  chaseMaxRevPerSec: 1.7,
  /** How many brightness steps a lit bulb is snapped to. The head travels
      several bulbs per frame at full speed, so snapping costs nothing visible
      and buys two things: the ring steps rather than fades (which is what a row
      of real bulbs does), and a bulb only has to be re-styled on the frames it
      actually crosses a step — a handful of writes per frame instead of 24. */
  litLevels: 8,
  /**
   * How long the flywheel takes to stop the lights once the pin catches it, in
   * ms — measured from the catch, not from the end of the rotation. The band's
   * rate decays as `(1 - s) ** settleRateDecay`, so the comet winds down with
   * the drum; its brightness decays as `(1 - s) ** settleFadeDecay`, so the head
   * dissolves back into the resting ring it came out of. It therefore adds no
   * time to the spin: the lights sit down with the wheel, which is the point.
   *
   * The fade exponent is deliberately above 1. A sub-1 exponent collapses the
   * head in the first frames and leaves the ring flat for the rest of the
   * landing — the light is over before the wheel is. Above 1 the head holds its
   * shape while the drum rocks back and lets go right at the end, so the two
   * arrive together.
   */
  settleMs: 560,
  /** Its rate decays as `(1 - s) ** settleRateDecay`, so it ends at a standstill. */
  settleRateDecay: 1.6,
  /** ...and its brightness as `(1 - s) ** settleFadeDecay`, so it ends at rest. */
  settleFadeDecay: 1.4,
  /**
   * The surge every bulb gives the instant the pin stops the wheel — locked
   * cabinet, one heavy clunk, light. It decays over `settleFlickMs` as
   * `settleFlickCount` flashes, added to the whole ring at once, and it is the
   * one part of the stop the drum's own motion cannot produce: a warm pulse
   * that says the machine has caught, not just that its animation ended.
   */
  settleFlickDepth: 0.3,
  settleFlickMs: 420,
  settleFlickCount: 2,

  /* --- the result chase -------------------------------------------------
     Once the drum has settled and a paying stop is confirmed, the ring hands
     over to a steady chase at a fixed cadence: a loop, so it costs no script. */
  /** One full strobe while a win is celebrated, in ms — a hard square wave, so
      odd and even bulbs are opposite halves of it. */
  strobeMs: 420,
  /** …and for the top tier, which is quicker and brighter. */
  strobeFastMs: 220,

  /* --- svetomuzika: the odd/even flash ---------------------------------
     The marquee of a real cabinet is not a single head of light running round
     the ring: it is the two halves of the ring FLASHING against each other —
     odd bulbs lit while even bulbs are out, then the other way round, over and
     over. That is "svetomuzika", and it is the effect a player recognises
     instantly as a casino machine rather than as a progress bar.

     It is still driven by the wheel, though. The flash is not a timer: its
     cadence is read from the SAME integrated band angle the travelling head
     uses (`bandRate`, geared off the drum and clamped), so the ring flashes
     faster as the wheel winds up, slows as it slows, and dies away with it —
     one flash per `flashStepDeg` of band travel. */
  /** How far the band turns between flashes, in degrees. The band is clamped to
      `chaseMaxRevPerSec`, so this sets the fastest the ring can flash: 90° at
      the clamp is 6.8 flashes a second, which still resolves cleanly on a 60 Hz
      frame (a flash lasts ~4 frames, so it can never alias into a blur). */
  flashStepDeg: 90,
  /** How far the alternation swings a bulb, 0…1. The two halves of the ring sit
      at `flashDepth` and `1 - flashDepth` of the drive, so the higher this is,
      the harder the split between lit and unlit bulbs. */
  flashDepth: 0.82,
  /**
   * How much of the bulb's brightness comes from the travelling head rather than
   * from the alternation. It is kept low — the flashing is the main event — but
   * non-zero on purpose: a light that travels the way the drum turns is what
   * makes the ring legible as a WHEEL turning rather than as a ring blinking.
   */
  headGain: 0.34,
});

/** Multiplier at/above which a wheel result counts as a "significant win". */
export const WHEEL_BIG_WIN_MULTIPLIER = 5;
/** The top segment — gets its own modal title and the biggest celebration. */
export const WHEEL_JACKPOT_MULTIPLIER = 20;

export const WHEEL_RTP_TARGET = Object.freeze({ min: 0.85, max: 0.95, nominal: 0.894 });

/** Uzbek flavour text shown next to each multiplier in the legend. */
export const WHEEL_LEGEND_NOTES = Object.freeze({
  '0': 'yutuq yo\u2019q',
  '1.2': 'tez-tez',
  '1.5': 'tez-tez',
  '2': 'o\u2019rtacha',
  '3': 'o\u2019rtacha',
  '5': 'kam uchraydi',
  '10': 'juda kam',
  '20': 'jekpot',
});

/* --- Mines (5x5 xazina o'yini) ------------------------------------------- */
/**
 * The board is `columns x rows` tiles and the mine count is the player's
 * choice, so the payout ladder cannot be a hand-written table: it has to be the
 * actual geometry of the board. A round survives `k` reveals when all `k` picks
 * missed the mines, which happens with probability
 *
 *     P(k) = C(size - mines, k) / C(size, k)
 *
 * and the multiplier is `edge / P(k)`. That single line means the odds can never
 * drift away from the board: change the grid size or the mine count and every
 * multiplier moves with it. js/games/mines.js computes P(k) as a product of
 * ratios rather than with factorials, so it stays exact at any size.
 *
 * `edge` is the only house margin in the game: it is what is left of the stake
 * in expectation after the multiplier is applied, so the return-to-player of
 * cashing out after any number of reveals is identical — `edge`. That property
 * is asserted in tests/mines.test.mjs for every legal mine count at every legal
 * number of reveals, which is a far stronger statement than one aggregate RTP.
 */
export const MINES = Object.freeze({
  columns: 5,
  rows: 5,
  /** At least one tile must be safe, so 24 is the ceiling on a 25-tile board. */
  minCount: 1,
  maxCount: 24,
  defaultCount: 3,
  /** Counts shown as quick chips. Must stay inside [minCount, maxCount]. */
  quickCounts: Object.freeze([1, 3, 5, 10, 24]),
  /** Return-to-player target: `multiplier = edge / P(all picks were safe)`. */
  edge: 0.97,
  /**
   * Multipliers are FLOORED to this many decimals rather than merely displayed
   * rounded: the number the HUD prints is then exactly the number the payout is
   * computed from, so "pays exactly what it showed" is true by construction
   * rather than by a rounding coincidence. Flooring can only ever round the
   * house's way, which is why it does not break the RTP assertion above.
   */
  multiplierDecimals: 2,
  /** At/above this multiplier a cash out is promoted to a "big win" banner. */
  bigWinMultiplier: 5,
  /**
   * Choreography. `flipMs` is written into the grid as `--mines-flip-ms`, so the
   * stylesheet transition and the view's own timer can never disagree about how
   * long a tile takes to turn; `staggerMs` is the gap between the starts of two
   * tiles in the end-of-round reveal, capped so `settleBudgetMs` is never
   * exceeded no matter how many tiles are left to turn.
   *
   * The turn is deliberately unhurried — 460 ms on a curve that tips a degree or
   * two past the upright and settles back — because the weight of the lid is
   * what sells it as metal rather than a class swap. `revealLeadMs` is the beat
   * of silence after the mine lands, before the wave starts: without it the
   * board starts turning in the same frame as the hit and the hit reads as just
   * one more tile.
   */
  flipMs: 460,
  staggerMs: 130,
  settleBudgetMs: 1_700,
  minStaggerMs: 46,
  revealLeadMs: 240,
  /**
   * How many gold sparks a revealed gem throws, and how long each waits for the
   * one before it. The rings are built once per tile by js/ui/minesGrid.js; the
   * count lives here so the board and the stylesheet agree on the spoke angles.
   */
  gemSparks: 4,
  /** Gap between two tiles in the cash-out ripple, written as --mines-ripple-step. */
  winRippleStepMs: 38,
  /** Tile flip/float length when the player prefers reduced motion. */
  reducedMotionMs: 0,
});

/** Tiles on the board — the denominator of every probability above. */
export const MINES_BOARD_SIZE = MINES.columns * MINES.rows;

/* --- Reel choreography --------------------------------------------------- */
/**
 * The drums are real scrolling strips, not swapped symbols (see
 * js/ui/reelView.js): each one slides a long, fixed column of artwork behind a
 * three-row aperture, driven by a numeric offset. Nothing in a strip is ever
 * re-painted, so the symbol the engine drew is physically carried onto the
 * payline by the motion itself.
 *
 * A turn runs four phases. They are specified on the longest drum and then
 * scaled to the shorter ones, so every drum brakes like the same machine:
 *
 *   0.0–0.5 s  ramp     rapid acceleration up to full speed
 *   0.5–1.2 s  peak     flat out, symbols streaming past
 *   1.2–2.2 s  brake    gradual deceleration on a (1 - u) ** exponent decay
 *   2.2–2.8 s  landing  slow approach → overshoot → rebound → micro-settle
 *
 * The drums are deliberately never blurred: every symbol stays crisp and
 * legible at every frame, and the speed is what sells the motion. There is no
 * `filter` on the strip at all, so the spin is a pure `transform` and the
 * browser can composite it on its own layer (see style.css section 12).
 *
 * `stopAtMs` is the anticipation curve, expressed as absolute times so the
 * pacing is literal: the drums seat on their own beats — 1.8 s · 2.3 s ·
 * 2.8 s — and each one stays locked while the drums to its right keep turning.
 * The result is revealed only once the last drum has settled.
 */
export const REEL_TURN = Object.freeze({
  /** Absolute ms at which each drum is seated on the payline, left → right. */
  stopAtMs: Object.freeze([1800, 2300, 2800]),
  /** Phase lengths of the reference (longest) drum. Sums to stopAtMs[2]. */
  phases: Object.freeze({ rampMs: 500, peakMs: 700, brakeMs: 1000, landingMs: 600 }),
  /** Distance a drum travels per turn, in cell heights (speed and feel). */
  travelMinCells: 24,
  travelMaxCells: 38,
  /** How far past the payline the drum runs before the rebound, in cells. */
  overshootCells: 0.16,
  /** The brake decays as (1 - u) ** this, so the final approach stays gradual. */
  brakeExponent: 1.35,
});

/* --- Reel strip ---------------------------------------------------------- */
/**
 * Each drum renders one long strip and slides it behind the aperture. The strip
 * repeats a 14-cell cycle — every symbol exactly twice, seven cells apart —
 * which buys two guarantees:
 *
 *   • it is *periodic*, so translating it by exactly one cycle is pixel
 *     identical. The position can therefore be wrapped mid-spin (unavoidable
 *     when a drum travels several cycles) without any visible jump.
 *   • any window of 14 consecutive cells contains every symbol exactly twice,
 *     so the symbol the engine drew is always already sitting in the strip and
 *     can always be scrolled onto the payline. Nothing is ever substituted.
 */
export const REEL_STRIP = Object.freeze({
  /** Cells in one cycle: two of every symbol, seven apart. */
  cycleCells: 14,
  /**
   * Rendered cells per drum.
   *
   * The painted position is folded into the band [1, cycleCells + 1) — see
   * js/ui/reelView.js — so the drum only ever shows the window that starts
   * there. The aperture is a pitch taller than one cell
   * (`3·cell + 2·gap = pitch + 2·cell`), so a cell is on screen while
   * `i - position ∈ (-cell/pitch, 1 + 2·cell/pitch)`: under one cell above the
   * position and under three below it. Across the whole band, plus the landing
   * overshoot, that is indices 1…17 at the real cell/gap ratio and 0…17 in the
   * pathological case of a zero gap — so 18 cells cover every position, with
   * one row to spare in practice.
   *
   * Deliberately the smallest strip that works rather than a generous one:
   * every extra cell is another node to lay out and another row inside the
   * translated layer the spin moves each frame.
   */
  cells: 18,
});

/* --- Animation ----------------------------------------------------------- */
export const ANIMATION = Object.freeze({
  /** ms after the last drum is seated before the result is revealed. */
  settleDelay: 60,
  /** ms of the balance count-up animation. */
  balanceCountUp: 520,
  /** Hard safety cap: the UI can never stay locked longer than this. */
  maxSpinDuration: 3200,
});

/** Multiplier at or above which the spin counts as a "significant win". */
export const BIG_WIN_MULTIPLIER = 10;

/**
 * Multiplier at or above which a slots win gets the full jackpot light show in
 * the cabinet. Presentation only — the payouts themselves live in SYMBOLS.
 */
export const JACKPOT_MULTIPLIER = 50;

/* --- Messages (Uzbek) ---------------------------------------------------- */
export const COPY = Object.freeze({
  idle: 'Aylantirish tugmasini bosing va g\u2019altaklarni ishga tushiring.',
  wheelIdle: 'Charxni aylantirish tugmasini bosing va omadingizni sinab ko\u2019ring.',
  spinning: 'G\u2019altaklar aylanmoqda\u2026',
  wheelSpinning: 'Charx aylanmoqda\u2026',
  spinFailed: 'Kutilmagan xatolik \u2014 tikish qaytarildi.',
  win: (multiplier, payout) => `Yutuq! \u00d7${multiplier} \u2014 ${payout} soqqa`,
  bigWin: (multiplier, payout) => `Katta yutuq! \u00d7${multiplier} \u2014 ${payout} soqqa \ud83c\udf89`,
  loss: (bet) => `Yutuq yo\u2019q \u2014 ${bet} soqqa yo\u2019qotdingiz`,
  insufficient: (bet, balance) => `Mablag\u2019 yetarli emas: tikish ${bet} soqqa, balans ${balance} soqqa.`,
  invalidBet: 'Tikish miqdori noto\u2019g\u2019ri.',
  balanceEmpty: 'Balans tugadi. Demo balansni tiklab, yana o\u2019ynashingiz mumkin.',
  historyCleared: 'Aylanishlar tarixi tozalandi.',
  balanceReset: (amount) => `Demo balans tiklandi: ${amount} soqqa.`,
  storageRecovered: 'Saqlangan ma\u2019lumot buzilgan edi \u2014 xavfsiz nusxa tiklandi.',
  storageWriteFailed: 'Xotira to\u2019lib qoldi \u2014 o\u2019zgarishlar saqlanmadi.',
  restoreCancelled: 'Amal bekor qilindi.',
  clearConfirm: 'Butun aylanishlar tarixini o\u2019chirib tashlaysizmi?',
  resetConfirm: 'Demo balansni 1 000 000 soqqaga tiklaysizmi?',

  /* --- Result modal ------------------------------------------------------ */
  /**
   * The winning overlay's title ladder. The slots cabinet and the wheel share
   * one overlay, so the same win reads the same way on both games:
   * `modalCongratsTitle` for any ordinary win, `modalBigWinTitle` a step up and
   * `modalJackpotTitle` for the top tier.
   */
  modalCongratsTitle: 'Tabriklaymiz!',
  modalBigWinTitle: 'Katta yutuq!',
  modalJackpotTitle: 'Jekpot!',
  modalLossTitle: 'Yutuq yo\u2019q',
  /**
   * The overlay's second fact row. It is a label/value pair the caller fills, so
   * the same markup serves a wheel segment and a slots symbol line.
   */
  modalSegmentLabel: 'Sektor',
  modalSymbolsLabel: 'Belgilar',
  modalWinMessage: (multiplier, payout) =>
    `${multiplier} koeffitsiyent \u2014 ${payout} soqqa yutdingiz!`,
  modalLossMessage: (bet) => `${bet} soqqa yo\u2019qotdingiz. Keyingi safar omad kulib boqadi!`,
  modalBalance: (balance) => `Balans: ${balance} soqqa`,
  /** "Sektor 7" — 1-based, so it matches what the player sees on the disc. */
  segmentLabel: (index) => `Sektor ${Number(index) + 1}`,

  /* --- Mines ------------------------------------------------------------- */
  /**
   * The label of the mines fact row in the shared result overlay. The overlay
   * prints one label/value pair the caller fills, so this is what turns it from
   * a wheel's "Sektor" into a Mines board reading.
   */
  minesFactLabel: 'Ochilgan kataklar',
  minesFactValue: (tiles, mines) => `${Number(tiles)} ta katak \u00b7 ${Number(mines)} ta mina`,
  /** The history row's middle cell: a mines record has no symbols to show. */
  minesCellLabel: (tiles, mines) => `${Number(tiles)} katak \u00b7 ${Number(mines)} mina`,
  /** Counts in the HUD: "3 / 22 katak" (revealed / available). */
  minesProgress: (revealed, available) => `${Number(revealed)} / ${Number(available)} katak`,
  minesIdle: 'Boshlash tugmasini bosing \u2014 so\u2019ng kataklarni ochib, yutuqni yechib oling.',
  minesActive: 'Katakni oching yoki yutuqni yechib oling.',
  minesSettling: 'Minalar ochilmoqda\u2026',
  minesSafe: (multiplier, payout) => `Katak toza! \u00d7${multiplier} \u2014 hozir yechsangiz ${payout} soqqa.`,
  minesMine: (bet) => `Mina! ${bet} soqqa yo\u2019qotdingiz.`,
  minesCashed: (multiplier, payout) => `Yechib olindi: \u00d7${multiplier} \u2014 ${payout} soqqa`,
  minesNoGems: 'Yechishdan oldin kamida bitta katakni oching.',
  minesCountLabel: 'Mina soni',
  /** The one primary button: it arms a round, and re-arms the next one. */
  minesStart: 'Boshlash',
  minesReplay: 'Yangi o\u2019yin',
  minesBigWin: (multiplier, payout) => `Katta yutuq! \u00d7${multiplier} \u2014 ${payout} soqqa \ud83c\udf89`,
});

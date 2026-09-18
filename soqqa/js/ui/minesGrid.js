/* ============================================================================
   SOQQA — mines board (the 5x5 grid of flipping tiles)
   ----------------------------------------------------------------------------
   The board itself: it builds the tiles, turns them, and reports clicks back
   through a handler. It knows nothing about bets, payouts, history or the
   store — a tile is a coin, and deciding what a coin is worth belongs to
   js/games/mines.js and js/views/minesView.js. That split is what lets the
   board's behaviour be asserted on its own, and what keeps the round's money
   nowhere near the DOM.

   ── Why the tiles are built here rather than written in index.html ──────────
   There are 25 of them and their number comes from `MINES.columns x MINES.rows`.
   A hard-coded 5x5 grid in the markup would be a second copy of the board's
   geometry, free to drift from the sizes the odds are computed against — the
   same reason the wheel builds its own rim lamps and the drums build their own
   strips. The tiles are then held in arrays and never looked up again, so no
   selector in this module depends on markup the browser would have to rebuild.

   ── The flip ───────────────────────────────────────────────────────────────
   One tile is a button holding a `preserve-3d` inner that rotates 180° about Y
   when it is revealed: a closed metal face on the front, the coin on the back.
   Nothing is swapped at the end of the animation — the art is written into the
   hidden face as the turn starts, so what slides into view is the real result
   and the motion is the reveal.

   The turn's length and its easing are the stylesheet's, but the length is
   written from here so it has one home; the easing curve overshoots the upright
   by a degree or two and settles back, which is what gives the lid weight. Each
   tile also carries `--mines-order` (its place on the board, read by the
   cash-out ripple) and a small ring of `--i`-indexed sparks that a gem throws.

   `flipMs` is published to the stylesheet as `--mines-flip-ms` from config, so
   the transition length and the timers below cannot disagree about how long a
   tile takes to turn.
   ========================================================================= */

import { MINES } from '../config.js';
import { symbolSvgMarkup } from './symbolArt.js';

/**
 * The element id of the board's mine artwork, declared in the shared defs block
 * of index.html. Exported so the markup contract test can point at the same
 * name this module actually references — a rename can then never leave the
 * tests checking a glyph nothing uses.
 */
export const MINE_GLYPH_ID = 'sqMineGlyph';

/**
 * Artwork for the mine. It is deliberately NOT part of the slot sprite: that
 * sprite is one `<symbol>` per entry in SYMBOLS and tests/symbols.test.mjs
 * enforces the one-to-one mapping, so a board glyph would be an orphan there.
 * It is instead a `<g id="sqMineGlyph">` in the shared defs block of
 * index.html, inlined through the same `<use>` mechanism the symbol art uses.
 */
export function mineSvgMarkup(className = 'mines-tile__art') {
  return (
    `<svg class="${className}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">` +
    `<use href="#${MINE_GLYPH_ID}"></use></svg>`
  );
}

/** The symbol sprite already has a premium brilliant-cut diamond. */
export const GEM_SYMBOL_ID = 'diamond';

/** Await a real timer. Kept local so the module has no other dependency. */
const wait = (ms) =>
  new Promise((resolve) => {
    if (!(ms > 0) || typeof setTimeout !== 'function') resolve();
    else setTimeout(resolve, ms);
  });

/**
 * @param {HTMLElement|null} root — the mines view section
 * @param {{
 *   columns?: number,
 *   rows?: number,
 *   flipMs?: number,
 *   staggerMs?: number,
 *   minStaggerMs?: number,
 *   settleBudgetMs?: number,
 *   revealLeadMs?: number,
 *   gemSparks?: number,
 *   winRippleStepMs?: number,
 *   reducedMotionMs?: number,
 *   onPick?: (index: number) => void,
 * }} [options]
 */
export function createMinesGrid(root, {
  columns = MINES.columns,
  rows = MINES.rows,
  flipMs = MINES.flipMs,
  staggerMs = MINES.staggerMs,
  minStaggerMs = MINES.minStaggerMs,
  settleBudgetMs = MINES.settleBudgetMs,
  revealLeadMs = MINES.revealLeadMs,
  gemSparks = MINES.gemSparks,
  winRippleStepMs = MINES.winRippleStepMs,
  reducedMotionMs = MINES.reducedMotionMs,
  onPick,
} = {}) {
  const size = Math.max(1, Math.trunc(columns) || MINES.columns) * Math.max(1, Math.trunc(rows) || MINES.rows);
  const mount = root ? root.querySelector('[data-mines-grid]') : null;

  /** Parallel to `tiles`: the node the coin is written into, held directly. */
  const tiles = [];
  const faces = [];
  const slots = [];
  const sparkRings = [];

  let handler = typeof onPick === 'function' ? onPick : null;
  let built = false;

  const reducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const flipDuration = () => (reducedMotion() ? reducedMotionMs : flipMs);

  /**
   * Gap between the starts of two tiles in the end-of-round reveal. The budget
   * is divided over however many tiles are still closed, so a board with 24
   * mines left to show takes the same wall-clock time as one with two.
   */
  function staggerFor(count) {
    if (count <= 0 || reducedMotion()) return 0;
    return Math.max(minStaggerMs, Math.min(staggerMs, settleBudgetMs / count));
  }

  function build() {
    if (built || !mount) return;

    // The stylesheet reads this, so the transition length has exactly one
    // source of truth — the config — instead of being restated in CSS.
    mount.style.setProperty('--mines-flip-ms', `${Number(flipMs) || 0}ms`);
    mount.style.setProperty('--mines-columns', String(columns));
    mount.style.setProperty('--mines-rows', String(rows));
    // The cash-out ripple's cadence, from the same config the view reads — one
    // home for the timing, exactly like the flip length above.
    mount.style.setProperty('--mines-ripple-step', `${Number(winRippleStepMs) || 0}ms`);

    const doc = mount.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    for (let index = 0; index < size; index += 1) {
      const tile = doc.createElement('button');
      tile.type = 'button';
      tile.className = 'mines-tile';
      tile.dataset.minesTile = String(index);
      tile.dataset.index = String(index);
      tile.disabled = true;
      tile.setAttribute('aria-label', `Katak ${index + 1}`);
      // Position on the board, which is all the cash-out ripple needs to sweep
      // the lit tiles in reading order rather than all at once.
      tile.style.setProperty('--mines-order', String(index));

      const inner = doc.createElement('span');
      inner.className = 'mines-tile__inner';

      const back = doc.createElement('span');
      back.className = 'mines-tile__face mines-tile__face--back';
      back.setAttribute('aria-hidden', 'true');

      const front = doc.createElement('span');
      front.className = 'mines-tile__face mines-tile__face--front';
      front.setAttribute('aria-hidden', 'true');

      const slot = doc.createElement('span');
      slot.className = 'mines-tile__art-slot';

      const glow = doc.createElement('span');
      glow.className = 'mines-tile__glow';

      const shock = doc.createElement('span');
      shock.className = 'mines-tile__shock';

      front.append(slot, glow, shock);

      // The sparks a gem throws. Built once per tile like everything else on
      // the board and left at zero opacity until a gem is revealed, so nothing
      // is created or destroyed at reveal time — the animation is the only
      // thing that costs, and it costs one layer per spark for 700 ms.
      const ring = [];
      const sparks = Math.max(0, Math.trunc(Number(gemSparks)) || 0);
      for (let spark = 0; spark < sparks; spark += 1) {
        const dot = doc.createElement('span');
        dot.className = 'mines-tile__spark';
        // `--i` staggers the throw; `--a` is the spoke it leaves along, spread
        // evenly over the full circle however many the config asks for.
        dot.style.setProperty('--i', String(spark));
        dot.style.setProperty('--a', `${(spark / Math.max(1, sparks)) * 360}deg`);
        front.append(dot);
        ring.push(dot);
      }
      sparkRings.push(ring);

      inner.append(back, front);
      tile.append(inner);
      mount.append(tile);

      tile.addEventListener('click', () => {
        if (tile.disabled || handler === null) return;
        handler(index);
      });

      tiles.push(tile);
      faces.push(front);
      slots.push(slot);
    }

    built = true;
  }

  /** Reset every tile to its closed state. */
  function clear() {
    tiles.forEach((tile, index) => {
      tile.classList.remove('is-revealed', 'is-gem', 'is-mine', 'is-hit');
      slots[index].innerHTML = '';
      tile.setAttribute('aria-label', `Katak ${index + 1}`);
    });
  }

  /**
   * A gold ribbon that rises off a tile and removes itself.
   *
   * Both strings are built by the caller — the board has no business knowing
   * how coins are grouped or how a multiplier is spelled (js/ui/format.js
   * owns that), which is also why this takes pre-rendered text rather than
   * numbers.
   *
   * @param {number} index — the tile that was turned
   * @param {{ multiplierLabel?: string, valueLabel?: string }} [labels]
   */
  function floatValue(index, { multiplierLabel = '', valueLabel = '' } = {}) {
    const tile = tiles[index];
    if (!tile || reducedMotion()) return;

    const mountDoc = mount?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (!mountDoc || (!multiplierLabel && !valueLabel)) return;

    const float = mountDoc.createElement('span');
    float.className = 'mines-float';
    float.setAttribute('aria-hidden', 'true');

    if (multiplierLabel) {
      const mult = mountDoc.createElement('span');
      mult.className = 'mines-float__mult';
      mult.textContent = multiplierLabel;
      float.append(mult);
    }

    if (valueLabel) {
      const amount = mountDoc.createElement('span');
      amount.className = 'mines-float__value';
      amount.textContent = valueLabel;
      float.append(amount);
    }

    tile.append(float);

    const remove = () => float.remove();
    float.addEventListener('animationend', remove, { once: true });
    // Safety net: a hidden tab never fires animation events.
    if (typeof setTimeout === 'function') setTimeout(remove, 1_400);
  }

  /**
   * Turn one tile over and write the result into it.
   * @param {number} index
   * @param {'gem'|'mine'} kind
   * @param {{ multiplierLabel?: string, valueLabel?: string, hit?: boolean }} [options]
   * @returns {Promise<boolean>} whether the tile turned (false if already open)
   */
  async function flip(index, kind, { multiplierLabel = '', valueLabel = '', hit = false } = {}) {
    const tile = tiles[index];
    if (!tile || tile.classList.contains('is-revealed')) return false;

    const isMine = kind === 'mine';
    slots[index].innerHTML = isMine
      ? mineSvgMarkup()
      : symbolSvgMarkup(GEM_SYMBOL_ID, 'mines-tile__art');

    tile.classList.add('is-revealed', isMine ? 'is-mine' : 'is-gem');
    if (hit) tile.classList.add('is-hit');
    tile.disabled = true;
    tile.setAttribute(
      'aria-label',
      isMine ? `Katak ${index + 1}: mina` : `Katak ${index + 1}: olmos`,
    );

    if (!isMine) floatValue(index, { multiplierLabel, valueLabel });

    await wait(flipDuration());
    return true;
  }

  return {
    build,
    size,

    /** Where tile clicks go. */
    setHandler(next) {
      handler = typeof next === 'function' ? next : null;
    },

    /** New round: the board is closed and every tile is tappable. */
    arm() {
      clear();
      tiles.forEach((tile) => {
        tile.disabled = false;
      });
    },

    /** Freeze the board but keep what is on it. */
    lock() {
      tiles.forEach((tile) => {
        tile.disabled = true;
      });
    },

    clear,

    flip,

    /**
     * Show what was under every tile the player never touched — the
     * end-of-round reveal.
     *
     * Two things make it read as a machine working rather than a repaint:
     *
     *   • the wave starts at the tile the mine was under and spreads outward, so
     *     the board unseals FROM the hit instead of from the top-left corner.
     *     `from` is the hit tile's index; without it the board falls back to
     *     reading order, which is what a test with no board to play on wants.
     *   • `revealLeadMs` is held first, so the mine lands alone and the silence
     *     after it is what makes the rest feel like a consequence.
     *
     * The flips overlap (the timer between starts is shorter than a turn) and the
     * whole wave is capped by `settleBudgetMs`, so a board with 24 tiles left
     * takes no longer than one with two.
     *
     * @param {{ mineIndices?: number[], picked?: number[], from?: number }} [round]
     */
    async revealRest({ mineIndices = [], picked = [], from } = {}) {
      const mines = new Set(mineIndices);
      const done = new Set(picked);
      const pending = [];

      for (let index = 0; index < tiles.length; index += 1) {
        if (!done.has(index)) pending.push(index);
      }

      // Chebyshev distance from the hit tile: the ring of tiles that were one
      // step away turns before the ring two steps away, and the diagonals are
      // part of their square ring instead of being pushed a step further out.
      if (Number.isInteger(from) && from >= 0 && from < tiles.length && pending.length > 1) {
        const [hitX, hitY] = [from % columns, Math.floor(from / columns)];
        pending.sort((a, b) => {
          const ringA = Math.max(Math.abs((a % columns) - hitX), Math.abs(Math.floor(a / columns) - hitY));
          const ringB = Math.max(Math.abs((b % columns) - hitX), Math.abs(Math.floor(b / columns) - hitY));
          return ringA - ringB || a - b;
        });
      }

      const stagger = staggerFor(pending.length);
      const reduced = reducedMotion();

      if (pending.length > 0 && !reduced && revealLeadMs > 0) await wait(revealLeadMs);

      // Every tile that has NOT turned is held back a little while the wave
      // runs, so the board lights up in arcs instead of looking painted on.
      mount?.classList?.add('is-revealing');
      try {
        for (const index of pending) {
          flip(index, mines.has(index) ? 'mine' : 'gem', { hit: false });
          if (stagger > 0) await wait(stagger);
        }
        if (pending.length > 0) await wait(flipDuration());
      } finally {
        mount?.classList?.remove('is-revealing');
      }
      return pending.length;
    },

    get openCount() {
      return tiles.filter((tile) => tile.classList.contains('is-revealed')).length;
    },

    get isBuilt() {
      return built;
    },

    elements: { mount, tiles, faces, slots, sparkRings },
  };
}

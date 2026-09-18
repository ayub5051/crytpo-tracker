/* ============================================================================
   SOQQA — Mines engine (exact)
   ----------------------------------------------------------------------------
   The board is 5x5 and the player chooses the mine count, so the payout ladder
   is not a table anybody typed: it is the geometry of the board. That makes it
   the one part of this game that can be checked against the truth rather than
   against itself, and that is what this suite does —

     • every multiplier is compared with the exact hypergeometric probability,
       computed in BigInt in the test, for ALL 300 legal (mine count, reveals)
       combinations on the 25-tile board;
     • the return-to-player is audited across that same grid: cashing out after
       any number of reveals must come back to the configured edge, so the game
       cannot have a lucky corner where the house margin quietly disappears;
     • the draw is checked for bias, because a shuffle that leaks a bias would
       pay out on a board the odds do not describe;
     • and the round's edges are attacked directly — duplicate reveals, reveals
       on a dead round, cash-out before a single tile, cash-out twice.

   The UI wiring is asserted separately in tests/mines-ui.test.mjs.
   ========================================================================= */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MINES, MINES_BOARD_SIZE, STORAGE_KEYS, SYMBOL_ORDER } from '../js/config.js';
import {
  BOARD_SIZE,
  createMinesEngine,
  mineCountBounds,
  minesLadder,
  minesMaxReveal,
  minesMultiplier,
  normalizeMineCount,
  survivalProbability,
} from '../js/games/mines.js';
import { MINE_GLYPH_ID, mineSvgMarkup } from '../js/ui/minesGrid.js';
import { createStore } from '../js/store/state.js';
import { createMemoryStorage, createStorage } from '../js/store/storage.js';
import { createSeededRng } from '../js/utils/rng.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

/** C(n, k) exactly, in BigInt. */
function bigBinomial(n, k) {
  let result = 1n;
  for (let i = 0n; i < BigInt(k); i += 1n) {
    result = (result * (BigInt(n) - i)) / (i + 1n);
  }
  return result;
}

/**
 * The exact probability that `revealed` picks in a row are safe, as a double.
 * Both binomials are exact integers with a double's range on this board, so the
 * single division is the correctly-rounded truth the implementation is judged
 * against.
 */
function exactProbability(mines, revealed) {
  const numerator = bigBinomial(BOARD_SIZE - mines, revealed);
  const denominator = bigBinomial(BOARD_SIZE, revealed);
  return Number(numerator) / Number(denominator);
}

/** Every (mine count, reveal count) pair the board allows. */
function allCombinations() {
  const pairs = [];
  for (let mines = MINES.minCount; mines <= MINES.maxCount; mines += 1) {
    const rounds = BOARD_SIZE - mines;
    for (let revealed = 1; revealed <= rounds; revealed += 1) pairs.push({ mines, revealed });
  }
  return pairs;
}

/** Every id a block of markup points at, through `url(#…)` or `href="#…"`. */
function referencedIds(markup) {
  return [...markup.matchAll(/(?:url\(#|href="#)([\w-]+)/g)].map((match) => match[1]);
}

/** The source of one element, by walking its own nesting depth. */
function elementSource(html, openTag) {
  const start = html.indexOf(openTag);
  if (start === -1) return '';

  const tag = /^<(\w+)/.exec(openTag)[1];
  const pattern = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  pattern.lastIndex = start;

  let depth = 0;
  let match = pattern.exec(html);
  while (match) {
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return html.slice(start, pattern.lastIndex);
    } else {
      depth += 1;
    }
    match = pattern.exec(html);
  }
  return html.slice(start);
}

export async function runMinesTests(suite) {
  /* ----------------------------------------------------------------------
     Board geometry
     ---------------------------------------------------------------------- */
  suite.eq('the board is exactly 25 tiles', MINES_BOARD_SIZE, 25);
  suite.eq('BOARD_SIZE mirrors the config', BOARD_SIZE, MINES_BOARD_SIZE);
  suite.eq('the grid is the configured shape', MINES.columns * MINES.rows, MINES_BOARD_SIZE);
  suite.ok(
    'at least one tile is always safe',
    MINES.maxCount < MINES_BOARD_SIZE && MINES.minCount >= 1,
    `${MINES.minCount}…${MINES.maxCount}`,
  );
  suite.eq('the bounds are the board\'s', mineCountBounds(), { min: 1, max: 24 });
  suite.ok(
    'the default mine count is legal and offered as a chip',
    MINES.quickCounts.includes(MINES.defaultCount) &&
      MINES.quickCounts.every((count) => count >= MINES.minCount && count <= MINES.maxCount),
    MINES.quickCounts.join(', '),
  );
  suite.ok(
    'the house margin is a single small number, not a per-cell fudge',
    MINES.edge > 0.9 && MINES.edge < 1,
    String(MINES.edge),
  );

  /* ----------------------------------------------------------------------
     Probabilities, against BigInt
     ---------------------------------------------------------------------- */
  suite.eq('an untouched board is certain', survivalProbability(3, 0), 1);
  // The chain of ratios lands within a unit in the last place of the true
  // rational, so the closed forms below are compared with that tolerance rather
  // than with `===`. The exactness claim is audited properly further down.
  const closeTo = (actual, expected) => Math.abs(actual - expected) <= Math.abs(expected) * 1e-12;
  suite.ok(
    'one mine, one pick: 24 of 25 tiles are safe',
    closeTo(survivalProbability(1, 1), 24 / 25),
    String(survivalProbability(1, 1)),
  );
  // The top of a one-mine ladder is the jackpot of the game: to clear all 24
  // safe tiles you had to beat one mine in 25, so it is 1/25 — not a certainty.
  suite.ok(
    'clearing a one-mine board is one chance in 25',
    closeTo(survivalProbability(1, 24), 1 / 25),
    String(survivalProbability(1, 24)),
  );
  suite.ok(
    'and a two-mine board is both mines missed: 1 in 300',
    closeTo(survivalProbability(2, 23), 1 / 300),
    String(survivalProbability(2, 23)),
  );

  {
    const pairs = allCombinations();
    const off = [];
    let worst = 0;

    pairs.forEach(({ mines, revealed }) => {
      const expected = exactProbability(mines, revealed);
      const actual = survivalProbability(mines, revealed);
      const error = Math.abs(actual - expected);
      worst = Math.max(worst, error / expected);
      if (error > 1e-12) off.push(`${mines}m/${revealed}k: ${actual} vs ${expected}`);
    });

    suite.eq('every legal combination is covered', pairs.length, 300);
    suite.ok(
      'the survival chance is the exact hypergeometric draw, at every mine count',
      off.length === 0,
      off.join('; '),
    );
    suite.note(`300 combinations · worst relative error vs BigInt ${worst.toExponential(2)}`);
  }

  {
    // Monotone in the number of picks, and monotone in the danger: more mines
    // has to mean a lower chance to survive the same number of reveals.
    let broken = [];
    for (let mines = 1; mines <= 24; mines += 1) {
      for (let revealed = 1; revealed < BOARD_SIZE - mines; revealed += 1) {
        if (!(survivalProbability(mines, revealed + 1) < survivalProbability(mines, revealed))) {
          broken.push(`${mines}m/${revealed}k`);
        }
      }
    }
    for (let revealed = 1; revealed <= 4; revealed += 1) {
      for (let mines = 1; mines < 24; mines += 1) {
        // Only where the extra mine still leaves that many tiles safe: past the
        // end of the board both sides clamp, and two equal chances are not a
        // counter-example to anything.
        if (revealed > BOARD_SIZE - (mines + 1)) continue;
        if (!(survivalProbability(mines + 1, revealed) < survivalProbability(mines, revealed))) {
          broken.push(`${mines}m/${revealed}k vs +1 mine`);
        }
      }
    }
    suite.ok(
      'survival falls with every pick and with every extra mine',
      broken.length === 0,
      broken.slice(0, 5).join('; '),
    );
  }

  /* ----------------------------------------------------------------------
     Multipliers
     ---------------------------------------------------------------------- */
  suite.eq('there is nothing to cash out before the first pick', minesMultiplier(3, 0), 0);
  suite.eq('normalizeMineCount clamps the impossible', normalizeMineCount(99), MINES.maxCount);
  suite.eq('...and the impossible is clamped up, not down', normalizeMineCount(0), MINES.minCount);
  suite.eq(
    'the mine count snaps rather than being refused',
    normalizeMineCount('7'),
    7,
  );

  {
    const pairs = allCombinations();
    const decimals = 10 ** MINES.multiplierDecimals;

    /*
     * Two separate claims, because one of them has to be exact and the other
     * only has to be tight.
     *
     *   (a) EXACT — the multiplier is `floor(edge / P(k))` on the precision the
     *       HUD prints, where `P(k)` is the probability THIS implementation
     *       returns. This is the invariant that makes "pays exactly what it
     *       showed" true: the panel and the payout read the same number.
     *
     *   (b) CLOSE — and that number tracks the true hypergeometric multiplier
     *       to within ONE printed unit, which is the tightest bound that can
     *       honestly be asserted. The reason is worth stating: a floor is a
     *       cliff. Wherever `edge / P(k)` lands on a cent boundary — 0.97 / 0.2
     *       = 4.85 exactly — a one-ulp difference in `P(k)` decides which side
     *       of the cliff the result falls on, so an error far below the
     *       resolution of the number can still move it by one whole unit. On
     *       the cliff cases the implementation is often the one that is right:
     *       at 1 mine / 20 picks the true multiplier is 4.85 and the chain
     *       lands on 4.85, where dividing two rounded binomials gives 4.84.
     */
    const unit = 1 / decimals;
    const notFloored = [];
    const adrift = [];
    let onACliff = 0;

    pairs.forEach(({ mines, revealed }) => {
      const actual = minesMultiplier(mines, revealed);
      const selfConsistent =
        Math.floor((MINES.edge / survivalProbability(mines, revealed)) * decimals) / decimals;
      if (actual !== selfConsistent) notFloored.push(`${mines}m/${revealed}k: ${actual} vs ${selfConsistent}`);

      const truth = Math.floor((MINES.edge / exactProbability(mines, revealed)) * decimals) / decimals;
      const difference = Math.abs(actual - truth);
      if (difference > unit + 1e-9) adrift.push(`${mines}m/${revealed}k: ${actual} vs ${truth}`);
      if (difference > 1e-9) onACliff += 1;
    });

    suite.ok(
      'the multiplier is the edge over the board probability, floored to the printed precision',
      notFloored.length === 0,
      notFloored.join('; '),
    );
    suite.ok(
      'and matches the exact hypergeometric multiplier to within one printed unit',
      adrift.length === 0,
      adrift.join('; '),
    );
    suite.ok(
      'the two agree outright on all but the cent-boundary cases',
      onACliff <= 20,
      `${onACliff} of ${pairs.length} sit on a floor cliff`,
    );
    suite.note(`multiplier agreement: ${pairs.length - onACliff}/${pairs.length} exact, ${onACliff} on a cent cliff`);
    suite.ok(
      'every rung is a whole number of the smallest unit the HUD can print',
      pairs.every(({ mines, revealed }) => {
        const value = minesMultiplier(mines, revealed);
        return Math.abs(value * decimals - Math.round(value * decimals)) < 1e-9;
      }),
    );
  }

  {
    const reversed = [];
    for (let mines = 1; mines <= 24; mines += 1) {
      const rows = minesLadder(mines);
      rows.forEach((row, index) => {
        if (index > 0 && row.multiplier <= rows[index - 1].multiplier) {
          reversed.push(`${mines}m/${row.revealed}k`);
        }
      });
    }
    suite.ok('the ladder only ever climbs', reversed.length === 0, reversed.join('; '));
    suite.eq('the ladder is as long as the board is safe', minesLadder(3).length, BOARD_SIZE - 3);
    suite.eq('maxReveal is the number of safe tiles', minesMaxReveal(7), 18);
    suite.eq(
      'the top of a three-mine ladder is the whole board cleared',
      minesLadder(3).at(-1).revealed,
      22,
    );
  }

  /* ----------------------------------------------------------------------
     Return to player, across the whole board
     ---------------------------------------------------------------------- */
  {
    const pairs = allCombinations();
    const returns = pairs.map(({ mines, revealed }) => survivalProbability(mines, revealed) * minesMultiplier(mines, revealed));
    const low = Math.min(...returns);
    const high = Math.max(...returns);

    suite.ok(
      'cashing out after any number of reveals returns the same edge',
      low > MINES.edge - 0.008 && high <= MINES.edge + 1e-9,
      `${low.toFixed(5)} … ${high.toFixed(5)}`,
    );
    suite.ok(
      'so there is no reveal count that quietly beats the house',
      returns.every((value) => value <= MINES.edge + 1e-9),
    );
    suite.note(`RTP over all 300 cash-out points: ${low.toFixed(4)} … ${high.toFixed(4)} (nominal ${MINES.edge})`);
  }

  /* ----------------------------------------------------------------------
     The round
     ---------------------------------------------------------------------- */
  {
    const engine = createMinesEngine({ rng: createSeededRng(11) });

    suite.ok('a fresh engine is idle', engine.round === null && engine.active === false);
    suite.ok('revealing with no round is refused', engine.reveal(0).reason === 'inactive');
    suite.ok('cashing out with no round is refused', engine.cashOut(1_000).reason === 'inactive');

    const started = engine.start({ mines: 4 });
    suite.ok('start draws a board', started.ok);
    suite.eq('with the requested mine count', engine.round.mineCount, 4);
    suite.eq('every mine is on the board', engine.round.mineIndices.length, 4);
    suite.ok(
      'mine positions are distinct and inside the grid',
      new Set(engine.round.mineIndices).size === 4 &&
        engine.round.mineIndices.every((index) => Number.isInteger(index) && index >= 0 && index < BOARD_SIZE),
      engine.round.mineIndices.join(', '),
    );
    suite.ok('nothing is revealed yet', engine.revealedCount === 0);
    suite.ok('the round is live', engine.active === true);

    const second = engine.start({ mines: 9 });
    suite.ok('a second start cannot re-price a live round', second.ok === false && second.reason === 'active');
    suite.eq('...and the board is untouched', engine.round.mineCount, 4);

    // A safe tile: the multiplier comes off the board, not a running total.
    const safe = [...Array(BOARD_SIZE).keys()].find(
      (index) => !engine.round.mineIndices.includes(index),
    );
    const revealed = engine.reveal(safe);
    suite.ok('a safe tile reports safe', revealed.ok && revealed.status === 'safe');
    suite.eq('and counts once', engine.revealedCount, 1);
    suite.eq('its multiplier is the board\'s', revealed.multiplier, minesMultiplier(4, 1));

    const duplicate = engine.reveal(safe);
    suite.ok(
      'revealing the same tile again is refused, not counted twice',
      duplicate.ok === false && duplicate.reason === 'revealed',
    );
    suite.eq('so the reveal count does not move', engine.revealedCount, 1);
    suite.eq('and the stakes were not nudged either', engine.round.safePicks.length, 1);

    [ -1, 25, 1.5, 'x', null ].forEach((bad) => {
      const result = engine.reveal(bad);
      suite.ok(
        `an out-of-range or non-integer tile (${String(bad)}) is refused`,
        result.ok === false && result.reason === 'invalid',
      );
    });
    suite.eq('and none of them touched the round', engine.revealedCount, 1);

    engine.abandon();
    suite.ok('an abandoned round is over', engine.active === false);
    suite.ok('and cannot be revealed into', engine.reveal(engine.round.mineIndices[0]).reason === 'over');
    suite.ok('nor cashed out', engine.cashOut(1_000).reason === 'over');
    suite.ok('a fresh start is allowed once the round is dead', engine.start({ mines: 2 }).ok === true);
    suite.eq('and it really is a new board', engine.round.revealedCount, 0);
    engine.reset();
    suite.ok('reset clears the board entirely', engine.round === null);
  }

  /* ----------------------------------------------------------------------
     The payout
     ---------------------------------------------------------------------- */
  {
    const engine = createMinesEngine({ rng: createSeededRng(23) });
    const bet = 25_000;

    engine.start({ mines: 3 });
    suite.ok('nothing revealed: nothing to bank', engine.cashOut(bet).reason === 'empty');
    suite.ok('...and the round survives that', engine.active === true);

    const firstSafe = [...Array(BOARD_SIZE).keys()].find(
      (index) => !engine.round.mineIndices.includes(index),
    );
    engine.reveal(firstSafe);
    const banked = engine.cashOut(bet);

    suite.ok('cashing out succeeds', banked.ok === true);
    suite.eq('at the multiplier the reveal earned', banked.multiplier, minesMultiplier(3, 1));
    suite.eq('and pays the stake times it, rounded', banked.payout, Math.round(bet * banked.multiplier));
    suite.ok('the round is closed by paying', engine.active === false);

    const again = engine.cashOut(bet);
    suite.ok(
      'a second cash out pays nothing at all',
      again.ok === false && again.reason === 'over' && again.payout === undefined,
    );

    // A mine: the round dies and nothing is payable.
    const minesEngine = createMinesEngine({ rng: createSeededRng(31) });
    minesEngine.start({ mines: 3 });
    const mine = minesEngine.round.mineIndices[0];
    const hit = minesEngine.reveal(mine);
    suite.ok('a mine ends the round', hit.ok === true && hit.status === 'mine' && hit.multiplier === 0);
    suite.eq('the tile is remembered as the one that was hit', hit.round.hitIndex, mine);
    suite.ok('a dead round refuses to be paid', minesEngine.cashOut(bet).reason === 'over');
    suite.ok('and refuses further reveals', minesEngine.reveal(0).reason === 'over');
  }

  {
    const engine = createMinesEngine({ rng: createSeededRng(41) });
    engine.start({ mines: 5 });
    const safe = [...Array(BOARD_SIZE).keys()].find((index) => !engine.round.mineIndices.includes(index));
    engine.reveal(safe);
    suite.ok('a bet that is not a legal stake cannot be banked', engine.cashOut(1).reason === 'invalid');
    suite.ok('and the round is still the player\'s', engine.active === true);
  }

  /* ----------------------------------------------------------------------
     The draw is unbiased
     ---------------------------------------------------------------------- */
  {
    const rounds = 4_000;
    const mineCount = 3;
    const engine = createMinesEngine({ rng: createSeededRng(5) });
    const tally = new Array(BOARD_SIZE).fill(0);
    let duplicates = 0;

    for (let round = 0; round < rounds; round += 1) {
      engine.start({ mines: mineCount });
      const indices = engine.round.mineIndices;
      if (new Set(indices).size !== mineCount) duplicates += 1;
      indices.forEach((index) => {
        tally[index] += 1;
      });
      engine.reset();
    }

    const expected = (rounds * mineCount) / BOARD_SIZE;
    const spread = Math.sqrt(rounds * (mineCount / BOARD_SIZE) * (1 - mineCount / BOARD_SIZE));
    const worst = Math.max(...tally.map((count) => Math.abs(count - expected)));
    const sigma = worst / spread;

    suite.eq('no round ever drew the same tile twice', duplicates, 0);
    // 4σ, not 3: the bound has to fail a genuinely biased shuffle (which lands
    // far outside it) while not turning a seed change into a flaky red run —
    // at 4σ a single tile has a ~1-in-16,000 chance of straying.
    suite.ok(
      'every tile is as likely to be mined as every other',
      sigma < 4,
      `worst tile ${worst.toFixed(0)} off ${expected.toFixed(0)} expected (${sigma.toFixed(2)}σ)`,
    );
    suite.note(`${rounds} draws · per-tile deviation ${sigma.toFixed(2)}σ (σ = ${spread.toFixed(1)})`);
  }

  {
    // The first pick is NOT protected: the printed multiplier is the real board
    // probability, so a "free" first tile would make the game more generous
    // than its own numbers. Measured over the draws above' board size.
    const engine = createMinesEngine({ rng: createSeededRng(77) });
    const rounds = 3_000;
    let survived = 0;
    for (let round = 0; round < rounds; round += 1) {
      engine.start({ mines: 5 });
      if (!engine.round.mineIndices.includes(0)) survived += 1;
      engine.reset();
    }
    const rate = survived / rounds;
    suite.ok(
      'the first tile is a real pick at the stated odds, not a free one',
      Math.abs(rate - 0.8) < 0.03,
      `${(rate * 100).toFixed(1)}% safe against 80% expected`,
    );
  }

  /* ----------------------------------------------------------------------
     Board artwork
     ---------------------------------------------------------------------- */
  {
    const html = read('index.html');
    const spriteSymbols = [...html.matchAll(/<symbol\s+id="([^"]+)"/g)].map((match) => match[1]);

    suite.ok(
      'the board glyph is declared as a group, not as a slot symbol',
      html.includes(`<g id="${MINE_GLYPH_ID}">`) &&
        !spriteSymbols.includes(MINE_GLYPH_ID),
      MINE_GLYPH_ID,
    );
    suite.eq(
      'the slot sprite is still exactly one symbol per configured symbol',
      spriteSymbols.length,
      SYMBOL_ORDER.length,
    );
    suite.ok(
      'the board markup points at that glyph',
      mineSvgMarkup().includes(`href="#${MINE_GLYPH_ID}"`) &&
        mineSvgMarkup().includes('aria-hidden="true"'),
    );

    // Every ramp and every sub-shape the glyph uses has to actually exist —
    // a `url(#…)` that resolves to nothing paints black in one engine and
    // nothing at all in another, and neither shows up as an error.
    const glyph = elementSource(html, `<g id="${MINE_GLYPH_ID}">`);
    const unresolved = referencedIds(glyph).filter((id) => !html.includes(`id="${id}"`));
    suite.ok('the glyph was located in index.html', glyph.length > 400, `${glyph.length} chars`);
    suite.ok(
      'every ramp and spike the glyph references is defined',
      unresolved.length === 0,
      unresolved.join(', '),
    );
    suite.ok(
      'the glyph draws spikes, an iron body and a lit core',
      glyph.includes('sqIronSpike') && glyph.includes('sqIron') && glyph.includes('sqEmberCore'),
    );
    suite.ok(
      'the gem is the sprite\'s own artwork, not a second drawing of it',
      read('js/ui/minesGrid.js').includes("GEM_SYMBOL_ID = 'diamond'"),
    );
  }

  /* ----------------------------------------------------------------------
     The board's timing has one home
     ---------------------------------------------------------------------- */
  {
    // The stylesheet's declaration is the pre-boot default: it is what a browser
    // paints in the moment before the grid writes the real value, and it is what
    // a reader of style.css will believe the flip takes. The view times the
    // end-of-round reveal off `MINES.flipMs`, so the two drifting apart would
    // mean the board turns at one speed and reveals at another.
    const css = read('style.css');
    const declared = /--mines-flip-ms:\s*(\d+)ms/.exec(css);
    const grid = read('js/ui/minesGrid.js');

    suite.ok('the stylesheet declares a default flip length', Boolean(declared), String(declared?.[0]));
    suite.eq(
      'and it is exactly the config\'s flip length',
      Number(declared?.[1]),
      MINES.flipMs,
    );
    suite.ok(
      'while the board overwrites it from the config at build time',
      grid.includes("'--mines-flip-ms'") && grid.includes('flipMs'),
    );
    suite.ok(
      'so the CSS transition reads the variable rather than a number',
      /\.mines-tile__inner\s*\{[^}]*transition:\s*transform\s+var\(--mines-flip-ms\)/.test(css),
    );
    suite.ok(
      'the grid is the configured shape in the stylesheet too',
      css.includes('repeat(var(--mines-columns, 5)') && css.includes('repeat(var(--mines-rows, 5)'),
    );
    suite.ok(
      'and every tile is locked to a square, so the 5x5 can never skew',
      /\.mines-tile\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/.test(css) &&
        /\.mines-grid\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/.test(css),
    );
  }

  /* ----------------------------------------------------------------------
     The turn: one easing curve, solved and bounded
     ---------------------------------------------------------------------- */
  //
  // The flip's weight is carried by the ease, not by the duration alone: a curve
  // that lands exactly on 180 degrees stops dead and reads as a class swap, while
  // one whose y-controls sit outside [0, 1] tips past the upright and settles
  // back onto it like a lid with mass. That is a property of the shipped numbers,
  // so it is asserted by solving the shipped curve rather than by trusting the
  // comment next to it.
  {
    const css = read('style.css');

    const bezierY = (x, x1, y1, x2, y2) => {
      const sample = (t, p1, p2) => 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3;
      let low = 0;
      let high = 1;
      for (let i = 0; i < 60; i += 1) {
        const mid = (low + high) / 2;
        if (sample(mid, x1, x2) < x) low = mid;
        else high = mid;
      }
      return sample((low + high) / 2, y1, y2);
    };

    const flipRule = /\.mines-tile__inner\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const easing = /cubic-bezier\(([^)]+)\)/.exec(flipRule);
    const numbers = easing ? easing[1].split(',').map((part) => Number(part.trim())) : [];
    const [x1, y1, x2, y2] = numbers;

    suite.ok(
      'the flip easing is a cubic-bezier with four numbers',
      numbers.length === 4 && numbers.every((value) => Number.isFinite(value)),
      easing?.[0] ?? 'no cubic-bezier on .mines-tile__inner',
    );
    suite.ok(
      'its control points sit outside the unit range, so the lid tips past the upright',
      y1 < 1 && y2 > 1,
      `y-controls ${y1}, ${y2}`,
    );

    let peak = 0;
    let peakAt = 0;
    for (let step = 0; step <= 2_000; step += 1) {
      const x = step / 2_000;
      const y = bezierY(x, x1, y1, x2, y2);
      if (y > peak) {
        peak = y;
        peakAt = x;
      }
    }

    // A controlled tip: at least ~0.7 degrees past the upright so the snap is
    // felt (below that it is indistinguishable from landing on 180), and no more
    // than ~10 degrees so the face never reads as tumbling — with the tile being
    // square, a large overshoot also exposes the turning edge.
    const overshootDeg = (peak - 1) * 180;
    suite.ok(
      'the overshoot is a controlled tip, not a tumble',
      peak > 1.004 && peak < 1.06,
      `peak ${peak.toFixed(5)} (${overshootDeg.toFixed(2)}° past upright)`,
    );
    suite.ok(
      'and it is reached before the turn ends, so the lid settles back',
      peakAt > 0.5 && peakAt < 0.99,
      `peak at ${(peakAt * 100).toFixed(0)}% of the turn`,
    );
    suite.ok(
      'the curve lands exactly upright at the end',
      Math.abs(bezierY(1, x1, y1, x2, y2) - 1) < 1e-9,
    );

    // Weight is duration as well as shape: a turn under ~0.42 s reads as a switch
    // no matter how the ease is shaped, and the config is what the stylesheet
    // default is asserted against above.
    suite.ok(
      'the turn is long enough to carry weight',
      MINES.flipMs >= 420 && MINES.flipMs <= 700,
      `flipMs ${MINES.flipMs}`,
    );
  }

  /* ----------------------------------------------------------------------
     Polish that has to keep working: sparks, ripple, hierarchy
     ---------------------------------------------------------------------- */
  {
    const css = read('style.css');
    const grid = read('js/ui/minesGrid.js');
    const view = read('js/views/minesView.js');
    const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, ' ');

    // Anchored to the start of a line so a compound selector that merely ENDS
    // with the same class name — `.mines-grid.is-revealing … .mines-tile__face--back`
    // is one — cannot be mistaken for the rule itself.
    const ruleBody = (selector) => {
      const at = cssCode.indexOf(`\n${selector} {`);
      if (at === -1) return '';
      return cssCode.slice(at, cssCode.indexOf('\n}', at));
    };

    /* --- the sparks a gem throws ---------------------------------------- */
    suite.ok(
      'the config asks for a spray of sparks, not a single flash',
      MINES.gemSparks >= 2 && Number.isInteger(MINES.gemSparks),
      `gemSparks ${MINES.gemSparks}`,
    );
    suite.ok(
      'the board builds one spark per spoke and gives each its angle',
      grid.includes('mines-tile__spark') && grid.includes("'--a'") && grid.includes("'--i'"),
    );

    const sparkRule = ruleBody('.mines-tile__spark');
    suite.ok('the spark is declared in the stylesheet', sparkRule.length > 80, `${sparkRule.length} chars`);
    suite.ok(
      'and a spark is a lit dot rather than a box',
      /border-radius:\s*50%/.test(sparkRule) && /radial-gradient/.test(sparkRule),
    );
    // A spark that were visible at rest would sit on every closed tile.
    suite.ok('no spark is lit until a gem turns', /(^|[;\s])opacity:\s*0/.test(sparkRule));
    suite.ok(
      'the throw is scoped to a revealed gem',
      /\.mines-tile\.is-gem\.is-revealed\s+\.mines-tile__spark\s*\{[^}]*animation:\s*mines-spark-throw/.test(cssCode),
    );
    suite.ok(
      'each spark leaves along its own spoke',
      /@keyframes\s+mines-spark-throw\s*\{[\s\S]*?rotate\(var\(--a/.test(cssCode),
    );
    suite.ok(
      'and they are staggered rather than simultaneous',
      /animation-delay:\s*calc\(var\(--i/.test(cssCode),
    );

    /* --- the cash-out ripple ------------------------------------------- */
    const declaredStep = /--mines-ripple-step:\s*(\d+)ms/.exec(css);
    suite.ok('the stylesheet declares the ripple step', Boolean(declaredStep), String(declaredStep?.[0]));
    suite.eq(
      'and it is exactly the config\u2019s step',
      Number(declaredStep?.[1]),
      MINES.winRippleStepMs,
    );
    suite.ok(
      'while the board overwrites it from the config at build time',
      grid.includes("'--mines-ripple-step'") && grid.includes('winRippleStepMs'),
    );
    suite.ok('every tile knows its place on the board', grid.includes("'--mines-order'"));
    suite.ok(
      'the win ripple sweeps the lit tiles in that order',
      /\.mines-stage\.is-win\s+\.mines-tile\.is-gem\.is-revealed\s+\.mines-tile__glow\s*\{[^}]*var\(--mines-order[^}]*var\(--mines-ripple-step/.test(
        cssCode,
      ),
    );
    // The ripple re-runs the gem's own bloom. Two descriptions of the same light
    // would be free to drift, so there must be exactly one of them.
    const bloomKeyframes = [...cssCode.matchAll(/@keyframes\s+mines-gem-bloom/g)].length;
    suite.eq('the ripple reuses the gem bloom rather than a lookalike', bloomKeyframes, 1);
    suite.ok(
      'a big cash out is a brighter, longer celebration than a normal one',
      /\.mines-stage\.is-win\.is-big\s+\.mines-stage__glow/.test(cssCode) &&
        /\.mines-stage\.is-win\.is-big\s+\.mines-tile\.is-gem\.is-revealed\s+\.mines-tile__glow\s*\{[^}]*animation-iteration-count/.test(
          cssCode,
        ),
    );
    suite.ok(
      'and the view only promotes a cash out past the configured tier',
      view.includes("setStage('is-win', { big: isBig })") && view.includes('MINES.bigWinMultiplier'),
    );

    /* --- the end-of-round wave ----------------------------------------- */
    suite.ok(
      'the wave waits a beat before it starts',
      MINES.revealLeadMs > 0 && grid.includes('revealLeadMs'),
      `revealLeadMs ${MINES.revealLeadMs}`,
    );
    suite.ok(
      'it starts at the mine and spreads outward, ring by ring',
      grid.includes('Math.max(Math.abs(') && /\.sort\(\(a, b\)/.test(grid),
    );
    suite.ok(
      'with the hit index handed to it by the view',
      view.includes('from: round.hitIndex'),
    );

    const holdBack = ruleBody('.mines-grid.is-revealing .mines-tile:not(.is-revealed) .mines-tile__face--back');
    suite.ok('the unturned tiles are held back during the wave', holdBack.length > 40, `${holdBack.length} chars`);
    suite.ok(
      'and it is an opacity, not a filter on 24 elements',
      /opacity:/.test(holdBack) && !/filter:/.test(holdBack),
      holdBack.replace(/\s+/g, ' ').trim().slice(0, 80),
    );
    suite.ok('the board toggles that state around the wave', grid.includes("'is-revealing'"));

    /* --- hierarchy ------------------------------------------------------ */
    const baseValue = /font-size:\s*([\d.]+)rem/.exec(ruleBody('.mines-readout__value'));
    const heroValue = /font-size:\s*clamp\(([\d.]+)rem/.exec(ruleBody('.mines-readout__value--payout'));
    suite.ok(
      'the payout is the hero number in the panel, not one reading among four',
      Number(heroValue?.[1]) >= Number(baseValue?.[1]) * 1.3,
      `base ${baseValue?.[1]}rem · payout ${heroValue?.[1]}rem`,
    );
    suite.ok(
      'and it is the only reading that spans the panel',
      /\.mines-readout:last-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/.test(cssCode),
    );

    /* --- the closed tile ------------------------------------------------ */
    const back = ruleBody('.mines-tile__face--back');
    suite.ok(
      'a sealed tile carries a machined gold ring inside its rim',
      /inset 0 0 0 3px rgba\(232, 196, 106/.test(back),
    );
    suite.ok(
      'with a sheen that crosses it on hover',
      /\.mines-tile:not\(:disabled\):hover\s+\.mines-tile__face--back::before\s*\{[^}]*animation:\s*mines-tile-sheen/.test(
        cssCode,
      ) && /@keyframes\s+mines-tile-sheen/.test(cssCode),
    );
    suite.ok(
      'and the sheen is invisible at rest, so it cannot sit there frozen',
      /(^|[;\s])opacity:\s*0/.test(ruleBody('.mines-tile__face--back::before')),
    );
  }

  /* ----------------------------------------------------------------------
     The store understands a mines record
     ---------------------------------------------------------------------- */
  {
    const backend = createMemoryStorage();
    const store = createStore({ storage: createStorage(backend) });

    const { entry } = store.recordSpin({
      game: 'mines',
      bet: 5_000,
      mines: 5,
      tiles: 7,
      multiplier: 2.5,
      payout: 12_500,
    });

    suite.eq('the record is filed as mines', entry.game, 'mines');
    suite.eq('with the board it was played on', entry.mines, 5);
    suite.eq('and the tiles that were turned', entry.tiles, 7);
    suite.ok('it carries no symbols and no wheel segment', entry.symbols === null && entry.segmentIndex === null);
    suite.eq('the outcome is derived from the payout', entry.outcome, 'win');
    suite.eq('the mines counter moves', store.getStats().minesRounds, 1);
    suite.eq('and the lifetime spins with it', store.getStats().totalSpins, 1);

    // Reload from the same backend: the record has to survive its own validator.
    const reloaded = createStore({ storage: createStorage(backend) });
    const [restored] = reloaded.getHistory();
    suite.eq('a mines record survives a reload', restored?.game, 'mines');
    suite.eq('with its mine count intact', restored?.mines, 5);
    suite.eq('and its tile count intact', restored?.tiles, 7);
    suite.eq('and its payout intact', restored?.payout, 12_500);

    // A record claiming more revealed tiles than the board has is dishonest.
    backend.setItem(
      STORAGE_KEYS.history,
      JSON.stringify([
        { game: 'mines', bet: 1_000, payout: 0, mines: 5, tiles: 99, multiplier: 0, timestamp: 1 },
      ]),
    );
    const repairedStore = createStore({ storage: createStorage(backend) });
    suite.eq(
      'a tile count beyond the board is clamped to the board',
      repairedStore.getHistory()[0].tiles,
      BOARD_SIZE - 5,
    );

    // The game name is an own-property lookup, so a hostile value cannot reach
    // Object.prototype and turn a record's game into a function.
    const nasty = createStore({ storage: createStorage(createMemoryStorage()) });
    const { entry: strange } = nasty.recordSpin({ game: 'constructor', bet: 1_000, payout: 0 });
    suite.eq('an unknown game name falls back to the slots record', strange.game, 'slots');
    suite.eq('and a non-mines record carries no board', strange.mines, null);
  }
}

/* ============================================================================
   SOQQA — Mines UI flow (integration)
   ----------------------------------------------------------------------------
   Drives the real Mines view controller against a shim DOM to verify the whole
   round the way a player experiences it:

     start → deduct → turn tiles → multiplier climbs → cash out → credit →
     history → overlay → unlock

   ...and the same sequence when the board bites instead: the mine, the
   sequential reveal of everything that was left, the loss record, the overlay.

   The maths is asserted exactly in tests/mines.test.mjs. What is asserted here
   is the part only an integration test can reach: that the controls are frozen
   when they should be, that a duplicate click cannot count twice or pay twice,
   that the HUD reads off the engine rather than a running total, and that the
   whole thing lands in the same balance/history store the other two games use.
   ========================================================================= */

import { DEFAULT_BET, MINES, STARTING_BALANCE, STORAGE_KEYS } from '../js/config.js';
import { minesMultiplier } from '../js/games/mines.js';
import { createStore } from '../js/store/state.js';
import { createMemoryStorage, createStorage } from '../js/store/storage.js';
import { createHistoryView } from '../js/ui/historyView.js';
import { createResultModal } from '../js/ui/resultModal.js';
import { createMinesView } from '../js/views/minesView.js';
import { createSeededRng } from '../js/utils/rng.js';
import { createElement, createMinesDom, createModalDom, installGlobals, wait, waitFor } from './fakeDom.mjs';

/** A store whose balance has been drained to just under the minimum bet. */
function poorBackend(coins = 500) {
  const backend = createMemoryStorage();
  backend.setItem(STORAGE_KEYS.balance, JSON.stringify({ coins, updatedAt: 1 }));
  return backend;
}

function harness({
  backend = null,
  rng = createSeededRng(1),
  flipMs = 0,
  withModal = true,
} = {}) {
  const storageBackend = backend ?? createMemoryStorage();
  const store = createStore({ storage: createStorage(storageBackend) });

  const dom = createMinesDom();
  const modalDom = createModalDom();
  const calls = { toasts: [], flashes: [], celebrations: 0, bursts: [] };

  const balanceView = { render() {}, update() {}, flash: (kind) => calls.flashes.push(kind) };
  const toaster = { show: (message, options) => calls.toasts.push({ message, ...options }) };
  const confetti = {
    celebrate: (options) => {
      calls.celebrations += 1;
      calls.bursts.push(options);
    },
    stop() {},
    destroy() {},
  };

  // One confetti stub shared by the cabinet and the overlay, so a celebration
  // that fired twice would show up as 2.
  const resultModal = withModal ? createResultModal(modalDom.container, { confetti }) : null;

  const view = createMinesView({
    store,
    root: dom.root,
    balanceView,
    toaster,
    confetti,
    resultModal,
    rng,
    flipMs,
  });
  view.init();

  return { store, dom, modalDom, view, resultModal, calls, storageBackend };
}

/* --- small readers over the built tree ----------------------------------- */

const childrenOf = (element) => element.children ?? [];

/** The rising ribbon on a tile, if it is still there. */
const floatOn = (tile) => childrenOf(tile).find((child) => child.classList.contains('mines-float'));

/** A tile's label, which is what assistive tech reads out. */
const labelOf = (tile) => tile.attributes['aria-label'] ?? '';

/** Every tile the board built that carries a class. */
const tilesWith = (dom, className) => dom.tiles.filter((tile) => tile.classList.contains(className));

const BOARD_TILES = MINES.columns * MINES.rows;

/** A tile that is definitely NOT a mine on the live board. */
const safeTile = (view) => {
  const { mineIndices } = view.engine.round;
  return [...Array(BOARD_TILES).keys()].find((index) => !mineIndices.includes(index));
};

export async function runMinesUiTests(suite) {
  const restore = installGlobals();

  /* --- the board at rest -------------------------------------------------- */
  {
    const { dom, view, store } = harness();

    suite.eq('the board builds exactly 25 tiles', dom.tiles.length, MINES.columns * MINES.rows);
    suite.ok(
      'every tile is closed and inert until a round is armed',
      dom.tiles.every((tile) => tile.disabled === true && !tile.classList.contains('is-revealed')),
    );
    suite.ok(
      'the start button is the live action and cash out is not',
      dom.start.hidden === false && dom.cashOut.disabled === true && !dom.cashOut.classList.contains('is-armed'),
    );
    suite.eq('the start button reads as a start', dom.startLabel.textContent, 'Boshlash');
    suite.ok('the idle message is shown', dom.summary.textContent.includes('Boshlash'), dom.summary.textContent);

    suite.eq('the mine count starts at the configured default', dom.mineValue.textContent, String(MINES.defaultCount));
    suite.eq('the bet starts at the default', dom.betValue.textContent, '1 000');
    suite.eq('no tiles are revealed yet', dom.progress.textContent, `0 / ${BOARD_TILES - MINES.defaultCount} katak`);
    suite.eq('and there is no multiplier to show', dom.multiplier.textContent, '—');
    suite.eq(
      'the next tile preview comes off the board, not a table',
      dom.next.textContent,
      `×${minesMultiplier(MINES.defaultCount, 1)}`,
    );
    suite.eq('with nothing at stake', dom.potential.textContent, '0 soqqa');
    suite.eq('the round has not started', view.state, 'idle');
    suite.ok('the balance is untouched', store.getBalance() === STARTING_BALANCE);
  }

  /* --- starting a round --------------------------------------------------- */
  {
    const { dom, view, store } = harness();
    view.start();

    suite.eq('the stake leaves the balance immediately', store.getBalance(), STARTING_BALANCE - DEFAULT_BET);
    suite.eq('the round is live', view.state, 'active');
    suite.ok('the tiles are tappable', dom.tiles.every((tile) => tile.disabled === false));
    suite.ok(
      'and every setting is frozen while it runs',
      dom.stepDown.disabled === true &&
        dom.stepUp.disabled === true &&
        dom.quickChips.every((chip) => chip.disabled === true) &&
        dom.mineChips.every((chip) => chip.disabled === true),
    );
    suite.ok('the board is asking for a tile now', dom.summary.textContent.includes('Katakni oching'), dom.summary.textContent);
    suite.ok('the start button steps aside for the round', dom.start.hidden === true);
    suite.ok('but cashing out is not offered yet', dom.cashOut.disabled === true);
    suite.eq('and nothing is payable before the first tile', dom.potential.textContent, '0 soqqa');
  }

  /* --- a safe tile -------------------------------------------------------- */
  {
    const { dom, view, store, calls } = harness();
    view.start();

    const index = safeTile(view);
    dom.tiles[index].dispatch('click');

    // Deliberately NO await before the assertions below. The click has to be
    // fully accounted for in the same tick: the board, the read-outs and the
    // cash-out button are all consequences of the arithmetic, and the only
    // thing allowed to take 400 ms is the tile's own turn.
    suite.eq('the flip writes the sprite diamond into that tile', view.engine.revealedCount, 1);
    suite.ok(
      'the tile is marked revealed and holds the gem artwork',
      dom.tiles[index].classList.contains('is-revealed') &&
        dom.tiles[index].classList.contains('is-gem') &&
        view.elements.grid.elements.slots[index].innerHTML.includes('#soqqa-sym-diamond'),
    );
    suite.ok('a revealed tile cannot be tapped again', dom.tiles[index].disabled === true);
    suite.ok('its label says what is under it', labelOf(dom.tiles[index]).includes('olmos'), labelOf(dom.tiles[index]));

    suite.eq('the multiplier climbs', dom.multiplier.textContent, `×${minesMultiplier(MINES.defaultCount, 1)}`);
    suite.eq('the next tile preview moves with it', dom.next.textContent, `×${minesMultiplier(MINES.defaultCount, 2)}`);
    suite.eq('and the board says what is now bankable', dom.potential.textContent, '1 100 soqqa');
    suite.eq('the progress counter agrees', dom.progress.textContent, `1 / ${BOARD_TILES - MINES.defaultCount} katak`);
    suite.ok('the message names the multiplier', dom.summary.textContent.includes('×1.1'), dom.summary.textContent);
    suite.ok('cashing out is now armed and gilded', dom.cashOut.disabled === false && dom.cashOut.classList.contains('is-armed'));
    suite.ok('the live read-outs are lit', dom.multiplier.classList.contains('is-live') && dom.potential.classList.contains('is-live'));
    suite.eq('no coins have moved on a reveal', store.getBalance(), STARTING_BALANCE - DEFAULT_BET);
    suite.eq('and nothing has been recorded yet', store.getHistory().length, 0);

    const float = floatOn(dom.tiles[index]);
    suite.ok('a rising ribbon is dropped on the tile', Boolean(float));
    suite.ok(
      'it carries the multiplier and the value gained',
      float?.children?.some((child) => child.textContent === '×1.1') &&
        float?.children?.some((child) => child.textContent === '+1 100'),
      childrenOf(float ?? dom.tiles[index]).map((child) => child.textContent).join(' '),
    );
    suite.eq('a reveal fires no celebration', calls.celebrations, 0);

    // The same tile again: disabled at the board, and refused by the engine
    // underneath it. Neither may count twice.
    await waitFor(() => true, { timeout: 200 });
    const before = view.engine.revealedCount;
    dom.tiles[index].dispatch('click');
    const refused = view.engine.reveal(index);
    await wait(10);
    suite.eq('a second click on the same tile does not count', view.engine.revealedCount, before);
    suite.ok('and the engine refuses it outright', refused.ok === false && refused.reason === 'revealed');
    suite.ok('no second ribbon appears', childrenOf(dom.tiles[index]).filter((child) => child.classList.contains('mines-float')).length <= 1);
  }

  /* --- cashing out -------------------------------------------------------- */
  {
    const { dom, view, store, calls, storageBackend, resultModal, modalDom } = harness();
    view.start();

    const index = safeTile(view);
    dom.tiles[index].dispatch('click');
    await waitFor(() => view.engine.revealedCount === 1);

    const bet = DEFAULT_BET;
    const multiplier = minesMultiplier(MINES.defaultCount, 1);
    const payout = Math.round(bet * multiplier);

    view.handleCashOut();

    suite.eq('the payout lands, once', store.getBalance(), STARTING_BALANCE - bet + payout);
    suite.eq('the round is over', view.state, 'resolved');
    suite.eq('the history keeps the round', store.getHistory().length, 1);

    const [entry] = store.getHistory();
    suite.eq('filed against the mines game', entry.game, 'mines');
    suite.eq('with the stake that was taken', entry.bet, bet);
    suite.eq('the board it was played on', entry.mines, MINES.defaultCount);
    suite.eq('the tiles that were turned', entry.tiles, 1);
    suite.eq('the multiplier that was banked', entry.multiplier, multiplier);
    suite.eq('and the exact payout', entry.payout, payout);
    suite.eq('the lifetime mines counter moves', store.getStats().minesRounds, 1);
    suite.eq('the balance after the round is recorded too', entry.balanceAfter, STARTING_BALANCE - bet + payout);

    suite.eq('exactly one celebration fires, from the overlay', calls.celebrations, 1);
    suite.ok('the overlay is open', resultModal.isOpen === true);
    suite.eq(
      'and it reads the mines fact, not the wheel segment',
      modalDom.factLabel.textContent,
      'Ochilgan kataklar',
    );
    suite.eq(
      'naming the board that was played',
      modalDom.fact.textContent,
      '1 ta katak · 3 ta mina',
    );
    suite.ok('the win message is Uzbek and names the payout', dom.summary.textContent.includes('Yechib olindi'), dom.summary.textContent);
    suite.ok('the table lights for the win', dom.stage.classList.contains('is-win'));
    suite.ok('the balance chip flashes a win', calls.flashes.includes('win'));
    suite.ok('the controls are released again', dom.quickChips.every((chip) => chip.disabled === false));
    suite.eq('and the board offers the next round', dom.startLabel.textContent, 'Yangi o’yin');
    suite.ok('with the button back on screen', dom.start.hidden === false);

    // Paying twice is the failure this whole ladder exists to prevent.
    const paid = store.getBalance();
    view.handleCashOut();
    view.handleCashOut();
    suite.eq('cashing out again pays nothing at all', store.getBalance(), paid);
    suite.eq('and records nothing', store.getHistory().length, 1);
    suite.eq('and celebrates nothing', calls.celebrations, 1);
    suite.ok('the revealed board is left standing for the player to see', dom.tiles[index].classList.contains('is-revealed'));

    // The record has to survive the storage round trip, not just live in memory.
    const reloaded = createStore({ storage: createStorage(storageBackend) });
    const [restored] = reloaded.getHistory();
    suite.eq('the round is still there after a reload', restored?.game, 'mines');
    suite.eq('with its board intact', restored?.mines, MINES.defaultCount);
    suite.eq('and its payout intact', restored?.payout, payout);
  }

  /* --- the board bites ---------------------------------------------------- */
  {
    const { dom, view, store, calls, resultModal } = harness({ rng: createSeededRng(9) });
    view.start();

    const mine = view.engine.round.mineIndices[0];
    dom.tiles[mine].dispatch('click');
    // The board is mid-reveal here: the mine is shown, then everything else.
    await waitFor(() => view.state === 'settling', { timeout: 1_000 });

    suite.ok('the round is not clickable while the board reveals', view.state === 'settling');
    suite.ok('the settings are still frozen through the reveal', dom.mineChips.every((chip) => chip.disabled === true));
    const before = view.engine.revealedCount;
    dom.tiles[safeTile(view)].dispatch('click');
    view.handleCashOut();
    await wait(10);
    suite.eq('a click during the reveal changes nothing', view.engine.revealedCount, before);
    suite.eq('and cashing out mid-reveal cannot pay', store.getBalance(), STARTING_BALANCE - DEFAULT_BET);

    await waitFor(() => view.state === 'resolved', { timeout: 4_000 });

    suite.eq('every tile is shown once the round is over', view.elements.grid.openCount, 25);
    suite.eq('the mines are all marked as mines', tilesWith(dom, 'is-mine').length, MINES.defaultCount);
    suite.ok(
      'and the one that was actually opened is marked as the hit',
      dom.tiles[mine].classList.contains('is-hit') && dom.tiles[mine].classList.contains('is-mine'),
    );
    suite.ok(
      'the mine tile carries the board glyph, not a slot symbol',
      view.elements.grid.elements.slots[mine].innerHTML.includes('#sqMineGlyph'),
    );
    suite.eq('the stake is gone and nothing came back', store.getBalance(), STARTING_BALANCE - DEFAULT_BET);
    suite.ok('the table goes dark red', dom.stage.classList.contains('is-lose'));

    const [entry] = store.getHistory();
    suite.eq('the loss is recorded', entry.game, 'mines');
    suite.eq('as a loss', entry.outcome, 'loss');
    suite.eq('with no payout', entry.payout, 0);
    suite.eq('and no multiplier', entry.multiplier, 0);
    suite.eq('but with the board and the stake kept', `${entry.bet}/${entry.mines}`, `${DEFAULT_BET}/${MINES.defaultCount}`);
    suite.ok('the message names the loss', dom.summary.textContent.includes('Mina!'), dom.summary.textContent);
    suite.ok('a losing board celebrates nothing', calls.celebrations === 0);
    suite.ok('the loss overlay is open instead', resultModal.isOpen === true);
    suite.ok('the chip flashes a loss', calls.flashes.includes('lose'));
    suite.ok('and the board is ready for another round', dom.start.hidden === false && dom.quickChips.every((chip) => chip.disabled === false));
  }

  /* --- the end-of-round wave --------------------------------------------- */
  // The board does not repaint itself when it ends: the mine lands, a beat is
  // held, and then the tiles turn outward from the damage, one after another.
  // This measures that from the tiles' own class changes — the exact moment each
  // one starts its turn — so it asserts the real order and the real pacing
  // rather than reading back a list the test built itself.
  {
    const { dom, view } = harness({ rng: createSeededRng(9) });

    const order = [];
    dom.tiles.forEach((tile, index) => {
      const realAdd = tile.classList.add;
      tile.classList.add = (...names) => {
        if (names.includes('is-revealed') && !tile.classList.contains('is-revealed')) {
          order.push({ index, at: Date.now(), holding: dom.grid.classList.contains('is-revealing') });
        }
        return realAdd(...names);
      };
    });

    view.start();
    const mine = view.engine.round.mineIndices[0];
    const clickedAt = Date.now();
    dom.tiles[mine].dispatch('click');
    await waitFor(() => view.state === 'resolved', { timeout: 5_000 });

    const [hit, ...wave] = order;
    const distance = (index) => {
      const [x, y] = [index % MINES.columns, Math.floor(index / MINES.columns)];
      const [mx, my] = [mine % MINES.columns, Math.floor(mine / MINES.columns)];
      return Math.max(Math.abs(x - mx), Math.abs(y - my));
    };

    suite.eq('the mine turns on its own first', hit?.index, mine);
    suite.eq('and the rest of the board follows it', wave.length, 25 - 1);
    suite.ok(
      'the wave starts on the tiles beside the mine, not at a corner of the board',
      distance(wave[0].index) === 1 && wave.slice(0, 3).every((entry) => distance(entry.index) <= 2),
      wave.slice(0, 3).map((entry) => distance(entry.index)).join(', '),
    );

    const rings = wave.map((entry) => distance(entry.index));
    suite.ok(
      'and only ever moves outward, ring by ring',
      rings.every((ring, index) => index === 0 || ring >= rings[index - 1]),
      rings.join(', '),
    );
    suite.eq(
      'every tile is turned exactly once',
      new Set(order.map((entry) => entry.index)).size,
      order.length,
    );

    // The beat. Without it the board starts turning in the same frame as the hit
    // and the mine reads as just one more tile.
    const beat = wave[0].at - clickedAt;
    suite.ok(
      'a beat is held after the mine before the wave starts',
      beat >= MINES.revealLeadMs * 0.6,
      `${beat} ms against a ${MINES.revealLeadMs} ms lead`,
    );
    suite.ok('the mine does not carry that hold with it', hit.holding === false);

    // Pacing, against the config's own stagger for a 24-tile wave. The board used
    // to start a tile roughly every 46 ms; this fails that.
    const expected = Math.max(
      MINES.minStaggerMs,
      Math.min(MINES.staggerMs, MINES.settleBudgetMs / wave.length),
    );
    const gaps = wave
      .slice(1)
      .map((entry, index) => entry.at - wave[index].at)
      .sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    suite.ok(
      'and paces the wave deliberately rather than rushing it',
      median >= expected * 0.75 && median <= expected * 1.75,
      `median gap ${median} ms against an expected ${expected.toFixed(1)} ms`,
    );

    suite.ok(
      'the unturned board is held back while the wave runs',
      wave.every((entry) => entry.holding === true),
    );
    suite.ok(
      'and the hold is released once the board is done',
      dom.grid.classList.contains('is-revealing') === false,
    );
  }

  /* --- the celebration tier ---------------------------------------------- */
  // The stage's tier is the stylesheet's cue for a longer, brighter ripple, and
  // it has to come from the multiplier rather than from how many coins came back.
  {
    const { dom, view } = harness({ rng: createSeededRng(3) });
    view.start();
    dom.tiles[safeTile(view)].dispatch('click');
    await waitFor(() => view.engine.revealedCount === 1, { timeout: 500 });
    view.handleCashOut();

    const ordinary = minesMultiplier(MINES.defaultCount, 1);
    suite.ok(
      'an ordinary cash out lights the table without promoting it',
      ordinary < MINES.bigWinMultiplier &&
        dom.stage.classList.contains('is-win') &&
        !dom.stage.classList.contains('is-big'),
      `×${ordinary}`,
    );

    // 24 mines and one safe tile: ×24, comfortably past the tier.
    dom.mineChips[4].dispatch('click');
    view.start();
    suite.ok('a new round clears the last tier', !dom.stage.classList.contains('is-big'));
    dom.tiles[safeTile(view)].dispatch('click');
    await waitFor(() => view.engine.revealedCount === 1, { timeout: 500 });
    const big = minesMultiplier(24, 1);
    view.handleCashOut();

    suite.ok(
      'a cash out past the tier is promoted, for a bigger celebration',
      big >= MINES.bigWinMultiplier && dom.stage.classList.contains('is-big'),
      `×${big}`,
    );
  }

  /* --- the selectors ------------------------------------------------------ */
  {
    const { dom, view } = harness();

    dom.mineUp.dispatch('click');
    dom.mineUp.dispatch('click');
    suite.eq('the mine stepper walks the count', dom.mineValue.textContent, '5');
    suite.eq(
      'and the HUD re-prices off the new board',
      dom.next.textContent,
      `×${minesMultiplier(5, 1)}`,
    );
    suite.eq('the progress ceiling follows too', dom.progress.textContent, `0 / ${BOARD_TILES - 5} katak`);

    dom.mineChips[4].dispatch('click');
    suite.eq('a quick chip jumps the count', dom.mineValue.textContent, '24');
    suite.eq('to the top of the ladder', dom.next.textContent, `×${minesMultiplier(24, 1)}`);
    suite.eq('where exactly one tile is safe', dom.progress.textContent, '0 / 1 katak');
    suite.ok('and every other chip lets go', dom.mineChips.filter((chip) => chip.classList.contains('is-active')).length === 1);
    suite.ok('the stepper cannot go past the board', dom.mineUp.disabled === true && dom.mineDown.disabled === false);

    // A round on a 24-mine board: the very first tile is nearly always the end.
    view.start();
    suite.ok(
      'the settings are locked to the board that was drawn',
      dom.mineChips.every((chip) => chip.disabled === true) && dom.mineDown.disabled === true,
    );
    dom.mineChips[0].dispatch('click');
    await wait(10);
    suite.eq('and a chip pressed mid-round cannot re-price it', dom.mineValue.textContent, '24');
    suite.eq('nor can the engine be talked into a different board', view.engine.round.mineCount, 24);
  }

  /* --- not enough coins --------------------------------------------------- */
  {
    const { dom, view, store, calls } = harness({ backend: poorBackend(500) });
    view.start();

    suite.eq('an unaffordable stake never leaves the balance', store.getBalance(), 500);
    suite.eq('no round is started', view.state, 'idle');
    suite.ok('the board stays sealed', dom.tiles.every((tile) => tile.disabled === true));
    suite.ok(
      'and the player is told why',
      calls.toasts.some((toast) => toast.kind === 'warning') && dom.summary.textContent.includes('Mablag'),
      dom.summary.textContent,
    );
    suite.eq('nothing was recorded', store.getHistory().length, 0);
  }

  /* --- reduced motion ----------------------------------------------------- */
  {
    const restoreReduced = installGlobals({ reducedMotion: true });
    const { dom, view } = harness();
    view.start();

    const index = safeTile(view);
    dom.tiles[index].dispatch('click');

    suite.ok('the board still turns with motion turned off', dom.tiles[index].classList.contains('is-revealed'));
    suite.ok(
      'but no ribbon is built at all, so none can sit there frozen',
      childrenOf(dom.tiles[index]).every((child) => !child.classList.contains('mines-float')),
      String(childrenOf(dom.tiles[index]).length),
    );
    suite.eq('the read-outs still update', dom.multiplier.textContent, `×${minesMultiplier(MINES.defaultCount, 1)}`);
    await waitFor(() => view.engine.revealedCount === 1, { timeout: 500 });
    restoreReduced();
  }

  /* --- the history row ---------------------------------------------------- */
  {
    const { store } = harness();
    store.recordSpin({ game: 'mines', bet: 5_000, mines: 5, tiles: 7, multiplier: 2.73, payout: 13_650 });

    const list = createElement('ul');
    const empty = createElement('div');
    const summary = createElement('p');
    const root = createElement('section');
    const looked = {
      '[data-history-list]': list,
      '[data-history-empty]': empty,
      '[data-history-summary]': summary,
      '[data-action="clear-history"]': null,
    };
    root.querySelector = (selector) => looked[selector] ?? null;

    createHistoryView(root).render(store.getState());

    const [row] = list.children;
    suite.eq('a mines round renders one history row', list.children.length, 1);
    suite.ok(
      'and its middle cell names the board instead of a dash',
      childrenOf(row).some((cell) => cell.textContent === '7 katak · 5 mina'),
      childrenOf(row).map((cell) => cell.textContent).join(' | '),
    );
    suite.ok(
      'with a mark of its own rather than the slots one',
      childrenOf(row).some((cell) => cell.textContent === '\ud83d\udca0') &&
        childrenOf(row).every((cell) => cell.textContent !== '\ud83c\udfb0'),
      childrenOf(row).map((cell) => cell.textContent).join(' | '),
    );
    suite.ok(
      'and the win is summarised in Uzbek',
      childrenOf(row).some((cell) => cell.textContent === 'Yutuq ×2.73'),
      childrenOf(row).map((cell) => cell.textContent).join(' | '),
    );
  }

  /* --- the view tolerates a missing DOM ---------------------------------- */
  {
    const store = createStore({ storage: createStorage(createMemoryStorage()) });
    const view = createMinesView({ store, root: null, balanceView: null, toaster: { show() {} } });
    suite.ok('a missing root degrades to a no-op', typeof view.init === 'function');
    suite.ok('and never throws on start', view.start() === undefined);
    suite.ok('...or on cash out', view.handleCashOut() === undefined);
    suite.ok('and reports no live round', view.isRoundActive === false);
  }

  restore();
}

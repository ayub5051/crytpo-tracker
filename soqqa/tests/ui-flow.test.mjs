/* ============================================================================
   SOQQA — slots UI flow (integration)
   Runs the real view controller against a shim DOM to verify the end-to-end
   spin flow: locking, deduction, continuous reel motion, payout, history,
   messages. The trajectory itself is asserted exactly in
   tests/reel-physics.test.mjs; here it is asserted as the player would see it —
   by sampling the live view while a turn runs.
   ========================================================================= */

import { DEFAULT_BET, REEL_STRIP, REEL_TURN, STARTING_BALANCE, STORAGE_KEYS, SYMBOL_ORDER } from '../js/config.js';
import { createStore } from '../js/store/state.js';
import { createMemoryStorage, createStorage } from '../js/store/storage.js';
import { createSlotsView } from '../js/views/slotsView.js';
import { cellIndexAt, wrap } from '../js/ui/reelPhysics.js';
import { reelTurnTotalMs } from '../js/ui/reelView.js';
import { celebrationFor, createResultModal } from '../js/ui/resultModal.js';
import { createStubRng } from '../js/utils/rng.js';
import { createModalDom, createSlotsDom, installGlobals, wait, waitFor } from './fakeDom.mjs';

const IDX = Object.fromEntries(SYMBOL_ORDER.map((id, index) => [id, index]));

/** The beats a turning drum passes through, in order. */
const PHASE_ORDER = ['is-spinning', 'is-peak', 'is-braking', 'is-landing'];
const ALL_REEL_STATES = [...PHASE_ORDER, 'is-turning', 'is-locking'];

/**
 * A teleport would show up as a step of at least one cycle (the strip is
 * periodic, so anything smaller could be a legal wrap). The real motion peaks
 * well under a cell per frame, so this bound is generous yet still catches any
 * "snap the symbol into place" regression.
 */
const MAX_STEP_CELLS = 5;

function harness({ symbols, backend = null, bet = DEFAULT_BET, withModal = true } = {}) {
  const storageBackend = backend ?? createMemoryStorage();
  const store = createStore({ storage: createStorage(storageBackend) });

  const dom = createSlotsDom();
  const calls = { toasts: [], flashes: [], celebrations: 0 };

  const balanceView = {
    render() {},
    update() {},
    flash: (kind) => calls.flashes.push(kind),
  };
  const toaster = { show: (message, options) => calls.toasts.push({ message, ...options }) };
  const confetti = { celebrate: () => (calls.celebrations += 1), stop() {}, destroy() {} };

  // The overlay the cabinet opens on a win. Both the overlay and the cabinet
  // share one confetti stub, so a double-fired burst would show up as 2.
  const modalDom = createModalDom();
  const resultModal = withModal ? createResultModal(modalDom.container, { confetti }) : null;

  const view = createSlotsView({
    store,
    root: dom.root,
    balanceView,
    toaster,
    confetti,
    resultModal,
    rng: createStubRng(symbols.map((id) => IDX[id])),
  });

  return { store, dom, view, calls, bet, modalDom, resultModal };
}

/** The beat a drum is in right now, or null once it is seated. */
const phaseOf = (reel) => PHASE_ORDER.find((name) => reel.classList.contains(name)) ?? null;

/**
 * Watch a spin from the outside: the position and beat of every drum, sampled on
 * a timer for as long as the turn runs. There is deliberately no blur channel —
 * the strips are never filtered, which the assertions below prove directly.
 */
function startSampler(view, dom, interval = 8) {
  const samples = [];
  let running = true;

  const loop = (async () => {
    while (running) {
      samples.push({
        t: Date.now(),
        p: [0, 1, 2].map((index) => view.reels.position(index)),
        phase: dom.reels.map(phaseOf),
      });
      await wait(interval);
    }
  })();

  return {
    samples,
    stop: async () => {
      running = false;
      await loop;
      return samples;
    },
  };
}

/** The largest single-sample step of a drum, folded into one cycle. */
function maxStep(positions) {
  let worst = 0;
  for (let i = 1; i < positions.length; i += 1) {
    const delta = positions[i] - positions[i - 1];
    worst = Math.max(worst, Math.abs(delta - Math.round(delta / REEL_STRIP.cycleCells) * REEL_STRIP.cycleCells));
  }
  return worst;
}

export async function runUiFlowTests(suite) {
  const restore = installGlobals();

  /* --- initial state ---------------------------------------------------- */
  {
    const { dom, view, store } = harness({ symbols: ['seven', 'seven', 'seven'] });
    view.init();

    suite.ok('spin button is enabled at boot', dom.spinButton.disabled === false);
    suite.eq('bet value renders with grouping', dom.betValue.textContent, '1 000');
    suite.eq('bet starts at the default', view.elements.betControls.getBet(), DEFAULT_BET);
    suite.ok('the paytable is rendered from config', dom.paytableList.children.length === SYMBOL_ORDER.length);
    suite.eq('store starts at 1 000 000', store.getBalance(), STARTING_BALANCE);
  }

  /* --- the strips are built once, and never rebuilt ---------------------- */
  {
    const { dom, view } = harness({ symbols: ['seven', 'seven', 'seven'] });
    view.init();

    suite.eq(
      'each drum renders the configured number of cells',
      dom.reels.map((reel) => reel.strip.children.length),
      [0, 1, 2].map(() => REEL_STRIP.cells),
    );
    suite.ok(
      'every cell carries its symbol and points at the sprite',
      dom.reels.every((reel, drum) =>
        reel.strip.children.every((cell, index) => {
          const expected = view.reels.stripSymbols(drum)[index];
          return (
            cell.dataset.symbol === expected &&
            cell.classList.contains('reel-symbol') &&
            cell.innerHTML.includes(`href="#soqqa-sym-${expected}"`)
          );
        }),
      ),
    );
    suite.ok(
      'the payline row always has a full row of strip above and below it',
      [0, 1, 2].every((drum) => {
        const index = view.reels.paylineIndex(drum);
        return index >= 1 && index + 1 <= REEL_STRIP.cells - 1;
      }),
      [0, 1, 2].map((drum) => view.reels.paylineIndex(drum)).join(', '),
    );
    suite.ok(
      'the payline index is the cell the constant says it is',
      [0, 1, 2].every((drum) => cellIndexAt(view.reels.position(drum)) === view.reels.paylineIndex(drum)),
    );
  }

  /* --- bet controls ------------------------------------------------------ */
  {
    const { dom, view } = harness({ symbols: ['seven', 'seven', 'seven'] });
    view.init();

    dom.stepUp.dispatch('click');
    suite.eq('+ steps up the ladder', view.elements.betControls.getBet(), 5_000);
    dom.stepDown.dispatch('click');
    suite.eq('− steps back down', view.elements.betControls.getBet(), 1_000);
    suite.ok('− is disabled on the first ladder step', dom.stepDown.disabled === true);

    dom.quickChips[3].dispatch('click');
    suite.eq('quick chip selects its amount', view.elements.betControls.getBet(), 100_000);
    suite.ok('the active chip is marked', dom.quickChips[3].classList.contains('is-active'));

    dom.quickChips[0].dispatch('click');
    suite.eq('a lower quick chip still works', view.elements.betControls.getBet(), 1_000);
  }

  /* --- a winning spin: continuous motion, staggered stops, payout -------- */
  {
    const { dom, view, store, calls, modalDom, resultModal } = harness({ symbols: ['seven', 'seven', 'seven'] });
    view.init();

    const stripsBefore = [0, 1, 2].map((drum) => view.reels.stripSymbols(drum).join(','));
    const cellsBefore = [0, 1, 2].map((drum) =>
      view.reels.stripCells(drum).map((cell) => cell.dataset.symbol).join(','),
    );
    const startedAt = Date.now();
    const spin = view.handleSpin();

    // Locked synchronously, before a single frame has run.
    suite.ok('controls lock immediately', dom.spinButton.disabled === true);
    suite.ok('the cabinet is marked as locked', dom.root.classList.contains('is-locked'));
    suite.ok('active chips are locked while spinning', dom.quickChips.every((chip) => chip.disabled === true));
    suite.ok('the bet is deducted before the reels stop', store.getBalance() === STARTING_BALANCE - 1_000);
    suite.ok(
      'the take-off starts on the spot, in the first beat',
      dom.reels.every((reel) => reel.classList.contains('is-turning') && reel.classList.contains('is-spinning')),
      dom.reels.map((reel) => reel.classListSnapshot.join('+')).join(' | '),
    );
    // The engine decided this turn before the first frame, so the cabinet already
    // knows a lock is going to pay. That is what scopes the gold glint — and what
    // makes a losing stop come out completely dark.
    suite.ok(
      'the cabinet is flagged as a paying turn before the first frame',
      dom.windowEl.classList.contains('is-paying'),
    );

    const sampler = startSampler(view, dom);

    // Each drum has its own schedule: the left one must be braking or landing
    // while the right one is still at full speed.
    suite.ok(
      'the drums run on independent timelines',
      await waitFor(
        () => dom.reels[0].classList.contains('is-braking') && dom.reels[2].classList.contains('is-peak'),
        { timeout: 1_600 },
      ),
      dom.reels.map((reel) => reel.classListSnapshot.join('+')).join(' | '),
    );

    suite.ok(
      'the leftmost drum locks well before the last one',
      await waitFor(() => phaseOf(dom.reels[0]) === null, { timeout: 2_400 }),
    );
    suite.ok(
      'an earlier drum stays locked while the others keep turning',
      phaseOf(dom.reels[0]) === null && phaseOf(dom.reels[2]) !== null,
      dom.reels.map((reel) => reel.classListSnapshot.join('+')).join(' | '),
    );
    suite.eq(
      'the locked drum already rests on the engine symbol',
      view.reels.paylineSymbol(0),
      'seven',
    );
    suite.eq(
      'the locked drum points its artwork at the sprite',
      view.reels.stripCells(0)[view.reels.paylineIndex(0)].dataset.symbol,
      'seven',
    );
    suite.ok('controls are still locked mid-turn', dom.spinButton.disabled === true);

    suite.ok(
      'the last drum locks too',
      await waitFor(() => phaseOf(dom.reels[2]) === null, { timeout: 3_000 }),
    );

    await spin;
    const elapsed = Date.now() - startedAt;
    const samples = await sampler.stop();

    suite.ok('the motion was actually sampled', samples.length > 90, `${samples.length} samples`);
    suite.ok(
      'the turn lasts as long as the config schedules',
      elapsed >= reelTurnTotalMs() - 150 && elapsed <= reelTurnTotalMs() + 600,
      `${elapsed}ms vs ${reelTurnTotalMs()}ms`,
    );

    /* --- the motion itself --------------------------------------------- */
    const perDrum = [0, 1, 2].map((drum) => samples.map((sample) => sample.p[drum]));
    // Only the samples taken while the drum was still turning: the final seating
    // folds the unfolded position back into the band, which is a whole cycle.
    const whileTurning = [0, 1, 2].map((drum) =>
      samples.filter((sample) => sample.phase[drum] !== null).map((sample) => sample.p[drum]),
    );

    suite.ok(
      'every drum moved through many distinct positions',
      whileTurning.every((positions) => new Set(positions).size > 40),
      whileTurning.map((positions) => new Set(positions).size).join(', '),
    );
    suite.ok(
      'no drum ever teleports (every step stays far below one cycle)',
      perDrum.every((positions) => maxStep(positions) < MAX_STEP_CELLS),
      perDrum.map((positions) => maxStep(positions).toFixed(2)).join(', '),
    );
    suite.ok(
      'each drum physically travels the configured distance',
      whileTurning.every(
        (positions) =>
          Math.max(...positions) - Math.min(...positions) >= REEL_TURN.travelMinCells &&
          Math.max(...positions) - Math.min(...positions) <= REEL_TURN.travelMaxCells + REEL_TURN.overshootCells,
      ),
      whileTurning
        .map((positions) => (Math.max(...positions) - Math.min(...positions)).toFixed(1))
        .join(', '),
    );
    suite.ok(
      'each drum travels several times the cycle, so the drawn symbol really arrives',
      whileTurning.every((positions) => Math.max(...positions) - Math.min(...positions) > REEL_STRIP.cycleCells),
    );

    /* --- crisp scroll: one number, and nothing else ---------------------- */
    // A strip's whole state is its position. If a spin ever started writing a
    // filter, a blur or an opacity, the symbols would stop being razor sharp —
    // so the offset must be the only thing the loop is allowed to touch.
    const stripWrites = [...new Set(dom.reels.flatMap((reel) => Object.keys(reel.strip.style)))];
    suite.ok(
      'a spin writes nothing to a strip except its numeric offset',
      stripWrites.every(
        (key) => key === '--reel-offset' || key === 'setProperty' || key === 'getPropertyValue',
      ),
      stripWrites.join(', '),
    );
    suite.ok(
      'no drum is ever given a blur to hide behind',
      dom.reels.every((reel) => reel.strip.style.getPropertyValue('--reel-blur') === ''),
      dom.reels.map((reel) => reel.strip.style.getPropertyValue('--reel-blur')).join(' | '),
    );

    // Staggered stops: each drum's beat disappears later than the one before it.
    const lockedIn = [0, 1, 2].map((drum) => samples.findIndex((sample) => sample.phase[drum] === null));
    suite.ok(
      'the drums stop left to right',
      lockedIn.every((index, drum) => index >= 0 && (drum === 0 || index > lockedIn[drum - 1])),
      lockedIn.join(' → '),
    );
    const lockTimes = lockedIn.map((index) => samples[index].t - samples[0].t);
    suite.ok(
      'the stops follow the configured schedule',
      REEL_TURN.stopAtMs.every((stop, drum) => Math.abs(lockTimes[drum] - stop) < 250),
      `${lockTimes.join(' / ')} vs ${REEL_TURN.stopAtMs.join(' / ')}`,
    );
    suite.ok(
      'a seated drum never moves again for the rest of the turn',
      [0, 1, 2].every((drum) => {
        const positions = samples.map((sample) => sample.p[drum]).slice(lockedIn[drum]);
        return positions.every((p) => p === positions[0]);
      }),
    );

    /* --- strips are immutable ------------------------------------------ */
    suite.ok(
      'no strip symbol was ever swapped, added or removed',
      [0, 1, 2].every(
        (drum) =>
          view.reels.stripSymbols(drum).join(',') === stripsBefore[drum] &&
          view.reels.stripCells(drum).map((cell) => cell.dataset.symbol).join(',') === cellsBefore[drum],
      ),
    );
    suite.ok(
      'each drum rests on the exact cell the engine drew',
      [0, 1, 2].every((drum) => view.reels.paylineSymbol(drum) === 'seven'),
      [0, 1, 2].map((drum) => view.reels.paylineSymbol(drum)).join(', '),
    );
    suite.ok(
      'the resting position is inside the band the strip covers',
      [0, 1, 2].every((drum) => wrap(view.reels.position(drum)) === view.reels.position(drum)),
    );
    suite.ok(
      'every drum stops exactly on a cell boundary, not near one',
      [0, 1, 2].every((drum) => Number.isInteger(wrap(view.reels.position(drum)))),
      [0, 1, 2].map((drum) => view.reels.position(drum)).join(', '),
    );

    /* --- end of turn ---------------------------------------------------- */
    suite.ok(
      'every reel state is cleared when the turn ends',
      dom.reels.every((reel) => ALL_REEL_STATES.every((name) => !reel.classList.contains(name))),
      dom.reels.map((reel) => reel.classListSnapshot.join('+')).join(' | '),
    );

    suite.eq('payout is credited once', store.getBalance(), STARTING_BALANCE - 1_000 + 60_000);
    suite.eq('the winning line is recorded', store.getHistory().length, 1);

    const [entry] = store.getHistory();
    suite.eq('history keeps the symbols', entry.symbols.join(','), 'seven,seven,seven');
    suite.eq('history keeps the multiplier', entry.multiplier, 60);
    suite.eq('history keeps the payout', entry.payout, 60_000);
    suite.eq('history keeps the balance snapshot', entry.balanceAfter, store.getBalance());
    suite.eq('history marks the outcome', entry.outcome, 'win');

    suite.ok('controls unlock after the spin', dom.spinButton.disabled === false);
    suite.ok('the locked flag is cleared', dom.root.classList.contains('is-locked') === false);
    suite.ok('the win message is shown', dom.summary.classList.contains('is-win'), dom.summary.textContent);
    suite.ok('the summary mentions the multiplier', dom.summary.textContent.includes('×60'), dom.summary.textContent);
    suite.ok('the balance chip flashes a win', calls.flashes.includes('win'));
    suite.ok('a significant win triggers confetti', calls.celebrations === 1);
    suite.ok('the win overlay is open', resultModal.isOpen === true);
    suite.ok('the overlay container is on screen', modalDom.container.hidden === false);
    suite.eq('the top tier is announced as a jackpot', modalDom.title.textContent, 'Jekpot!');
    suite.ok('the overlay panel is flagged as a jackpot', modalDom.panel.classList.contains('is-jackpot'));
    suite.eq('the overlay names the fact row for slots', modalDom.factLabel.textContent, 'Belgilar');
    suite.eq(
      'the overlay lists the paying line',
      modalDom.fact.textContent,
      'Yettilik · Yettilik · Yettilik',
    );
    suite.eq('the overlay shows the multiplier', modalDom.multiplier.textContent, '×60');
    suite.eq('the overlay shows the net result', modalDom.amount.textContent, '+59 000');
    suite.eq(
      'the overlay shows the balance after the payout',
      modalDom.balance.textContent,
      'Balans: 1 059 000 soqqa',
    );
    suite.ok('the overlay fires the burst, and only once', calls.celebrations === 1);
    suite.ok('winning cells are highlighted', view.reels.paylineCell(0)?.classList.contains('is-win'));
    suite.ok('only the two matched drums are lit for a pair, three for a triple',
      [0, 1, 2].every((drum) => view.reels.paylineCell(drum)?.classList.contains('is-win')));
    suite.ok('the cabinet is lit for the win', dom.windowEl.classList.contains('is-win'));
    suite.ok('a ×60 win deepens the cabinet glow', dom.windowEl.classList.contains('is-big-win'));
    suite.ok('a ×60 win gets the jackpot light show', dom.windowEl.classList.contains('is-jackpot'));
    suite.ok(
      'the lock cue ran on each drum\'s own landing beat',
      dom.reels.every((reel) => Number(reel.style.getPropertyValue('--reel-lock-ms').replace('ms', '')) > 0),
      dom.reels.map((reel) => reel.style.getPropertyValue('--reel-lock-ms')).join(', '),
    );
    suite.ok(
      'the strip offset is always a finite number',
      dom.reels.every((reel) =>
        Number.isFinite(Number(reel.strip.style.getPropertyValue('--reel-offset'))),
      ),
      dom.reels.map((reel) => reel.strip.style.getPropertyValue('--reel-offset')).join(', '),
    );
  }

  /* --- duplicate spins are ignored --------------------------------------- */
  {
    const { view, store, dom } = harness({ symbols: ['seven', 'seven', 'seven'] });
    view.init();

    const first = view.handleSpin();
    const second = view.handleSpin(); // fired while the first is running
    await Promise.all([first, second]);

    suite.eq('only one spin is recorded', store.getHistory().length, 1);
    suite.eq('the balance is debited once', store.getBalance(), STARTING_BALANCE - 1_000 + 60_000);
    suite.ok('controls are usable again', dom.spinButton.disabled === false);
  }

  /* --- a click during the lock flash is ignored -------------------------- */
  {
    const { dom, view, store } = harness({ symbols: ['seven', 'seven', 'seven'] });
    view.init();

    const spin = view.handleSpin();
    suite.ok(
      'the last drum locks',
      await waitFor(() => phaseOf(dom.reels[2]) === null, { timeout: 4_000 }),
    );
    suite.ok('controls are still locked mid-lock-flash', dom.spinButton.disabled === true);

    const extra = view.handleSpin(); // hammered while the cabinet is settling
    await Promise.all([spin, extra]);

    suite.eq('a second spin during the lock flash is ignored', store.getHistory().length, 1);
    suite.eq('the balance was debited once', store.getBalance(), STARTING_BALANCE - 1_000 + 60_000);
    suite.eq('the payout was credited once', store.getHistory()[0].payout, 60_000);
    suite.ok('controls unlock once the cabinet settles', dom.spinButton.disabled === false);
  }

  /* --- a losing spin ----------------------------------------------------- */
  {
    const { dom, view, store, calls, modalDom, resultModal } = harness({ symbols: ['cherry', 'coin', 'bell'] });
    view.init();

    await view.handleSpin();

    suite.eq('a loss pays nothing', store.getBalance(), STARTING_BALANCE - 1_000);
    suite.eq('the loss is recorded', store.getHistory()[0].outcome, 'loss');
    suite.eq('the loss multiplier is 0', store.getHistory()[0].multiplier, 0);
    suite.ok('the loss message is shown', dom.summary.classList.contains('is-lose'));
    suite.ok('no confetti on a loss', calls.celebrations === 0);
    suite.ok('no overlay covers the cabinet on a loss', resultModal.isOpen === false);
    suite.ok('the overlay container stays hidden', modalDom.container.hidden === true);
    suite.ok(
      'a losing turn is never flagged as paying, so no lock ever flashes gold',
      dom.windowEl.classList.contains('is-paying') === false,
    );
    suite.ok('the chip flashes a loss', calls.flashes.includes('lose'));
    suite.ok('nothing is highlighted', [0, 1, 2].every((drum) => !view.reels.paylineCell(drum)?.classList.contains('is-win')));
    suite.ok('the cabinet stays unlit on a loss', dom.windowEl.classList.contains('is-win') === false);
    suite.ok('a loss runs no celebration lighting', !dom.windowEl.classList.contains('is-jackpot'));
    suite.ok(
      'every drum still landed on the drawn symbol on a loss',
      ['cherry', 'coin', 'bell'].every((symbol, drum) => view.reels.paylineSymbol(drum) === symbol),
      [0, 1, 2].map((drum) => view.reels.paylineSymbol(drum)).join(', '),
    );
  }

  /* --- pair win (two of a kind) ------------------------------------------ */
  {
    const { view, store, dom, calls, modalDom, resultModal } = harness({
      symbols: ['bell', 'bell', 'coin'],
    });
    view.init();

    await view.handleSpin();

    suite.eq('a pair pays ×5 on a 1 000 bet', store.getBalance(), STARTING_BALANCE - 1_000 + 5_000);
    suite.eq('the pair is recorded as a two-match', store.getHistory()[0].matchType, 'two');
    suite.ok(
      'only the first two cells are highlighted',
      view.reels.paylineCell(0).classList.contains('is-win') &&
        view.reels.paylineCell(1).classList.contains('is-win') &&
        !view.reels.paylineCell(2).classList.contains('is-win'),
    );
    suite.ok('a pair win shows the win message', dom.summary.classList.contains('is-win'));
    suite.ok('a pair win lights the cabinet too', dom.windowEl.classList.contains('is-win'));
    suite.ok('a pair win is not a big win', dom.windowEl.classList.contains('is-big-win') === false);
    suite.ok('a pair win is not a jackpot', dom.windowEl.classList.contains('is-jackpot') === false);
    suite.ok('every win celebrates, not just a big one', calls.celebrations === 1);
    suite.eq(
      'an ordinary win is announced as a congratulations',
      modalDom.title.textContent,
      'Tabriklaymiz!',
    );
    suite.ok(
      'an ordinary win is not flagged as a jackpot',
      modalDom.panel.classList.contains('is-jackpot') === false,
    );

    // "Yana o'ynash" replays through the cabinet rather than around it, so the
    // guard, the stake and the payout all still apply.
    modalDom.replay.dispatch('click');
    suite.ok('the replay dismisses the overlay', resultModal.isOpen === false);
    suite.ok(
      'the replay runs a real spin through the cabinet',
      await waitFor(() => store.getHistory().length === 2, { timeout: 4_000 }),
      `${store.getHistory().length} records`,
    );
    suite.ok('the replayed win re-opens the overlay', resultModal.isOpen === true);
    suite.ok('controls are usable again after the replay', dom.spinButton.disabled === false);
  }

  /* --- big win (the middle tier) ----------------------------------------- */
  {
    const { view, store, dom, modalDom } = harness({ symbols: ['diamond', 'diamond', 'diamond'] });
    view.init();

    await view.handleSpin();

    suite.eq('a diamond triple pays ×38', store.getHistory()[0].multiplier, 38);
    suite.eq(
      'a big win is announced as one',
      modalDom.title.textContent,
      'Katta yutuq!',
    );
    suite.ok('a ×38 win gets the cabinet bloom', dom.windowEl.classList.contains('is-big-win'));
    suite.ok('a ×38 win is below the jackpot tier', dom.windowEl.classList.contains('is-jackpot') === false);
    suite.ok('a big win is not flagged as a jackpot in the overlay', modalDom.panel.classList.contains('is-jackpot') === false);
  }

  /* --- insufficient balance --------------------------------------------- */
  {
    const backend = createMemoryStorage();
    backend.setItem(STORAGE_KEYS.balance, JSON.stringify({ coins: 1_000, updatedAt: 0 }));
    const { view, store, calls, dom } = harness({
      symbols: ['cherry', 'coin', 'bell'],
      backend,
      bet: 1_000,
    });
    view.init();

    await view.handleSpin(); // spends the whole balance
    suite.eq('balance is now zero', store.getBalance(), 0);
    suite.ok('the spin button disables at zero balance', dom.spinButton.disabled === true);

    await view.handleSpin();
    suite.eq('no extra record is written', store.getHistory().length, 1);
    suite.ok(
      'the player is told the balance is too low',
      calls.toasts.some((toast) => toast.message.includes('Mablag')),
      JSON.stringify(calls.toasts),
    );
    suite.ok('no negative balance is possible', store.getBalance() >= 0);
  }

  /* --- reduced motion: same beats, no animation -------------------------- */
  {
    const restoreMotion = installGlobals({ reducedMotion: true });
    try {
      const { dom, view, store } = harness({ symbols: ['bell', 'bell', 'coin'] });
      view.init();

      await view.handleSpin();

      suite.eq('reduced motion still pays the pair', store.getBalance(), STARTING_BALANCE - 1_000 + 5_000);
      suite.eq('reduced motion lands on the engine symbol', view.reels.paylineSymbol(0), 'bell');
      suite.ok(
        'reduced motion clears every reel state',
        dom.reels.every((reel) => ALL_REEL_STATES.every((name) => !reel.classList.contains(name))),
      );
      suite.ok(
        'reduced motion writes no blur either',
        dom.reels.every((reel) => reel.strip.style.getPropertyValue('--reel-blur') === ''),
      );
      suite.ok('reduced motion unlocks the controls', dom.spinButton.disabled === false);
      suite.ok('reduced motion still highlights the win', view.reels.paylineCell(0).classList.contains('is-win'));
    } finally {
      restoreMotion();
    }
  }

  /* --- a win with no overlay available ---------------------------------- */
  {
    const { view, dom, store, calls, resultModal } = harness({
      symbols: ['bell', 'bell', 'coin'],
      withModal: false,
    });
    view.init();

    await view.handleSpin();

    suite.ok('no overlay is built when none is injected', resultModal === null);
    suite.eq('the win still pays', store.getBalance(), STARTING_BALANCE - 1_000 + 5_000);
    suite.ok('the cabinet celebrates on its own without an overlay', calls.celebrations === 1);
    suite.ok('the cabinet is still lit', dom.windowEl.classList.contains('is-win'));
  }

  /* --- the celebration ladder ------------------------------------------- */
  {
    const plain = celebrationFor({ multiplier: 2 });
    const big = celebrationFor({ multiplier: 60, big: true });
    const jackpot = celebrationFor({ jackpot: true });

    suite.ok(
      'any win gets a real burst',
      plain.intensity >= 1.4 && plain.fan === 1,
      String(plain.intensity),
    );
    suite.ok(
      'a bigger win gets a bigger burst',
      big.intensity > plain.intensity,
      `${plain.intensity} → ${big.intensity}`,
    );
    suite.ok(
      'the burst is capped so it stays tasteful',
      celebrationFor({ multiplier: 1000, big: true }).intensity <= 2.6,
    );
    suite.eq('the top tier fans the burst across the viewport', jackpot.fan, 3);
    suite.ok('the top tier is the biggest burst', jackpot.intensity > big.intensity);
  }

  restore();
}

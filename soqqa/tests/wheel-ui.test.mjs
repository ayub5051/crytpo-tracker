/* ============================================================================
   SOQQA — Omad charxi UI flow (integration)
   Drives the real wheel view controller against a shim DOM to verify the whole
   loop: lock → deduct → rotate → credit → history → overlay → unlock.
   ========================================================================= */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_BET, STARTING_BALANCE, STORAGE_KEYS, WHEEL_FRAME, WHEEL_SEGMENTS } from '../js/config.js';
import { normalizeAngle, rotationForSegment } from '../js/games/wheel.js';
import { createStore } from '../js/store/state.js';
import { createMemoryStorage, createStorage } from '../js/store/storage.js';
import { celebrationFor, createResultModal } from '../js/ui/resultModal.js';
import { monotonicNow } from '../js/ui/wheelDisc.js';
import { createWheelView } from '../js/views/wheelView.js';
import { createStubRng } from '../js/utils/rng.js';
import { createModalDom, createWheelDom, installGlobals, waitFor } from './fakeDom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(join(HERE, '..', relative), 'utf8');

const IDX = { zero: WHEEL_SEGMENTS.findIndex((s) => s.multiplier === 0), two: 5, three: 8, five: 9, ten: 10, jackpot: 11 };

/* ============================================================================
   Selector matching, against the real built tree
   ----------------------------------------------------------------------------
   The stylesheet drives every wheel animation with a state class on an
   ancestor (`.wheel-stage.is-chasing .wheel-lamp__glow`). That is invisible to
   the eye and silent when it is wrong: if the lamps end up outside the stage,
   or the class lands on the wrong element, the chase simply never runs and the
   only symptom is that it looks dead.

   So the built tree is matched against those selectors for real — compound
   classes and descendant combinators — which is the one part of "does this
   animate in a browser" that can be settled without a browser. Class-only
   selectors, which is all this stylesheet needs.
   ========================================================================= */

/** Every element under `root` matching `selector` (descendant combinators only). */
function selectAll(root, selector) {
  const parts = String(selector).trim().split(/\s+/);

  // A compound token: any number of classes, plus optional `[attr="value"]`
  // tests — which is the form the lamp parity selectors are written in, so a
  // selector that only understood classes would quietly match nothing.
  const holds = (el, compound) => {
    const attrs = [
      ...String(compound).matchAll(/\[([\w-]+)(?:=(["'])([^"']*)\2)?\]/g),
    ].map(([, name, , value]) => [name, value]);
    const classes = String(compound).replace(/\[[^\]]*\]/g, '');
    return (
      classes
        .split('.')
        .filter(Boolean)
        .every((className) => el.classList?.contains(className)) &&
      attrs.every(([name, value]) => {
        const camel = name.replace(/^data-/, '').replace(/-(\w)/g, (_, char) => char.toUpperCase());
        const held = el.attributes?.[name] ?? el.dataset?.[camel];
        return value === undefined ? held !== undefined : String(held) === value;
      })
    );
  };

  const out = [];
  const walk = (el) => {
    if (holds(el, parts[parts.length - 1])) {
      let node = el.parentNode;
      let index = parts.length - 2;
      while (index >= 0 && node) {
        if (holds(node, parts[index])) index -= 1;
        node = node.parentNode;
      }
      if (index < 0) out.push(el);
    }
    (el.children ?? []).forEach(walk);
  };

  (root.children ?? []).forEach(walk);
  return out;
}

function harness({ indices = [IDX.zero], backend = null, spinDuration = 0, withModal = true } = {}) {
  const storageBackend = backend ?? createMemoryStorage();
  const store = createStore({ storage: createStorage(storageBackend) });

  const dom = createWheelDom();
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
  const resultModal = withModal ? createResultModal(modalDom.container, { confetti }) : null;

  const view = createWheelView({
    store,
    root: dom.root,
    balanceView,
    toaster,
    resultModal,
    rng: createStubRng(indices),
    spinDuration,
  });

  return { store, dom, modalDom, view, resultModal, calls };
}

export async function runWheelUiTests(suite) {
  const restore = installGlobals();

  /* --- initial state ----------------------------------------------------- */
  {
    const { dom, view, store, resultModal } = harness();
    view.init();

    suite.ok('the wheel spin button is enabled at boot', dom.spinButton.disabled === false);
    suite.eq('the wheel bet starts at the default', view.elements.betControls.getBet(), DEFAULT_BET);
    suite.eq('the wheel legend is rendered from config', dom.legendList.children.length, 8);
    suite.eq(
      'every segment gets a label on the disc',
      view.elements.discView.elements.labels.length,
      WHEEL_SEGMENTS.length,
    );
    suite.ok('the idle message is shown', dom.summary.textContent.includes('Charx'), dom.summary.textContent);
    suite.eq(
      'the face is painted as vector art, one wedge per segment',
      (dom.face.innerHTML.match(/class="wheel-wedge"/g) ?? []).length,
      WHEEL_SEGMENTS.length,
    );
    suite.ok(
      'the face carries the ruby/gold ramps and a peg on every seam',
      dom.face.innerHTML.includes('sqWheelRamp0') &&
        (dom.face.innerHTML.match(/class="wheel-peg"/g) ?? []).length === WHEEL_SEGMENTS.length,
    );
    suite.ok('the winning wedge starts dark', dom.glow.classList.contains('is-visible') === false);
    suite.eq(
      'the rim lamps are built from config',
      view.elements.discView.elements.lamps.length,
      WHEEL_FRAME.bulbCount,
    );
    suite.ok(
      'every lamp carries its place in the ring and is lit from the moment it is built',
      view.elements.discView.elements.lamps.every(
        (lamp, index) =>
          lamp.dataset.wheelLamp === String(index) &&
          lamp.style.getPropertyValue('--i') === String(index) &&
          Number(lamp.style.getPropertyValue('--lamp-lit')) ===
            view.elements.discView.elements.lampRest[index] &&
          Number(lamp.style.getPropertyValue('--lamp-lit')) > 0 &&
          lamp.children[0]?.className === 'wheel-lamp__glow' &&
          lamp.children[1]?.className === 'wheel-lamp__core',
      ),
      view.elements.discView.elements.lampRest.slice(0, 6).join(', '),
    );
    // The svetomuzika split. The stylesheet puts the two halves on opposite
    // phases of the strobe through this attribute, so it has to alternate around
    // the ring and be split evenly — an odd count or an off-by-one would leave
    // two neighbouring bulbs strobing together.
    suite.ok(
      'and each lamp knows which half of the marquee it is on',
      view.elements.discView.elements.lamps.every(
        (lamp, index) =>
          lamp.dataset.lampParity === (index % 2 === 0 ? 'even' : 'odd'),
      ) &&
        view.elements.discView.elements.lamps.filter(
          (lamp) => lamp.dataset.lampParity === 'odd',
        ).length ===
          WHEEL_FRAME.bulbCount / 2,
      view.elements.discView.elements.lamps
        .slice(0, 6)
        .map((lamp) => lamp.dataset.lampParity)
        .join(', '),
    );
    // The spin's chase is integrated from the drum's own speed, so it needs no
    // timing at all — it arrives as `--lamp-lit`. The RESULT chase is a steady
    // loop rather than a physical quantity, so it stays a keyframe animation,
    // and its cadence is written from config here so the stylesheet holds no
    // copy of it that could drift.
    suite.eq(
      'the strobe cadence the stylesheet reads comes from config',
      Number.parseFloat(dom.lampLayer.style.getPropertyValue('--lamp-strobe')),
      WHEEL_FRAME.strobeMs,
    );
    suite.eq(
      'the top tier is handed its own, quicker strobe',
      Number.parseFloat(dom.lampLayer.style.getPropertyValue('--lamp-strobe-fast')),
      WHEEL_FRAME.strobeFastMs,
    );
    suite.ok(
      '…which really is the quicker of the two, and still resolves as a strobe',
      // A strobe has to switch on a frame the eye can see. At 60 Hz, a cycle
      // shorter than ~3 frames reads as a blur rather than as a flash.
      WHEEL_FRAME.strobeFastMs < WHEEL_FRAME.strobeMs && WHEEL_FRAME.strobeFastMs >= 50,
      `${WHEEL_FRAME.strobeFastMs} vs ${WHEEL_FRAME.strobeMs} ms`,
    );
    suite.eq(
      'the resting pin is not flicked',
      Number(dom.pointer.style.getPropertyValue('--wheel-pin-flick') || 0),
      0,
    );
    suite.eq('store starts at 1 000 000', store.getBalance(), STARTING_BALANCE);
    suite.ok('the disc is not spinning at boot', view.elements.discView.isSpinning() === false);
    suite.ok('no overlay is open at boot', resultModal.isOpen === false);
  }

  /* --- a win ------------------------------------------------------------- */
  {
    const { dom, view, store, calls, resultModal, modalDom } = harness({ indices: [IDX.three] });
    view.init();

    const spin = view.handleSpin();
    // Everything up to the rotation happens synchronously.
    suite.ok('controls lock while spinning', dom.spinButton.disabled === true);
    suite.ok('the cabinet is marked as locked', dom.root.classList.contains('is-locked'));
    suite.ok('quick chips are locked while spinning', dom.quickChips.every((chip) => chip.disabled === true));
    suite.ok('the bet is deducted before the disc stops', store.getBalance() === STARTING_BALANCE - 1_000);

    await spin;

    suite.eq('a ×3 win credits 3 000', store.getBalance(), STARTING_BALANCE - 1_000 + 3_000);
    suite.eq('the spin is recorded once', store.getHistory().length, 1);

    const [entry] = store.getHistory();
    suite.eq('history marks the game as the wheel', entry.game, 'wheel');
    suite.eq('history keeps the segment', entry.segmentIndex, IDX.three);
    suite.eq('history keeps the multiplier', entry.multiplier, 3);
    suite.eq('history keeps the payout', entry.payout, 3_000);
    suite.eq('history snapshots the balance', entry.balanceAfter, store.getBalance());
    suite.eq('history marks the outcome', entry.outcome, 'win');
    suite.eq('the wheel counter is bumped', store.getStats().wheelSpins, 1);
    suite.eq('the slot counter is untouched', store.getStats().slotsSpins, 0);

    suite.ok('controls unlock after the spin', dom.spinButton.disabled === false);
    suite.ok('the locked flag is cleared', dom.root.classList.contains('is-locked') === false);
    suite.ok('the win message is shown', dom.summary.classList.contains('is-win'), dom.summary.textContent);
    suite.ok('the summary mentions the multiplier', dom.summary.textContent.includes('×3'), dom.summary.textContent);
    suite.ok('the balance chip flashes a win', calls.flashes.includes('win'));
    suite.ok('the disc rotated', view.elements.discView.rotation > 0);
    suite.ok('the winning segment is highlighted', view.elements.discView.elements.labels[IDX.three].classList.contains('is-win'));
    suite.ok('the winning wedge lights up', dom.glow.classList.contains('is-visible'));
    suite.eq(
      'the lit wedge is aimed at the segment that paid',
      dom.glow.style.getPropertyValue('--win-angle'),
      '240deg',
    );
    suite.ok('the rim chase stopped with the drum', dom.stage.classList.contains('is-chasing') === false);
    // Every paying stop celebrates, exactly like the slots: the burst is
    // scaled, not gated — and a small win must not be promoted to a bigger
    // tier just because it now celebrates.
    suite.ok('a small paying stop still gets its burst', calls.celebrations === 1);
    suite.eq(
      'the burst is scaled to the win, not promoted to a bigger tier',
      calls.bursts[0],
      celebrationFor({ multiplier: 3 }),
    );

    suite.ok('the result modal opened', resultModal.isOpen === true);
    suite.ok('the overlay is visible', modalDom.container.hidden === false);
    suite.eq('the modal reports a win', modalDom.title.textContent, 'Tabriklaymiz!');
    suite.eq('the modal shows the net result', modalDom.amount.textContent, '+2 000');
    suite.eq('the modal names the segment (1-based)', modalDom.fact.textContent, 'Sektor 9');
    suite.eq('the fact row is labelled for the wheel', modalDom.factLabel.textContent, 'Sektor');
    suite.eq('the modal shows the stake', modalDom.bet.textContent, '1 000 soqqa');
    suite.eq('the modal shows the multiplier', modalDom.multiplier.textContent, '×3');
    suite.eq('the modal shows the balance', modalDom.balance.textContent, 'Balans: 1 002 000 soqqa');
  }

  /* --- the turning drum drives the pin ----------------------------------- */
  {
    const { dom, view } = harness({ indices: [IDX.five], spinDuration: 600 });
    view.init();

    const spin = view.handleSpin();
    suite.ok('the rim chases while the drum turns', dom.stage.classList.contains('is-chasing'));
    suite.ok('the drum is flagged as spinning', dom.disc.classList.contains('is-spinning'));

    const flicked = await waitFor(
      () => Number(dom.pointer.style.getPropertyValue('--wheel-pin-flick')) > 0.05,
    );
    suite.ok(
      'the pin flicks as the pegs sweep past it',
      flicked,
      dom.pointer.style.getPropertyValue('--wheel-pin-flick') || 'never written',
    );

    await spin;

    suite.eq(
      'the pin settles back to rest',
      Number(dom.pointer.style.getPropertyValue('--wheel-pin-flick')),
      0,
    );
    suite.ok('the chase stops with the drum', dom.stage.classList.contains('is-chasing') === false);
    suite.ok('the spinning flag is cleared', dom.disc.classList.contains('is-spinning') === false);
    suite.ok('the drum took a real turn', view.elements.discView.rotation > 4 * 360);
    suite.eq(
      'the drum lands exactly on the angle the engine decided',
      normalizeAngle(view.elements.discView.rotation),
      rotationForSegment(IDX.five),
    );
  }

  /* --- smoothness: one clock, one layer, and no rewinding step ------------ */
  {
    /*
      A closed-form curve is smooth by construction; what a player actually
      sees is the curve sampled through two things the curve cannot control —
      the clock it is sampled on, and whether the browser transforms a texture
      or re-rasterises twelve gradient-filled paths per frame. Both are pinned
      here, from the real loop, instead of being assumed.
    */

    // The clock. `performance.now()` is monotonic and sub-millisecond; a wall
    // clock is neither, and a backwards NTP step mid-spin is a visible kink.
    {
      const realNow = globalThis.performance.now;
      let consulted = 0;
      try {
        globalThis.performance.now = function measured(...args) {
          consulted += 1;
          return realNow.apply(this, args);
        };
        monotonicNow();
      } finally {
        globalThis.performance.now = realNow;
      }
      suite.ok(
        'the spin reads a monotonic clock, not a wall clock',
        consulted === 1,
        consulted === 1 ? 'performance.now()' : 'performance.now() was never consulted',
      );
    }

    // The wall clock must not creep back in anywhere but the documented
    // fallback for environments without `performance`.
    {
      // Comments talk about the wall clock, so they are stripped first: what is
      // counted is code.
      const source = read('js/ui/wheelDisc.js')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*$/gm, ' ');
      const wallClock = source.match(/Date\.now\(\)/g) ?? [];
      suite.ok(
        'the loop holds no wall-clock read but the documented fallback',
        wallClock.length === 1 && /typeof globalThis\.performance\?\.now === 'function'[\s\S]{0,80}Date\.now\(\)/.test(source),
        `${wallClock.length} read(s) of Date.now()`,
      );
    }

    const { dom, view } = harness({ indices: [IDX.five], spinDuration: 900 });
    view.init();

    const frames = [];
    const startedAt = performance.now();
    const spin = view.handleSpin();
    const pump = setInterval(() => {
      const transform = String(dom.disc.style.transform ?? '');
      frames.push({
        at: performance.now() - startedAt,
        transform,
        angle: Number(/rotate\((-?[\d.]+)deg\)/.exec(transform)?.[1]),
      });
    }, 6);
    await spin;
    clearInterval(pump);

    suite.ok(
      'the running loop is watched often enough to judge it',
      frames.length > 20 && frames.every(({ angle }) => Number.isFinite(angle)),
      `${frames.length} frames · ${frames.filter(({ angle }) => !Number.isFinite(angle)).length} unreadable`,
    );
    suite.ok(
      'every frame keeps the drum on its own compositor layer',
      frames.length > 0 && frames.every(({ transform }) => transform.includes('translateZ(0)')),
      frames.find(({ transform }) => !transform.includes('translateZ(0)'))?.transform ?? 'no frames',
    );

    /*
      The travel beat — the first three quarters, before the landing's own
      overshoot and rebound, which are deliberate and therefore non-monotonic.
      Direction-agnostic: which way the drum is sent is the engine's business,
      so the test asks only that no step opposes the direction the drum is
      actually going. That is the kink a player reads as a stutter.
    */
    const travel = frames.filter(({ at }) => at < 900 * 0.7);
    const deltas = travel.slice(1).map((frame, index) => frame.angle - travel[index].angle);
    const forwards = deltas.filter((delta) => delta > 0).length >= deltas.filter((delta) => delta < 0).length;
    const opposed = deltas.filter((delta) => (forwards ? delta < -1e-6 : delta > 1e-6));
    const turning = deltas.reduce((total, delta) => total + delta, 0);
    suite.ok(
      'the drum never steps backwards on its way up to speed',
      travel.length > 8 && opposed.length === 0 && Math.abs(turning) > 180,
      opposed.length
        ? `${opposed.length} opposed step(s), worst ${Math.min(...opposed).toFixed(3)}°`
        : `${deltas.length} steps · ${turning.toFixed(0)}° of travel`,
    );
    /*
      And it is really moving. Two properties, both read off the samples above
      rather than off a curve: the drum passes through many distinct positions
      across the travel beat (a loop that paints a handful of times is the
      stutter), and no single hop is wildly out of scale with a typical one (a
      hop is the jump a player reads as a skipped frame). Measured on the real
      loop this sits at ~38 positions and a 1.7× hop, so the bounds below are
      bounds and not a description.
    */
    const hops = deltas.map(Math.abs).filter((delta) => delta > 1e-9).sort((a, b) => a - b);
    const typical = hops[Math.floor(hops.length / 2)] ?? 0;
    const biggest = hops[hops.length - 1] ?? 0;
    const positions = new Set(travel.map(({ angle }) => angle)).size;
    suite.ok(
      'and it is really moving, position after position',
      positions >= 20 && hops.length >= 20,
      `${positions} distinct positions · ${hops.length} moving steps of ${travel.length}`,
    );
    suite.ok(
      'no single hop is out of scale with a typical one',
      typical > 0 && biggest < typical * 3,
      `largest ${biggest.toFixed(2)}\u00b0 vs typical ${typical.toFixed(2)}\u00b0 (${(biggest / (typical || 1)).toFixed(2)}\u00d7)`,
    );
  }

  /* --- celebration + jackpot --------------------------------------------- */
  {
    const { view, modalDom, calls, store } = harness({ indices: [IDX.five] });
    view.init();
    await view.handleSpin();

    suite.eq('a ×5 win pays 5× the stake', store.getBalance(), STARTING_BALANCE - 1_000 + 5_000);
    suite.ok('a significant win celebrates', calls.celebrations === 1);
    suite.eq(
      'a significant win gets the bigger burst',
      calls.bursts[0],
      celebrationFor({ multiplier: 5, big: true }),
    );
    suite.eq('the modal uses the big-win title', modalDom.title.textContent, 'Katta yutuq!');
    suite.ok('the panel is flagged as a win', modalDom.panel.classList.contains('is-win'));
  }

  {
    const { view, modalDom, calls } = harness({ indices: [IDX.jackpot] });
    view.init();
    await view.handleSpin();

    suite.eq('the jackpot title is used for ×20', modalDom.title.textContent, 'Jekpot!');
    suite.ok('the panel is flagged as a jackpot', modalDom.panel.classList.contains('is-jackpot'));
    suite.eq('the jackpot amount is shown', modalDom.amount.textContent, '+19 000');
    suite.ok('the jackpot celebrates', calls.celebrations === 1);
    suite.eq(
      'the jackpot gets the three-origin fan',
      calls.bursts[0],
      celebrationFor({ multiplier: 20, jackpot: true }),
    );
  }

  /* --- a loss ------------------------------------------------------------ */
  {
    const { dom, view, store, calls, modalDom, resultModal } = harness({ indices: [IDX.zero] });
    view.init();
    await view.handleSpin();

    suite.eq('a ×0 spin pays nothing', store.getBalance(), STARTING_BALANCE - 1_000);
    suite.eq('the loss is recorded', store.getHistory()[0].outcome, 'loss');
    suite.eq('the loss multiplier is 0', store.getHistory()[0].multiplier, 0);
    suite.ok('the loss message is shown', dom.summary.classList.contains('is-lose'));
    suite.ok('no confetti on a loss', calls.celebrations === 0);
    suite.ok('the chip flashes a loss', calls.flashes.includes('lose'));
    suite.ok('the loss overlay still opens', resultModal.isOpen === true);
    suite.eq('the loss title is shown', modalDom.title.textContent, 'Yutuq yo\u2019q');
    suite.eq('the loss amount is negative', modalDom.amount.textContent, '-1 000');
    suite.ok(
      'the landing segment is marked as a miss, never as a win',
      view.elements.discView.elements.labels[IDX.zero].classList.contains('is-lost') &&
        !view.elements.discView.elements.labels[IDX.zero].classList.contains('is-win'),
    );
    suite.ok(
      'the disc does not glow on a loss',
      !view.elements.discView.elements.disc.classList.contains('is-win'),
    );
    suite.ok(
      'a losing stop lights no wedge at all',
      dom.glow.classList.contains('is-visible') === false,
    );
  }

  /* --- duplicate spins are ignored --------------------------------------- */
  {
    const { view, store, dom } = harness({ indices: [IDX.two] });
    view.init();

    const first = view.handleSpin();
    const second = view.handleSpin(); // fired while the first is running
    await Promise.all([first, second]);

    suite.eq('only one spin is recorded', store.getHistory().length, 1);
    suite.eq('the balance is debited once', store.getBalance(), STARTING_BALANCE - 1_000 + 2_000);
    suite.ok('controls are usable again', dom.spinButton.disabled === false);
  }

  /* --- bet controls ------------------------------------------------------ */
  {
    const { dom, view, store } = harness();
    view.init();

    dom.stepUp.dispatch('click');
    suite.eq('+ steps up the ladder', view.elements.betControls.getBet(), 5_000);
    dom.stepDown.dispatch('click');
    suite.eq('− steps back down', view.elements.betControls.getBet(), 1_000);
    suite.ok('− is disabled on the first ladder step', dom.stepDown.disabled === true);

    dom.quickChips[2].dispatch('click');
    suite.eq('a quick chip selects its amount', view.elements.betControls.getBet(), 25_000);
    suite.ok('the active chip is marked', dom.quickChips[2].classList.contains('is-active'));
    suite.eq('the chosen bet is remembered across reloads', store.getSettings().lastBet, 25_000);
  }

  /* --- insufficient balance --------------------------------------------- */
  {
    const backend = createMemoryStorage();
    backend.setItem(STORAGE_KEYS.balance, JSON.stringify({ coins: 1_000, updatedAt: 0 }));
    const { view, store, calls, dom } = harness({ indices: [IDX.zero], backend });
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

  /* --- the overlay itself ------------------------------------------------ */
  {
    const { view, modalDom, resultModal, store } = harness({ indices: [IDX.two, IDX.zero] });
    view.init();
    await view.handleSpin();
    suite.ok('the overlay is open', resultModal.isOpen === true);

    modalDom.closeButton.dispatch('click');
    suite.ok('the close button dismisses the overlay', resultModal.isOpen === false);
    suite.ok('the overlay container is hidden again', modalDom.container.hidden === true);
  }

  {
    const { view, dom, resultModal } = harness({ indices: [IDX.two] });
    view.init();

    dom.spinButton.focus(); // where the player's focus sits before the overlay
    await view.handleSpin();
    suite.ok('the overlay takes focus', globalThis.document.activeElement !== dom.spinButton);

    globalThis.document.dispatch('keydown', { key: 'Escape' });
    suite.ok('Escape closes the overlay', resultModal.isOpen === false);
    suite.eq('closing restores focus to the spin button', globalThis.document.activeElement, dom.spinButton);
  }

  {
    const { view, resultModal, modalDom, store } = harness({ indices: [IDX.two, IDX.zero] });
    view.init();
    await view.handleSpin();

    modalDom.replay.dispatch('click'); // "Yana o'ynash" → spins again
    await Promise.resolve();

    suite.eq('replay records a second spin', store.getHistory().length, 2);
    suite.eq('the second spin used the same stake', store.getHistory()[0].bet, 1_000);
    suite.ok('the overlay reports the replay result', resultModal.isOpen === true);
  }

  {
    // The "Sektor" row has no value for a result that did not come off the wheel.
    const { resultModal, modalDom } = harness();
    resultModal.show({
      outcome: 'win',
      multiplier: 2,
      payout: 2_000,
      bet: 1_000,
      balance: 5_000,
      segmentIndex: null,
      celebrate: false,
    });

    suite.eq('a result without a segment shows a dash', modalDom.fact.textContent, '—');
    suite.eq('a plain win gets the congratulations title', modalDom.title.textContent, 'Tabriklaymiz!');
    suite.ok('the overlay is open', resultModal.isOpen === true);

    modalDom.backdrop.dispatch('click');
    suite.ok('the backdrop closes the overlay', resultModal.isOpen === false);
    suite.ok('the container hides again', modalDom.container.hidden === true);
  }

  /* --- keyboard + persistence -------------------------------------------- */
  {
    // No overlay at all: the cabinet must still be fully playable.
    const { view, dom, store, resultModal } = harness({ indices: [IDX.zero], withModal: false });
    view.init();

    dom.root.dispatch('keydown', { key: 'Enter', target: dom.summary });
    await Promise.resolve();
    suite.eq('Enter spins when focus is inside the cabinet', store.getHistory().length, 1);
    suite.ok('no overlay is created when none is injected', resultModal === null);

    dom.root.dispatch('keydown', { key: ' ', target: dom.spinButton });
    await Promise.resolve();
    suite.eq('Space on a button does not double-spin', store.getHistory().length, 1);
  }

  {
    const backend = createMemoryStorage();
    const first = harness({ indices: [IDX.ten], backend });
    first.view.init();
    await first.view.handleSpin();

    const reloaded = createStore({ storage: createStorage(backend) });
    suite.eq('the wheel balance persists across a reload', reloaded.getBalance(), STARTING_BALANCE - 1_000 + 10_000);
    suite.eq('the wheel history persists across a reload', reloaded.getHistory()[0].segmentIndex, IDX.ten);
    suite.eq('the wheel stats persist across a reload', reloaded.getStats().wheelSpins, 1);
  }

  /* --- a broken animation must never eat the stake ------------------------ */
  {
    const { view, dom, store, calls, resultModal } = harness({ indices: [IDX.jackpot] });

    // A disc that blows up mid-spin (the browser refusing the rotation, for
    // instance) must refund the bet and unlock the cabinet — never deadlock.
    Object.defineProperty(dom.disc, 'style', {
      value: new Proxy(
        {},
        {
          set(target, key, value) {
            if (key === 'transform') throw new Error('rotation rejected');
            target[key] = value;
            return true;
          },
        },
      ),
    });

    // The view logs the failure on purpose; keep the report readable.
    const realError = console.error;
    console.error = () => {};
    view.init();
    await view.handleSpin();
    console.error = realError;

    suite.eq('a failed spin refunds the stake', store.getBalance(), STARTING_BALANCE);
    suite.eq('a failed spin writes no history', store.getHistory().length, 0);
    suite.ok('controls unlock after a failure', dom.spinButton.disabled === false);
    suite.ok(
      'the player is told the spin failed',
      calls.toasts.some((toast) => toast.kind === 'error'),
      JSON.stringify(calls.toasts),
    );
    suite.ok('no overlay is shown for a failed spin', resultModal.isOpen === false);
  }

  /* --- every animation the stylesheet declares has something to run on ---- */
  {
    const { dom, view } = harness({ indices: [IDX.five], spinDuration: 600 });
    view.init();

    // At rest: the ring is LIT — the sockets glow at their own resting levels,
    // the way the bulbs of a powered machine do — but nothing is chasing.
    const restLevel = view.elements.discView.elements.lampRest;
    suite.eq('the lamp ring is in the tree at rest', selectAll(dom.root, '.wheel-lamp').length, WHEEL_FRAME.bulbCount);
    suite.eq('with a glow inside each socket', selectAll(dom.root, '.wheel-lamp .wheel-lamp__glow').length, WHEEL_FRAME.bulbCount);
    suite.eq('the wedges carry their labels', selectAll(dom.root, '.wheel-label').length, WHEEL_SEGMENTS.length);
    suite.ok(
      'the ring of a resting cabinet is lit, not dark',
      view.elements.discView.elements.lamps.every(
        (lamp, index) => Number(lamp.style.getPropertyValue('--lamp-lit')) === restLevel[index] && restLevel[index] > 0,
      ),
      restLevel.join(', '),
    );
    suite.eq('nothing is chasing at rest', selectAll(dom.root, '.wheel-stage.is-chasing .wheel-lamp__glow').length, 0);
    suite.eq('and no wedge is lit at rest', selectAll(dom.root, '.wheel-wedge-glow.is-visible').length, 0);

    const spin = view.handleSpin();

    // Mid-spin: the chase selector has to hit every lamp, or the bulbs simply
    // do not blink in a browser no matter what the stylesheet says.
    suite.eq(
      'the chase selector reaches every socket while the drum turns',
      selectAll(dom.root, '.wheel-stage.is-chasing .wheel-lamp').length,
      WHEEL_FRAME.bulbCount,
    );
    suite.eq(
      'and every halo and core inside them',
      selectAll(dom.root, '.wheel-stage.is-chasing .wheel-lamp .wheel-lamp__glow').length +
        selectAll(dom.root, '.wheel-stage.is-chasing .wheel-lamp .wheel-lamp__core').length,
      WHEEL_FRAME.bulbCount * 2,
    );
    suite.eq(
      'the drum itself is flagged while it turns',
      selectAll(dom.root, '.wheel-disc.is-spinning').length,
      1,
    );

    // The ring's marquee is script-driven, so the thing that has to be true is
    // that the view is really lighting lamps from the drum's speed. No
    // stylesheet can fake this: a rig that forgot to paint the ring would leave
    // every socket sitting on its resting level for the whole spin.
    const levelOf = (lamp) => Number(lamp.style.getPropertyValue('--lamp-lit'));
    const movedOffRest = () =>
      view.elements.discView.elements.lamps.some(
        (lamp, index) => levelOf(lamp) !== restLevel[index],
      );
    const litEarly = movedOffRest();
    const chased = await waitFor(
      () => movedOffRest() && Math.abs(view.elements.discView.elements.bandAngle) > 20,
    );
    suite.ok(
      'the ring lights up from the drum\u2019s own speed while it turns',
      chased,
      litEarly ? 'already moving on the first frames' : 'still at rest',
    );

    // Svetomuzika, measured off the real sockets. The effect IS the split: at
    // any instant the odd half of the ring and the even half are at clearly
    // different brightnesses. A single shared value would leave them identical.
    const halves = () => {
      const odd = view.elements.discView.elements.lamps.filter(
        (lamp) => lamp.dataset.lampParity === 'odd',
      );
      const even = view.elements.discView.elements.lamps.filter(
        (lamp) => lamp.dataset.lampParity === 'even',
      );
      const mean = (group) => group.reduce((sum, lamp) => sum + levelOf(lamp), 0) / group.length;
      return { odd: mean(odd), even: mean(even) };
    };
    // The flash crosses through a point where both halves are equally lit, so
    // sampling the instant the loop happens to be looked at proves nothing —
    // the split has to be caught while it is actually open.
    const bias = () => halves().odd - halves().even;
    const splitSeen = await waitFor(() => Math.abs(bias()) > 0.25);
    suite.ok(
      'the two halves of the ring are flashing against each other, not together',
      splitSeen,
      `odd ${halves().odd.toFixed(3)} vs even ${halves().even.toFixed(3)}`,
    );

    // ...and they SWAP. This is the part a shared value can never do, and it is
    // the whole difference between svetomuzika and a ring that just dims.
    const opened = bias();
    const swapped = await waitFor(
      () => Math.abs(bias()) > 0.25 && Math.sign(bias()) !== Math.sign(opened),
    );
    suite.ok(
      'and which half is lit SWAPS as the band travels',
      swapped,
      `opened odd-lighter by ${opened.toFixed(3)}, now ${bias().toFixed(3)}`,
    );
    suite.ok(
      'a lamp is snapped to a brightness step, not left analogue',
      (() => {
        const levels = new Set(view.elements.discView.elements.lamps.map(levelOf));
        const step = 1 / WHEEL_FRAME.litLevels;
        return [...levels].every(
          (value) => Math.abs(value / step - Math.round(value / step)) < 1e-6,
        );
      })(),
      `${WHEEL_FRAME.litLevels} levels`,
    );

    // The surge at the stop, sampled as it happens: every lamp above its own
    // resting level AT THE SAME TIME. No chase can do that — it always leaves a
    // run of bulbs dark behind the head — so this is the one guarantee that the
    // machine visibly catches the wheel rather than just running out of frames.
    let surged = false;
    const watchSurge = setInterval(() => {
      if (
        view.elements.discView.elements.lamps.every(
          (lamp, index) => Number(lamp.style.getPropertyValue('--lamp-lit')) > restLevel[index],
        )
      ) {
        surged = true;
      }
    }, 4);

    await spin;
    clearInterval(watchSurge);
    suite.ok(
      'the whole ring surges the instant the pin catches the wheel',
      surged,
      `resting ring ${restLevel.slice(0, 4).join(', ')}\u2026`,
    );

    // A win: the strobe selector has to reach BOTH halves of the ring, or the
    // ring flashes together instead of against itself.
    suite.eq(
      'the result strobe reaches every halo',
      selectAll(dom.root, '.wheel-stage.is-win .wheel-lamp__glow').length,
      WHEEL_FRAME.bulbCount,
    );
    suite.eq(
      'and every core with it',
      selectAll(dom.root, '.wheel-stage.is-win .wheel-lamp__core').length,
      WHEEL_FRAME.bulbCount,
    );
    suite.eq(
      'both halves of the ring are on the strobe, evenly split',
      selectAll(dom.root, ".wheel-stage.is-win .wheel-lamp[data-lamp-parity='odd'] .wheel-lamp__glow")
        .length,
      WHEEL_FRAME.bulbCount / 2,
    );
    suite.eq(
      '...and the other half too, so the off-phase is never left out',
      selectAll(dom.root, ".wheel-stage.is-win .wheel-lamp[data-lamp-parity='even'] .wheel-lamp__glow")
        .length,
      WHEEL_FRAME.bulbCount / 2,
    );
    const lit = selectAll(dom.root, '.wheel-wedge-glow.is-visible');
    suite.eq('exactly one wedge is lit on a win', lit.length, 1);
    suite.eq(
      'and it is aimed at the segment that paid',
      lit[0]?.style.getPropertyValue('--win-angle'),
      `${IDX.five * (360 / WHEEL_SEGMENTS.length)}deg`,
    );
    suite.eq('the labels are still in the tree after a spin', selectAll(dom.root, '.wheel-label').length, WHEEL_SEGMENTS.length);
    suite.ok(
      'the band really travelled \u2014 a marquee that only flickered would not lap the ring',
      Math.abs(view.elements.discView.elements.bandAngle) > 180,
      `${view.elements.discView.elements.bandAngle.toFixed(0)}\u00b0`,
    );
    suite.ok(
      'the ring sits down with the wheel: every lamp is back on its own resting glow',
      view.elements.discView.elements.lamps.every(
        (lamp, index) => Number(lamp.style.getPropertyValue('--lamp-lit')) === restLevel[index],
      ),
      view.elements.discView.elements.lamps
        .slice(0, 8)
        .map((lamp) => lamp.style.getPropertyValue('--lamp-lit'))
        .join(', '),
    );
    suite.ok(
      'and it is left lit — a cabinet does not go dark when the wheel stops',
      restLevel.every((level) => level > 0),
      `${Math.min(...restLevel)}…${Math.max(...restLevel)}`,
    );

    // A miss: the lighting selectors must all miss, so a losing stop is dark.
    const loss = harness({ indices: [IDX.zero] });
    loss.view.init();
    await loss.view.handleSpin();
    suite.eq(
      'a miss lights no wedge at all',
      selectAll(loss.dom.root, '.wheel-wedge-glow.is-visible').length,
      0,
    );
    suite.eq(
      'and never flares the ring',
      selectAll(loss.dom.root, '.wheel-stage.is-win .wheel-lamp__glow').length,
      0,
    );
  }

  /* --- the view tolerates a missing DOM ---------------------------------- */
  {
    const store = createStore({ storage: createStorage(createMemoryStorage()) });
    const view = createWheelView({ store, root: null, balanceView: null, toaster: { show() {} } });
    suite.ok('a missing root degrades to a no-op', typeof view.init === 'function');
    suite.ok('a missing root never throws on spin', view.handleSpin() === undefined);
  }

  restore();
}

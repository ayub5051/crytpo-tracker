/* ============================================================================
   SOQQA — minimal DOM shim for integration tests
   ----------------------------------------------------------------------------
   Implements just enough of the DOM for the real view controllers to run:
   element lookup by the exact selectors the app uses, classList, dataset,
   textContent, events, append/remove and inline style properties. No HTML
   parsing, no dependencies.

   Because the reel view builds its symbol strips out of real elements, the shim
   keeps a child tree and answers child selectors for it — which is also how the
   tests can walk a strip and prove none of its symbols ever changed.
   ========================================================================= */

const NODE_TIMERS = { setInterval, clearInterval, setTimeout, clearTimeout };

/** Does a shim element match one simple selector (.class, [attr], [a="v"], tag)? */
function matches(el, selector) {
  const text = selector.trim();
  if (!text) return false;

  if (text.startsWith('.')) {
    const cls = text.slice(1).split(/[.[:\s]/)[0];
    return el.classList.contains(cls);
  }

  if (text.startsWith('[')) {
    const parsed = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(text);
    if (!parsed) return false;
    const [, name, value] = parsed;
    const camel = name.replace(/^data-/, '').replace(/-(\w)/g, (_, char) => char.toUpperCase());
    const held = el.attributes[name] ?? el.dataset[camel];
    if (value === undefined) return held !== undefined;
    return String(held) === value;
  }

  return el.tagName === text.toUpperCase();
}

/** Every descendant of an element, depth first. */
function descendants(el, out = []) {
  (el.children ?? []).forEach((child) => {
    out.push(child);
    descendants(child, out);
  });
  return out;
}

export function createElement(tag = 'div') {
  const classes = new Set();
  const styleProps = {};

  const element = {
    tagName: String(tag).toUpperCase(),
    dataset: {},
    attributes: {},
    children: [],
    parentNode: null,
    listeners: {},
    textContent: '',
    innerHTML: '',
    disabled: false,
    hidden: false,
    offsetWidth: 0,

    /** Kept in sync with classList, so class selectors see either form. */
    get className() {
      return [...classes].join(' ');
    },

    set className(value) {
      classes.clear();
      String(value)
        .split(/\s+/)
        .filter(Boolean)
        .forEach((name) => classes.add(name));
    },

    /**
     * Inline styles. `setProperty`/`getPropertyValue` back the CSS custom
     * properties the reel view writes its geometry with, so the tests can read
     * the exact offset a drum is at. A real browser fires `transitionend` once a
     * transition has run; the shim fires it on the next tick, so animation-driven
     * promises (the wheel disc) resolve without waiting for their safety timeout.
     */
    style: new Proxy(styleProps, {
      set(target, key, value) {
        target[key] = value;
        if (key === 'transform' || key === 'transitionDuration') {
          setTimeout(
            () => element.dispatch('transitionend', { propertyName: 'transform', elapsedTime: 0 }),
            0,
          );
        }
        return true;
      },
    }),

    focus() {
      if (globalThis.document) globalThis.document.activeElement = element;
    },

    blur() {
      if (globalThis.document?.activeElement === element) globalThis.document.activeElement = null;
    },

    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    },

    get classListSnapshot() {
      return [...classes];
    },

    addEventListener(type, handler) {
      (element.listeners[type] ??= []).push(handler);
    },

    removeEventListener() {},

    dispatch(type, event = {}) {
      (element.listeners[type] ?? []).forEach((handler) =>
        handler({ target: element, preventDefault() {}, ...event }),
      );
    },

    append(...nodes) {
      nodes.forEach((node) => {
        if (!node) return;
        node.parentNode = element;
        element.children.push(node);
      });
    },

    remove() {
      const parent = element.parentNode;
      if (!parent) return;
      const index = parent.children.indexOf(element);
      if (index >= 0) parent.children.splice(index, 1);
      element.parentNode = null;
    },

    setAttribute(key, value) {
      element.attributes[key] = String(value);
    },

    removeAttribute(key) {
      delete element.attributes[key];
    },

    getAttribute(key) {
      return element.attributes[key] ?? null;
    },

    matches(selector) {
      return matches(element, selector);
    },

    querySelector(selector) {
      return descendants(element).find((child) => matches(child, selector)) ?? null;
    },

    querySelectorAll(selector) {
      return descendants(element).filter((child) => matches(child, selector));
    },

    getContext() {
      return null;
    },
  };

  styleProps.setProperty = (key, value) => {
    styleProps[key] = String(value);
  };
  styleProps.getPropertyValue = (key) => styleProps[key] ?? '';

  return element;
}

/**
 * Build a fake slots cabinet with the exact selectors slotsView + betControls
 * + reelView query.
 *
 * The drums are apertures: each one holds an empty `.reel-strip`, which the real
 * reel view then fills with its symbol cells.
 */
export function createSlotsDom() {
  const spinButton = createElement('button');
  const summary = createElement('p');
  const paytableList = createElement('ul');
  const betValue = createElement('output');
  const betHint = createElement('p');
  const stepDown = createElement('button');
  const stepUp = createElement('button');
  const windowEl = createElement('div');
  const quickChips = [1_000, 5_000, 25_000, 100_000].map((amount) => {
    const chip = createElement('button');
    chip.dataset.betQuick = String(amount);
    return chip;
  });

  stepDown.dataset.betStep = '-1';
  stepUp.dataset.betStep = '1';

  const reels = [0, 1, 2].map((index) => {
    const reel = createElement('div');
    reel.dataset.reel = String(index);
    const strip = createElement('div');
    strip.className = 'reel-strip';
    strip.attributes['data-reel-strip'] = '';
    strip.dataset.reelStrip = '';
    reel.append(strip);
    reel.strip = strip;
    return reel;
  });

  const lookups = {
    '.reel-window': windowEl,
    '[data-spin-button]': spinButton,
    '[data-reel-summary]': summary,
    '[data-paytable-list]': paytableList,
    '[data-bet-value]': betValue,
    '[data-bet-hint]': betHint,
  };

  const lists = {
    '[data-reel]': reels,
    '[data-bet-step]': [stepDown, stepUp],
    '[data-bet-quick]': quickChips,
  };

  const root = createElement('section');
  root.querySelector = (selector) => lookups[selector] ?? null;
  root.querySelectorAll = (selector) => lists[selector] ?? [];

  return {
    root,
    reels,
    spinButton,
    summary,
    paytableList,
    betValue,
    betHint,
    stepDown,
    stepUp,
    quickChips,
    windowEl,
    /** The strip cells of every drum, read back after the view has built them. */
    get cells() {
      return reels.map((reel) => reel.strip.children);
    },
  };
}

/**
 * Build a fake Omad charxi cabinet with the exact selectors wheelView +
 * betControls + wheelDisc query.
 */
export function createWheelDom() {
  const spinButton = createElement('button');
  const summary = createElement('p');
  const legendList = createElement('ul');
  const stage = createElement('div');
  const disc = createElement('div');
  const face = createElement('div');
  const glow = createElement('div');
  const pointer = createElement('div');
  const lampLayer = createElement('div');
  const betValue = createElement('output');

  // The same classes the markup carries — the stylesheet hangs every wheel
  // animation off them, so a shim without them would hide a dead selector.
  stage.className = 'wheel-stage';
  disc.className = 'wheel-disc';
  face.className = 'wheel-face-mount';
  glow.className = 'wheel-wedge-glow';
  pointer.className = 'wheel-pointer';
  lampLayer.className = 'wheel-lamps';

  // Mirror the markup: the drum holds the face + the win wedge and turns inside
  // the stage, which also carries the lamp ring and the static pin.
  disc.append(face, glow);
  stage.append(disc, lampLayer, pointer);
  const betHint = createElement('p');
  const stepDown = createElement('button');
  const stepUp = createElement('button');
  const quickChips = [1_000, 5_000, 25_000, 100_000].map((amount) => {
    const chip = createElement('button');
    chip.dataset.betQuick = String(amount);
    return chip;
  });

  stepDown.dataset.betStep = '-1';
  stepUp.dataset.betStep = '1';

  const lookups = {
    '[data-wheel-spin]': spinButton,
    '[data-wheel-summary]': summary,
    '[data-wheel-legend]': legendList,
    '[data-wheel-stage]': stage,
    '[data-wheel-disc]': disc,
    '[data-wheel-face]': face,
    '[data-wheel-glow]': glow,
    '[data-wheel-pointer]': pointer,
    '[data-wheel-lamps]': lampLayer,
    '[data-bet-value]': betValue,
    '[data-bet-hint]': betHint,
  };

  const lists = {
    '[data-bet-step]': [stepDown, stepUp],
    '[data-bet-quick]': quickChips,
  };

  const root = createElement('section');
  root.querySelector = (selector) => lookups[selector] ?? null;
  root.querySelectorAll = (selector) => lists[selector] ?? [];

  // The stage really is a child of the cabinet, so the state classes the
  // stylesheet hangs off it (`.wheel-stage.is-chasing …`) can be matched
  // against the built tree — see tests/wheel-ui.test.mjs.
  root.append(stage);

  return {
    root,
    stage,
    disc,
    face,
    glow,
    pointer,
    lampLayer,
    spinButton,
    summary,
    legendList,
    betValue,
    betHint,
    stepDown,
    stepUp,
    quickChips,
  };
}

/**
 * Build a fake Mines cabinet with the exact selectors minesView + mineControls
 * + betControls + minesGrid query.
 *
 * The board mount is empty on purpose: exactly as in the real page, the 25
 * tiles do not exist until the view builds them, so a test can read them back
 * off `grid.children` afterwards — which is how the suites prove there are 25
 * of them and that none of them is ever looked up through a selector.
 */
export function createMinesDom() {
  const nodes = {
    start: createElement('button'),
    startLabel: createElement('span'),
    cashout: createElement('button'),
    summary: createElement('p'),
    stage: createElement('div'),
    grid: createElement('div'),
    progress: createElement('dd'),
    multiplier: createElement('dd'),
    next: createElement('dd'),
    potential: createElement('dd'),
    betValue: createElement('output'),
    betHint: createElement('p'),
    mineValue: createElement('output'),
  };

  const stepDown = createElement('button');
  const stepUp = createElement('button');
  stepDown.dataset.betStep = '-1';
  stepUp.dataset.betStep = '1';
  const quickChips = [1_000, 5_000, 25_000, 100_000].map((amount) => {
    const chip = createElement('button');
    chip.dataset.betQuick = String(amount);
    return chip;
  });

  const mineDown = createElement('button');
  const mineUp = createElement('button');
  mineDown.dataset.minesCountStep = '-1';
  mineUp.dataset.minesCountStep = '1';
  const mineChips = [1, 3, 5, 10, 24].map((count) => {
    const chip = createElement('button');
    chip.dataset.minesCountQuick = String(count);
    return chip;
  });

  nodes.stage.className = 'mines-stage';
  nodes.grid.className = 'mines-grid';
  nodes.stage.append(nodes.grid);

  const lookups = {
    '[data-mines-start]': nodes.start,
    '[data-mines-start-label]': nodes.startLabel,
    '[data-mines-cashout]': nodes.cashout,
    '[data-mines-summary]': nodes.summary,
    '[data-mines-stage]': nodes.stage,
    '[data-mines-grid]': nodes.grid,
    '[data-mines-progress]': nodes.progress,
    '[data-mines-multiplier]': nodes.multiplier,
    '[data-mines-next]': nodes.next,
    '[data-mines-potential]': nodes.potential,
    '[data-mines-count]': nodes.mineValue,
    '[data-bet-value]': nodes.betValue,
    '[data-bet-hint]': nodes.betHint,
  };

  const lists = {
    '[data-bet-step]': [stepDown, stepUp],
    '[data-bet-quick]': quickChips,
    '[data-mines-count-step]': [mineDown, mineUp],
    '[data-mines-count-quick]': mineChips,
  };

  const root = createElement('section');
  root.querySelector = (selector) => lookups[selector] ?? null;
  root.querySelectorAll = (selector) => lists[selector] ?? [];

  // The stage really is a child of the cabinet, so the win/lose classes the
  // stylesheet hangs off it (`.mines-stage.is-win .mines-stage__glow`) can be
  // matched against the built tree — see tests/mines-ui.test.mjs.
  root.append(nodes.stage);

  return {
    root,
    stage: nodes.stage,
    grid: nodes.grid,
    start: nodes.start,
    startLabel: nodes.startLabel,
    cashOut: nodes.cashout,
    summary: nodes.summary,
    progress: nodes.progress,
    multiplier: nodes.multiplier,
    next: nodes.next,
    potential: nodes.potential,
    betValue: nodes.betValue,
    betHint: nodes.betHint,
    mineValue: nodes.mineValue,
    stepDown,
    stepUp,
    quickChips,
    mineDown,
    mineUp,
    mineChips,
    /** The tiles the board has built, read back after the view has run. */
    get tiles() {
      return nodes.grid.children;
    },
  };
}

/**
 * Build a fake `#modal-root` overlay with the exact selectors resultModal
 * queries (same data attributes as the markup in index.html).
 */
export function createModalDom() {
  const backdrop = createElement('div');
  const closeButton = createElement('button');
  const nodes = {
    icon: createElement('span'),
    title: createElement('h2'),
    message: createElement('p'),
    amount: createElement('p'),
    bet: createElement('dd'),
    multiplier: createElement('dd'),
    factLabel: createElement('dt'),
    fact: createElement('dd'),
    balance: createElement('p'),
    replay: createElement('button'),
  };

  const lookups = {
    '[data-result-modal]': null, // filled below (the panel is the container child)
    '[data-modal-icon]': nodes.icon,
    '[data-modal-title]': nodes.title,
    '[data-modal-message]': nodes.message,
    '[data-modal-amount]': nodes.amount,
    '[data-modal-bet]': nodes.bet,
    '[data-modal-multiplier]': nodes.multiplier,
    '[data-modal-fact-label]': nodes.factLabel,
    '[data-modal-fact]': nodes.fact,
    '[data-modal-balance]': nodes.balance,
    '[data-modal-replay]': nodes.replay,
    '[data-modal-close]': closeButton,
    '[data-modal-backdrop]': backdrop,
  };

  const panel = createElement('div');
  panel.className = 'result-modal';
  lookups['[data-result-modal]'] = panel;

  const container = createElement('div');
  container.hidden = true;
  container.querySelector = (selector) => lookups[selector] ?? null;

  return { container, panel, backdrop, closeButton, ...nodes };
}

/**
 * Install the globals the UI modules expect (document/window/timers).
 * @returns {() => void} restore function
 */
export function installGlobals({ reducedMotion = false } = {}) {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };

  const documentListeners = {};

  globalThis.document = {
    createElement,
    querySelector: () => null,
    querySelectorAll: () => [],
    activeElement: null,
    addEventListener(type, handler) {
      (documentListeners[type] ??= []).push(handler);
    },
    removeEventListener(type, handler) {
      if (documentListeners[type]) {
        documentListeners[type] = documentListeners[type].filter((entry) => entry !== handler);
      }
    },
    /** Fire a document-level event (used to test the modal's Escape key). */
    dispatch(type, event = {}) {
      (documentListeners[type] ?? []).forEach((handler) =>
        handler({ preventDefault() {}, ...event }),
      );
    },
  };

  /**
   * Frames are driven on a timer, so the reel view's real animation loop runs
   * under Node at roughly display rate.
   */
  globalThis.requestAnimationFrame = (callback) =>
    setTimeout(() => callback(Date.now()), 16);
  globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);

  globalThis.window = {
    matchMedia: () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 800,
    scrollTo() {},
  };

  return () => {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    globalThis.cancelAnimationFrame = previous.cancelAnimationFrame;
  };
}

export { NODE_TIMERS };

/** Await a real timer. */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll until `predicate` is true, or give up after `timeout` ms.
 * Lets a test observe a real-timer animation phase without hard-coding sleeps.
 * @returns {Promise<boolean>} the predicate's last value
 */
export async function waitFor(predicate, { timeout = 3_000, interval = 8 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(interval);
  }
  return Boolean(predicate());
}

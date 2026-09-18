/* ============================================================================
   SOQQA — chrome guards contract
   ----------------------------------------------------------------------------
   The "nothing in the chrome is selectable" guarantee has two halves:

     1. the declaration in style.css (section 02), which tests/wiring.test.mjs
        owns because it is the CSS contract, and
     2. the event-level guard in js/ui/chrome.js, which is what actually holds
        when an engine resolves `user-select` through the user agent, and what
        covers the double-click word and triple-click paragraph selections that
        never start a selection drag in the first place.

   This suite drives the real handlers rather than reading the source.
   ========================================================================= */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installChromeGuards, isEditableTarget } from '../js/ui/chrome.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

/** The smallest element that can stand in for the ancestor walk. */
function el(tagName, parent = null, extra = {}) {
  return { nodeType: 1, tagName, parentNode: parent, ...extra };
}

export function runChromeTests(suite) {
  /* ----------------------------------------------------------------------
     What counts as editable
     ---------------------------------------------------------------------- */
  const editable = el('DIV');
  const editableChild = el('SPAN', editable, { isContentEditable: true });

  const cases = [
    ['a div', el('DIV'), false],
    ['a heading', el('H1'), false],
    ['a button', el('BUTTON'), false],
    ['a card', el('ARTICLE'), false],
    ['the reel window', el('DIV'), false],
    ['an input', el('INPUT'), true],
    ['a textarea', el('TEXTAREA'), true],
    ['a select', el('SELECT'), true],
    ['a span inside an input', el('SPAN', el('INPUT')), true],
    ['a deep descendant of a textarea', el('B', el('SPAN', el('TEXTAREA'))), true],
    ['a contenteditable element', editableChild, true],
    ['explicitly not contenteditable', el('DIV', null, { isContentEditable: false }), false],
    ['a text node inside a paragraph', { nodeType: 3, parentNode: el('P') }, false],
    ['a text node inside a textarea', { nodeType: 3, parentNode: el('TEXTAREA') }, true],
    ['nothing at all', null, false],
    ['undefined', undefined, false],
  ];

  const wrong = cases.filter(([, node, expected]) => isEditableTarget(node) !== expected);
  suite.ok(
    'only real form controls count as editable',
    wrong.length === 0,
    wrong.map(([label]) => label).join(', '),
  );

  /* ----------------------------------------------------------------------
     The installed guards
     ---------------------------------------------------------------------- */
  const registered = [];
  const handlers = new Map();
  const doc = {
    documentElement: { dataset: {} },
    addEventListener(type, handler, capture) {
      registered.push({ type, capture: capture === true });
      handlers.set(type, handler);
    },
  };

  suite.ok('the guards install', installChromeGuards(doc) === true);
  suite.ok('installing twice is a no-op', installChromeGuards(doc) === false);
  suite.eq(
    'a selection drag, a text drag and a multi-click are all guarded',
    registered.map((entry) => entry.type).sort(),
    ['dragstart', 'mousedown', 'selectstart'],
  );
  suite.ok(
    'every guard is capture-phase, so nothing can move ahead of it',
    registered.every((entry) => entry.capture),
  );

  /** Fire a guard the way the browser would, and report whether it cancelled. */
  function dispatch(type, target, detail = 1) {
    const event = {
      target,
      detail,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    handlers.get(type)(event);
    return event.defaultPrevented;
  }

  suite.ok('dragging across a heading cannot start a selection', dispatch('selectstart', el('H1')));
  suite.ok('dragging across a card cannot either', dispatch('selectstart', el('ARTICLE')));
  suite.ok('a text drag out of the chrome is cancelled', dispatch('dragstart', el('P')));
  suite.ok('a double-click cannot select a word', dispatch('mousedown', el('SPAN'), 2));
  suite.ok('a triple-click cannot select a paragraph', dispatch('mousedown', el('SPAN'), 3));

  // The carve-outs. A single click is left alone on purpose: cancelling it would
  // also cancel the focus it performs, which would break keyboard flow.
  suite.ok('a single click is never cancelled, so focus still works', !dispatch('mousedown', el('BUTTON'), 1));
  suite.ok('a drag inside a textarea is allowed', !dispatch('selectstart', el('TEXTAREA')));
  suite.ok('a double-click inside an input still selects a word', !dispatch('mousedown', el('INPUT'), 2));
  suite.ok('a drag out of a contenteditable is allowed', !dispatch('selectstart', editableChild));

  /* ----------------------------------------------------------------------
     The guard is wired up, and agrees with the stylesheet
     ---------------------------------------------------------------------- */
  const main = read('js/main.js');
  suite.ok(
    'the app installs the guards at boot',
    main.includes("from './ui/chrome.js'") && main.includes('installChromeGuards()'),
    'main.js',
  );

  const chrome = read('js/ui/chrome.js');
  const curated = ['input', 'textarea', 'select', 'contenteditable'];
  suite.ok(
    'the editable set matches the stylesheet opt-in',
    curated.every((token) => chrome.includes(token)),
    curated.filter((token) => !chrome.includes(token)).join(', '),
  );

  suite.note('selectstart · dragstart · mousedown(detail>1) — all capture-phase');
}

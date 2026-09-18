/* ============================================================================
   SOQQA — DOM wiring contract
   Every selector the JavaScript queries must exist in index.html, and every
   element the UI reads must be reachable from the module that needs it.
   This catches selector typos that a browser would only reveal at runtime.
   ========================================================================= */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** Every .js module under js/, recursively. */
function listSourceModules(dir = join(ROOT, 'js')) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listSourceModules(full);
    return entry.endsWith('.js') ? [full] : [];
  });
}

const MODULES = [
  'js/main.js',
  'js/router.js',
  'js/games/betting.js',
  'js/games/paytable.js',
  'js/games/mines.js',
  'js/games/slots.js',
  'js/games/wheel.js',
  'js/store/state.js',
  'js/store/storage.js',
  'js/views/minesView.js',
  'js/views/slotsView.js',
  'js/views/wheelView.js',
  'js/ui/balanceView.js',
  'js/ui/betControls.js',
  'js/ui/chrome.js',
  'js/ui/historyView.js',
  'js/ui/mineControls.js',
  'js/ui/minesGrid.js',
  'js/ui/reelView.js',
  'js/ui/symbolArt.js',
  'js/ui/resultModal.js',
  'js/ui/statsView.js',
  'js/ui/toast.js',
  'js/ui/confetti.js',
  'js/ui/wheelDisc.js',
];

/** Pull every selector string out of querySelector/querySelectorAll calls. */
function extractSelectors(source) {
  const selectors = [];
  const pattern = /querySelector(?:All)?\(\s*(['"`])(.+?)\1\s*\)/g;
  let match = pattern.exec(source);
  while (match) {
    selectors.push(match[2]);
    match = pattern.exec(source);
  }
  return selectors;
}

/**
 * Selectors queried against a subtree the app builds at runtime, so they
 * legitimately do not appear in index.html.
 *
 * `js/ui/reelView.js` queries `.reel-symbol` inside a strip it filled itself
 * from the sprite (see js/ui/symbolArt.js). Every value here is still covered:
 * tests/symbols.test.mjs asserts the artwork the cells are built from, and
 * tests/ui-flow.test.mjs asserts the cells' contents at runtime.
 */
const RUNTIME_SELECTORS = new Set(['js/ui/reelView.js → .reel-symbol']);

/** Does a single simple selector (no commas) exist in the HTML? */
function selectorExists(html, selector) {
  const trimmed = selector.trim();

  if (trimmed.startsWith('#')) return html.includes(`id="${trimmed.slice(1)}"`);

  if (trimmed.startsWith('.')) {
    const cls = trimmed.slice(1).split(/[.[:]/)[0];
    return new RegExp(`class="[^"]*\\b${cls}\\b`).test(html);
  }

  if (trimmed.startsWith('[')) {
    const attrMatch = trimmed.match(/^\[([\w-]+)(?:=(["'])(.*?)\2)?\]$/);
    if (!attrMatch) return true; // complex attribute selector — skip
    const [, name, , value] = attrMatch;
    if (value === undefined) return html.includes(name);
    // Template-literal values like [data-stat="${key}"] only need the prefix.
    if (value.includes('${')) return html.includes(`${name}="`);
    return html.includes(`${name}="${value}"`);
  }

  // Type/pseudo selectors (input, textarea, :focus…) are not asserted.
  return true;
}

export function runWiringTests(suite) {
  const htmlPath = join(ROOT, 'index.html');
  suite.ok('index.html exists', existsSync(htmlPath));

  const html = readFileSync(htmlPath, 'utf8');
  const css = readFileSync(join(ROOT, 'style.css'), 'utf8');

  /* --- module files ---------------------------------------------------- */
  MODULES.forEach((module) => {
    suite.ok(`module exists: ${module}`, existsSync(join(ROOT, module)));
  });

  suite.ok(
    'index.html loads the module entry point',
    /type="module"\s+src="js\/main\.js(\?v=\d+)?"/.test(html),
  );
  // The stylesheet and the entry script are stamped with one version, so a
  // browser holding a cached copy of either can never be shown the old one.
  const assetVersions = [...html.matchAll(/\?v=(\d+)/g)].map((match) => match[1]);
  suite.ok(
    'both versioned assets are stamped with the same version',
    assetVersions.length === 2 && new Set(assetVersions).size === 1,
    assetVersions.join(', '),
  );
  suite.ok('the old script.js is gone', !existsSync(join(ROOT, 'script.js')));
  suite.ok('html is declared as Uzbek', html.includes('lang="uz"'));
  suite.ok('a confetti canvas exists', html.includes('id="confetti-canvas"'));
  suite.ok('a toast root exists', html.includes('id="toast-root"'));

  /* --- selectors ------------------------------------------------------- */
  const missing = [];

  MODULES.forEach((module) => {
    const source = readFileSync(join(ROOT, module), 'utf8');
    extractSelectors(source)
      .flatMap((selector) => selector.split(','))
      .map((selector) => selector.trim())
      .filter(Boolean)
      .forEach((selector) => {
        const key = `${module} → ${selector}`;
        if (RUNTIME_SELECTORS.has(key)) return;
        if (!selectorExists(html, selector)) missing.push(key);
      });
  });

  suite.ok('every queried selector exists in index.html', missing.length === 0, missing.join('; '));
  suite.ok(
    'the runtime-selector allowlist has no stale entries',
    [...RUNTIME_SELECTORS].every((key) => {
      const [module, selector] = key.split(' → ');
      const path = join(ROOT, module);
      return existsSync(path) && readFileSync(path, 'utf8').includes(`'${selector}'`);
    }),
    [...RUNTIME_SELECTORS].join(', '),
  );

  /* --- route ↔ view parity --------------------------------------------- */
  const routes = [...html.matchAll(/data-route="([^"]+)"/g)].map((match) => match[1]).sort();
  const views = [...html.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]).sort();
  suite.eq('every nav route has a matching view', routes, views);

  /* --- classes used by JS must be styled ------------------------------- */
  const jsAndHtml = [...MODULES.map((module) => readFileSync(join(ROOT, module), 'utf8')), html].join('\n');
  // [class defined in the stylesheet, needle to look for in the JS/HTML]
  const dynamicClasses = [
    ['is-win', 'is-win'],
    ['is-lose', 'is-lose'],
    ['is-spinning', 'is-spinning'],
    ['is-landing', 'is-landing'],
    ['is-locked', 'is-locked'],
    // reel turn beats: ramp → peak → brake → landing, plus the loop's own
    // compositing-promotion flag
    ['is-peak', 'is-peak'],
    ['is-braking', 'is-braking'],
    ['is-locking', 'is-locking'],
    ['is-turning', 'is-turning'],
    ['is-big-win', 'is-big-win'],
    // the top win tier gets its own light show
    ['is-jackpot', 'is-jackpot'],
    // the gold lock glint is scoped to a turn the engine has already decided pays
    ['is-paying', 'is-paying'],
    // vector symbol art + the celebration lighting layer
    ['symbol-sprite', 'symbol-sprite'],
    ['reel-symbol__art', 'reel-symbol__art'],
    ['reel-window__lights', 'reel-window__lights'],
    ['paytable__symbol-art', 'paytable__symbol-art'],
    ['history-row__symbol-art', 'history-row__symbol-art'],
    ['cabinet--slots', 'cabinet--slots'],
    ['is-active', 'is-active'],
    ['toast', 'toast'],
    ['toast--leaving', 'toast--leaving'],
    ['history-row', 'history-row'],
    // built from a template literal: `history-row--${outcome}`
    ['history-row--win', 'history-row--'],
    ['history-row--loss', 'history-row--'],
    ['balance-chip', 'balance-chip'],
    ['reel-summary', 'reel-summary'],
    ['confetti-canvas', 'confetti-canvas'],
    ['bet-hint', 'bet-hint'],
    ['wheel-label', 'wheel-label'],
    ['wheel-label--blank', 'wheel-label--blank'],
    // the top-tier multiplier is engraved rather than painted
    ['wheel-label--top', 'wheel-label--top'],
    // the wheel's drum face, its metal seams, its pegs and the lit winning wedge
    ['wheel-face', 'wheel-face'],
    ['wheel-wedge', 'wheel-wedge'],
    ['wheel-seam', 'wheel-seam'],
    ['wheel-peg', 'wheel-peg'],
    // the lamps: a socket each, and the one glow that carries the chase
    ['wheel-lamp', 'wheel-lamp'],
    ['wheel-lamp__glow', 'wheel-lamp__glow'],
    ['is-chasing', 'is-chasing'],
    // the mines board: built in JS from the config, turning one tile at a time
    ['game-layout--mines', 'game-layout--mines'],
    ['cabinet--mines', 'cabinet--mines'],
    ['mines-stage', 'mines-stage'],
    ['mines-grid', 'mines-grid'],
    ['mines-panel', 'mines-panel'],
    ['mines-hud', 'mines-hud'],
    ['mines-readout', 'mines-readout'],
    ['mines-actions', 'mines-actions'],
    ['mines-tile', 'mines-tile'],
    ['mines-tile__inner', 'mines-tile__inner'],
    ['mines-tile__face', 'mines-tile__face'],
    ['mines-tile__art-slot', 'mines-tile__art-slot'],
    ['mines-tile__art', 'mines-tile__art'],
    ['mines-tile__glow', 'mines-tile__glow'],
    ['mines-tile__shock', 'mines-tile__shock'],
    // the sparks a gem throws, built from MINES.gemSparks when the board is made
    ['mines-tile__spark', 'mines-tile__spark'],
    ['mines-float', 'mines-float'],
    ['is-revealed', 'is-revealed'],
    ['is-gem', 'is-gem'],
    ['is-mine', 'is-mine'],
    ['is-hit', 'is-hit'],
    // the board holds its unturned tiles back while the end-of-round wave runs
    ['is-revealing', 'is-revealing'],
    // the celebration tier: a cash out past MINES.bigWinMultiplier
    ['is-big', 'is-big'],
    ['mines-stage__glow', 'mines-stage__glow'],
    // the gilded cash-out button, armed only once a tile has been turned
    ['btn--cashout', 'btn--cashout'],
    ['is-armed', 'is-armed'],
    ['is-live', 'is-live'],
    ['wheel-wedge-glow', 'wheel-wedge-glow'],
    ['is-lost', 'is-lost'],
    ['legend__odds', 'legend__odds'],
    ['legend__mult--zero', 'legend__mult--zero'],
    ['legend__mult--jackpot', 'legend__mult--jackpot'],
    ['legend__foot', 'legend__foot'],
    ['result-modal', 'result-modal'],
    ['result-modal__panel', 'result-modal__panel'],
    ['result-modal__amount', 'result-modal__amount'],
  ];

  dynamicClasses.forEach(([className, needle]) => {
    suite.ok(
      `.${className} is used in JS/HTML and defined in CSS`,
      jsAndHtml.includes(needle) && css.includes(`.${className}`),
    );
  });

  /* --- import graph ---------------------------------------------------- */
  {
    const brokenImports = [];
    const sources = listSourceModules();

    suite.ok('js/ contains modules', sources.length >= 10, `found ${sources.length}`);

    sources.forEach((file) => {
      const source = readFileSync(file, 'utf8');
      const specifiers = [...source.matchAll(/from\s+(['"])(\.\/.+?)\1/g)].map((match) => match[2]);

      specifiers.forEach((specifier) => {
        const target = resolve(dirname(file), specifier);
        if (!existsSync(target)) brokenImports.push(`${file.replace(ROOT, '')} → ${specifier}`);
      });
    });

    suite.ok('every relative import resolves to a real file', brokenImports.length === 0, brokenImports.join('; '));
  }

  /* --- non-editable chrome --------------------------------------------- */
  // Nothing in the shell is a document. A drag across a title, a label, a card,
  // a reel or the empty space around them must not sweep a highlight, must not
  // raise a caret and must not turn the pointer into a text I-beam — while any
  // real form control still behaves exactly like the native one.
  {
    const bodyStart = css.indexOf('\nbody {');
    const bodyBlock = css.slice(bodyStart, css.indexOf('\n}', bodyStart));
    suite.ok('a tap cannot flash a highlight box', /-webkit-tap-highlight-color:\s*transparent/.test(bodyBlock));

    // The rule has to sit on every element, not on the shell and left to
    // inheritance: the I-beam a browser offers over text comes from the user
    // agent, and only a declaration on the element itself is guaranteed to
    // outrank it in every engine. So the selector is asserted, not assumed.
    // Comments discuss the rules, so everything here reads the code only.
    const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const chromeStart = cssCode.indexOf('box-sizing: border-box;\n  cursor: default;');
    const chromeBlock = cssCode.slice(chromeStart, cssCode.indexOf('\n}', chromeStart));
    const selectorStart = cssCode.lastIndexOf('}', chromeStart) + 1;
    const chromeSelector = cssCode.slice(selectorStart, cssCode.indexOf('{', selectorStart)).trim().replace(/\s+/g, ' ');
    suite.ok('the non-selectable chrome rule was located', chromeStart !== -1 && chromeBlock.length > 80);
    suite.eq(
      'the chrome rule applies to every element, not to an ancestor',
      chromeSelector,
      '*, *::before, *::after',
    );
    suite.ok(
      'nothing in the chrome is selectable, prefixed and unprefixed',
      /-webkit-user-select:\s*none/.test(chromeBlock) && /(^|\s)user-select:\s*none/.test(chromeBlock),
      chromeBlock.replace(/\s+/g, ' ').trim().slice(0, 80),
    );
    suite.ok('no caret is ever painted into the chrome', /caret-color:\s*transparent/.test(chromeBlock));
    suite.ok('text cannot turn the pointer into an I-beam', /cursor:\s*default/.test(chromeBlock));

    // The allowlist is load-bearing rather than decorative: `cursor: default`
    // on `*` is an author declaration, so without it links would lose their
    // pointer — the UA rule that gives them one is a lower origin.
    const interactiveStart = css.indexOf('\na,\nbutton,\nsummary,');
    const interactive = css.slice(interactiveStart, css.indexOf('\n}', interactiveStart));
    suite.ok('the interactive allowlist was located', interactiveStart !== -1 && interactive.length > 60);
    suite.ok(
      'links and buttons are explicitly given their pointer back',
      /(^|\n)a,/.test(interactive) && /(^|\n)button,/.test(interactive) && /cursor:\s*pointer/.test(interactive),
    );

    const optInStart = css.indexOf('input,\ntextarea,\nselect,');
    const optIn = css.slice(optInStart, css.indexOf('\n}', optInStart));
    suite.ok('the editable-control opt-in was located', optInStart !== -1 && optIn.length > 60);
    suite.ok(
      'real form controls keep ordinary selection',
      /-webkit-user-select:\s*text/.test(optIn) && /(^|\s)user-select:\s*text/.test(optIn),
    );
    suite.ok('real form controls keep a visible caret', /caret-color:\s*auto/.test(optIn));
    suite.ok(
      'the opt-in never relies on `user-select: auto`, which would inherit the `none` above',
      !/user-select:\s*auto/.test(optIn),
    );
    suite.ok(
      'the opt-in covers inputs, textareas, selects and contenteditable',
      ['input', 'textarea', 'select', '[contenteditable]'].every((tag) => optIn.includes(tag)),
    );

    // Interactive chrome has to keep its hand. `cursor: default` belongs to
    // exactly one rule — the shell's — so nothing below can quietly flatten a
    // button's or a chip's pointer back to an arrow.
    const defaults = [...cssCode.matchAll(/cursor:\s*default/g)].length;
    suite.ok('exactly one rule sets the default cursor', defaults === 1, `${defaults} declarations`);
    suite.ok('buttons keep a pointer cursor', /button\s*{[^}]*cursor:\s*pointer/.test(cssCode));
  }

  /* --- the CTA sheen loops while the pointer rests on the button ------- */
  // A sweep that runs once and stops leaves the button looking spent for the
  // rest of the hover. It is asserted as a loop, and the seam is asserted to be
  // invisible: every pass carries the band out of the clipped box at both ends,
  // so the restart back to -120% happens off-screen. That is the reason the
  // iteration count can be `infinite` without the sweep visibly jumping.
  {
    const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const hoverStart = cssCode.indexOf('.btn:hover:not(:disabled)::after');
    const hoverBlock = cssCode.slice(hoverStart, cssCode.indexOf('}', hoverStart));
    suite.ok('the button sheen hover rule was located', hoverStart !== -1 && hoverBlock.length > 20);
    suite.ok(
      'the sheen repeats for as long as the pointer stays on the button',
      /animation:\s*sheen\s+[\d.]+m?s\s+var\(--ease-out\)\s+infinite/.test(hoverBlock),
      hoverBlock.replace(/\s+/g, ' ').trim(),
    );
    suite.ok(
      'the sweep still belongs to hover alone, so it cannot sit at rest',
      /opacity:\s*1/.test(hoverBlock),
    );
    suite.ok(
      'the band leaves the clipped box at both ends, so the loop seam is off-screen',
      /@keyframes\s+sheen\s*{\s*from\s*{\s*transform:\s*translateX\(-\d+%\)/.test(cssCode) &&
        /@keyframes\s+sheen\s*{[\s\S]*?to\s*{\s*transform:\s*translateX\(\d+%\)/.test(cssCode),
    );
  }

  /* --- storage keys are namespaced + versioned ------------------------- */
  const config = readFileSync(join(ROOT, 'js/config.js'), 'utf8');
  suite.ok('storage keys are namespaced', config.includes("STORAGE_NAMESPACE = 'SOQQA.v1'"));
  suite.ok('no real-money wording in the config copy', !/deposit|withdraw|payment|credit card/i.test(config));
}

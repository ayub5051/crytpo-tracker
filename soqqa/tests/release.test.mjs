/* ============================================================================
   SOQQA — release readiness
   ----------------------------------------------------------------------------
   Guards the things a browser-only review would catch but the logic suites
   cannot: the README staying in sync with the code, Uzbek text consistency,
   console hygiene and the responsive/accessibility floors.
   ========================================================================= */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BET_LADDER, HISTORY_LIMIT, STARTING_BALANCE, STORAGE_NAMESPACE } from '../js/config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

/** Every .js module under js/, recursively. */
function listSourceModules(dir = join(ROOT, 'js')) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listSourceModules(full);
    return entry.endsWith('.js') ? [full.replace(`${ROOT}/`, '')] : [];
  });
}

/**
 * The Uzbek apostrophe (U+2019) is the only one allowed between two letters.
 * A plain ASCII "'" would render as a different glyph and split the copy
 * between the HTML and the JS dictionaries.
 */
const ASCII_APOSTROPHE_BETWEEN_LETTERS = /[A-Za-z]'[A-Za-z]/;

/** Comments may keep their English contractions; string literals may not. */
function stripJsComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** "1 000 000" and "1000000" must both satisfy a numeric assertion. */
const digitsOnly = (text) => text.replace(/\s/g, '');

export function runReleaseTests(suite) {
  const html = read('index.html');
  const css = read('style.css');
  const pkg = JSON.parse(read('package.json'));
  const modules = listSourceModules();

  /* ----------------------------------------------------------------------
     Documentation
     ---------------------------------------------------------------------- */
  const readmePath = join(ROOT, 'README.md');
  const hasReadme = existsSync(readmePath);
  suite.ok('README.md exists next to index.html', hasReadme);

  const readme = hasReadme ? readFileSync(readmePath, 'utf8') : '';
  const readmeFlat = digitsOnly(readme);

  suite.ok(
    'README documents the local http server command',
    readme.includes('python3 -m http.server'),
  );
  suite.ok(
    'README explains why file:// does not work',
    /file:\/\//.test(readme) && /module/i.test(readme),
  );
  suite.ok(
    'README documents the starting balance',
    readmeFlat.includes(String(STARTING_BALANCE)),
  );
  suite.ok(
    'README documents the history cap',
    readme.includes(String(HISTORY_LIMIT)),
  );
  suite.ok(
    'README documents the storage namespace',
    readme.includes(STORAGE_NAMESPACE),
  );
  suite.ok(
    'README documents the bet ladder',
    BET_LADDER.every((bet) => readmeFlat.includes(String(bet))),
    BET_LADDER.join(', '),
  );
  suite.ok(
    'README documents how to run the tests',
    readme.includes('tests/run-tests.mjs') && readme.includes('npm test'),
  );
  suite.ok(
    'README carries the demo-only disclaimer',
    /haqiqiy pul ishlatilmaydi/i.test(readme),
  );
  suite.ok(
    'README describes every source folder',
    ['js/games/', 'js/store/', 'js/ui/', 'js/views/', 'js/utils/'].every((folder) =>
      readme.includes(folder),
    ),
  );

  // Every route the app exposes has to be listed in the docs.
  const routes = [...html.matchAll(/data-route="([^"]+)"/g)].map((match) => match[1]);
  suite.ok('the app exposes its routes', routes.length >= 4, routes.join(', '));
  suite.ok(
    'README lists every route',
    routes.every((route) => readme.includes(`#${route}`)),
    routes.filter((route) => !readme.includes(`#${route}`)).join(', '),
  );

  /* ----------------------------------------------------------------------
     Version parity
     ---------------------------------------------------------------------- */
  const [major, minor] = String(pkg.version).split('.');
  suite.ok(
    `the footer version matches package.json (${pkg.version})`,
    html.includes(`v${major}.${minor}`),
  );
  suite.ok('package.json still declares the test script', pkg.scripts?.test?.includes('run-tests'));

  /* ----------------------------------------------------------------------
     Uzbek text consistency
     ---------------------------------------------------------------------- */
  suite.ok('the document is declared as Uzbek', html.includes('lang="uz"'));
  suite.ok(
    'index.html uses the typographic Uzbek apostrophe',
    html.includes('\u2019'),
  );

  const htmlOffenders = html
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter((entry) => ASCII_APOSTROPHE_BETWEEN_LETTERS.test(entry.text));
  suite.ok(
    'index.html has no ASCII apostrophe inside a word',
    htmlOffenders.length === 0,
    htmlOffenders.map((entry) => `${entry.line}: ${entry.text.trim()}`).join(' | '),
  );

  const jsOffenders = [];
  modules.forEach((module) => {
    const stripped = stripJsComments(read(module));
    stripped.split('\n').forEach((line, index) => {
      if (ASCII_APOSTROPHE_BETWEEN_LETTERS.test(line)) {
        jsOffenders.push(`${module}:${index + 1} → ${line.trim()}`);
      }
    });
  });
  suite.ok(
    'every JS string uses the Uzbek apostrophe (comments excluded)',
    jsOffenders.length === 0,
    jsOffenders.join(' | '),
  );

  // The player-facing dictionary is complete and Uzbek (no empty placeholders).
  const config = read('js/config.js');
  const copyBlock = config.slice(config.indexOf('export const COPY'));
  const copyEntries = [...copyBlock.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]);
  suite.ok('the Uzbek copy dictionary is populated', copyEntries.length >= 20, `${copyEntries.length} keys`);
  suite.ok(
    'the copy dictionary has no empty strings',
    !/:\s*''\s*,/.test(copyBlock),
  );

  /* ----------------------------------------------------------------------
     Console hygiene
     ---------------------------------------------------------------------- */
  const noisy = modules.filter((module) =>
    /\bconsole\.(log|debug|info|warn|trace|dir|table)\b/.test(read(module)),
  );
  suite.ok('no console.log/debug leftovers in js/', noisy.length === 0, noisy.join(', '));

  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
  suite.ok('exactly one script tag is present', scripts.length === 1, scripts.join(' | '));
  suite.ok(
    'the script is the deferred module entry point',
    scripts[0]?.includes('type="module"') && /src="js\/main\.js(\?v=\d+)?"/.test(scripts[0] ?? ''),
  );

  const inlineHandlers = [...html.matchAll(/\son[a-z]+\s*=/gi)].map((match) => match[0].trim());
  suite.ok('no inline event handlers in index.html', inlineHandlers.length === 0, inlineHandlers.join(', '));

  /* ----------------------------------------------------------------------
     Boot fallback
     ----------------------------------------------------------------------
     The one failure that makes the page look crashed is `type="module"` being
     blocked under file://, which stops every module loading. It cannot be
     caught by any logic suite, so it is caught here: the page must be able to
     explain that silence, and main.js must be the thing that retires the
     explanation — the panel is only trustworthy if a successful boot removes
     it, and it can only work with no script at all, or it would never fire in
     the exact scenario it exists for.
     ---------------------------------------------------------------------- */
  const mainSource = read('js/main.js');

  suite.ok(
    'index.html carries the boot fallback panel',
    /class="boot-fallback"/.test(html) && html.includes('id="boot-fallback"'),
  );
  suite.ok(
    'the fallback tells the player to serve over http',
    html.includes('python3 -m http.server'),
  );
  suite.ok(
    'a successful boot marks the document, which is what retires the panel',
    /documentElement\.dataset\.booted\s*=/.test(mainSource),
  );
  // The mark has to be the LAST thing boot() does: a throw above it leaves the
  // panel up, which is the honest outcome for a half-finished boot.
  const bootBody = mainSource.slice(mainSource.indexOf('export function boot()'));
  const bootedAt = bootBody.indexOf('dataset.booted');
  const lastBrace = bootBody.indexOf('\n}\n');
  suite.ok(
    'the booted mark comes after everything else in boot()',
    bootedAt > 0 && (lastBrace === -1 || bootedAt < lastBrace),
  );
  // No script may be added to drive it — the single-script contract above
  // already forbids a second tag, so the reveal has to be pure CSS.
  suite.ok(
    'the fallback is hidden for good once booted',
    /html\[data-booted='true'\]\s+\.boot-fallback\s*\{[^}]*display:\s*none/.test(css),
  );
  suite.ok(
    'the fallback is revealed without script, on a delay',
    /\.boot-fallback\s*\{[^}]*visibility:\s*hidden/.test(css) &&
      /animation:\s*boot-reveal[^;]*\d+m?s\s+forwards/.test(css),
  );
  // A filter on an element whose opacity is animated re-rasterises it every
  // frame; a diagnostic must not cost a compositor layer.
  const fallbackRule = css.match(/\.boot-fallback\s*\{[^}]*\}/)?.[0] ?? '';
  suite.ok(
    'the fallback panel carries no filter',
    !/filter:/.test(fallbackRule),
    fallbackRule.replace(/\s+/g, ' ').slice(0, 90),
  );

  /* ----------------------------------------------------------------------
     Navigation health
     ---------------------------------------------------------------------- */
  // Only navigation anchors: `<use href="#soqqa-sym-…">` is an SVG reference,
  // not a link, and must not be mistaken for a route.
  const anchors = [...html.matchAll(/<a\b[^>]*\shref="(#[^"]*)"/g)].map((match) => match[1]);
  suite.ok('index.html has internal navigation links', anchors.length >= 4);
  suite.ok(
    'no bare "#" links (they would silently fall back to the landing view)',
    !anchors.includes('#'),
  );
  suite.ok(
    'every hash link points at a real route',
    anchors.every((href) => routes.includes(href.replace(/^#/, ''))),
    anchors.filter((href) => !routes.includes(href.replace(/^#/, ''))).join(', '),
  );
  suite.ok(
    'unknown hashes still resolve in the router',
    read('js/router.js').includes('defaultRoute'),
  );

  /* ----------------------------------------------------------------------
     Responsive & accessibility floors
     ---------------------------------------------------------------------- */
  suite.ok(
    'the viewport meta tag is present',
    html.includes('name="viewport"') && html.includes('width=device-width'),
  );
  suite.ok('a theme colour is declared', html.includes('name="theme-color"'));
  // Without a declared icon the browser requests /favicon.ico and logs a 404.
  suite.ok(
    'an inline favicon is declared (no stray favicon request)',
    html.includes('rel="icon"') && html.includes('data:image/svg+xml,'),
  );
  suite.ok('a page description is declared', html.includes('name="description"'));
  suite.ok('colour scheme is declared', html.includes('name="color-scheme"'));
  suite.ok(
    'the document title names the app and its subject',
    /<title>SOQQA — Premium Casino Games<\/title>/.test(html),
  );

  // A preview card is built from these, not from <title>, and a missing og:title
  // is the difference between a titled link and a bare URL in every chat client.
  suite.ok(
    'the link-preview tags are declared',
    ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:locale'].every((property) =>
      html.includes(`property="${property}"`),
    ) && html.includes('name="twitter:card"'),
  );
  suite.ok(
    'no og:image points at a card image the demo does not ship',
    !/property="og:image"/.test(html),
  );

  // The favicon is a `data:` URI, which is what lets the app live under any
  // prefix: it needs no path resolved against a deployment root.
  suite.ok(
    'no asset URL is rooted at the domain, so any subfolder deployment works',
    !/(?:href|src)="\//.test(html),
  );

  suite.ok('a 1024px breakpoint exists', css.includes('@media (max-width: 1024px)'));
  suite.ok('a 640px breakpoint exists', css.includes('@media (max-width: 640px)'));
  suite.ok('reduced motion is honoured', css.includes('@media (prefers-reduced-motion: reduce)'));
  suite.ok('increased contrast is honoured', css.includes('@media (prefers-contrast: more)'));
  suite.ok(
    'the page shell cannot scroll horizontally',
    /body\s*{[^}]*overflow-x:\s*hidden/.test(css),
  );

  // A tall result modal must scroll inside itself rather than clip its buttons
  // off a short (landscape phone) viewport.
  const modalPanel = css.slice(css.indexOf('.result-modal__panel {'));
  const modalRules = modalPanel.slice(0, modalPanel.indexOf('\n}'));
  suite.ok(
    'the result modal panel is height-bounded and scrollable',
    /max-height:\s*calc\(100dvh/.test(modalRules) && /overflow-y:\s*auto/.test(modalRules),
  );
  suite.ok(
    'the bottom-sheet layout reserves room for the home indicator',
    css.includes('env(safe-area-inset-bottom'),
  );

  suite.ok(
    'the wheel is sized relative to the viewport',
    /--wheel-size:\s*min\([^)]*vw\)/.test(css),
  );
  suite.ok(
    'focus is visible for keyboard users',
    css.includes(':focus-visible'),
  );
  suite.ok(
    'stepper buttons meet the touch-target floor',
    /\.stepper__btn\s*{[^}]*width:\s*44px/.test(css),
  );
  suite.ok(
    'bet chips meet the touch-target floor',
    /\.chip\s*{[^}]*min-height:\s*44px/.test(css),
  );

  /* ----------------------------------------------------------------------
     Deployment configuration
     ---------------------------------------------------------------------- */
  suite.ok('a static deploy config ships with the app', existsSync(join(ROOT, 'vercel.json')));

  let deploy = null;
  try {
    deploy = JSON.parse(read('vercel.json'));
  } catch {
    deploy = null;
  }
  suite.ok('the deploy config is valid JSON', deploy !== null);

  const headerRules = Array.isArray(deploy?.headers) ? deploy.headers : [];
  const cacheFor = (source) =>
    headerRules
      .filter((rule) => rule.source === source)
      .flatMap((rule) => rule.headers ?? [])
      .find((header) => header.key === 'Cache-Control')?.value ?? '';

  suite.ok('every header rule is well formed', headerRules.length > 0 &&
    headerRules.every(
      (rule) =>
        typeof rule.source === 'string' &&
        Array.isArray(rule.headers) &&
        rule.headers.every((h) => typeof h.key === 'string' && typeof h.value === 'string'),
    ));
  suite.ok(
    'the token-versioned assets are cached immutably',
    /immutable/.test(cacheFor('/(.*)\\.(css|js|mjs|svg|woff2)')),
    cacheFor('/(.*)\\.(css|js|mjs|svg|woff2)'),
  );
  // Long-caching the assets is only safe while the document that points at them
  // is revalidated — otherwise a new token would never reach the browser.
  suite.ok(
    'the document is never cached, so a new asset token is always seen',
    /must-revalidate/.test(cacheFor('/')) && /must-revalidate/.test(cacheFor('/(.*).html')),
  );
  suite.ok(
    'the deploy config is documented in the README',
    readme.includes('vercel.json'),
  );

  suite.note(`${modules.length} modules · ${(css.length / 1024).toFixed(0)} KB CSS · README ${(readme.length / 1024).toFixed(1)} KB`);
}

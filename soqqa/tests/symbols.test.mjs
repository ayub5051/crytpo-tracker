/* ============================================================================
   SOQQA — symbol artwork contract
   ----------------------------------------------------------------------------
   The things a browser-only review would catch, kept honest by reading the real
   files:

     • every symbol in js/config.js has matching vector artwork in the sprite,
       and every artwork the sprite declares belongs to a real symbol
     • the strips carry no emoji at all — the art is the sprite, and the cells
       (built at runtime, see tests/reel-physics.test.mjs) point straight at it
     • the static win line is gone from the markup and the stylesheet
     • the cabinet is dark at rest and only lights up for a win, and the gold lock
       glint only exists on a turn the engine has already decided pays
     • the drums are never blurred — the strip carries no filter at all, so the
       symbols stay sharp at every frame of a turn
     • a win is lit: a golden light stroke pulses around each winning symbol
     • the CSS drum geometry still leaves a real gap between cells, which is what
       keeps the aperture window inside the strip

   The motion itself is asserted in tests/reel-physics.test.mjs, against the pure
   module, and in tests/ui-flow.test.mjs, against the real DOM wiring.
   ========================================================================= */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REEL_COUNT, REEL_TURN, SYMBOL_ORDER } from '../js/config.js';
import {
  SYMBOL_SPRITE_PREFIX,
  createSymbolCell,
  symbolHref,
  symbolSpriteId,
  symbolSvgMarkup,
} from '../js/ui/symbolArt.js';
import { createElement } from './fakeDom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

/** The slice of index.html that holds the reel cabinet. */
function cabinetMarkup(html) {
  const start = html.indexOf('class="card cabinet cabinet--slots"');
  const end = html.indexOf('class="card paytable"');
  return start === -1 || end === -1 ? '' : html.slice(start, end);
}

/** Handles emoji/pictographs, which the vector upgrade removes from the drums. */
const PICTOGRAPHIC = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/u;

/* ============================================================================
   SVG geometry walk
   ----------------------------------------------------------------------------
   Every symbol is drawn on a shared 64x64 artboard and has to fit inside it: a
   shape that runs past the viewBox edge is precisely what "clipped in the reel
   cell" looks like, and because the cell scales the artboard with
   `preserveAspectRatio`, one oversized symbol would shrink the whole set with
   it.

   So the artwork is walked for real — every element, group, <use> and transform
   — and the union of its geometry is asserted to sit inside the artboard.
   Bounds come from the control hull of each path segment, which contains the
   curve, so the walk is conservative: art that passes cannot overflow. The
   sprite deliberately contains no arcs and no filters, which is what keeps the
   walk exact rather than approximate.
   ========================================================================= */

const IDENTITY = [1, 0, 0, 1, 0, 0];
const VOID_TAGS = new Set(['path', 'circle', 'rect', 'ellipse', 'line', 'polygon', 'polyline', 'use', 'stop', 'image']);

/** m then n, as 2x3 affine matrices. */
function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function applyMatrix(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function parseTransform(value) {
  let m = IDENTITY;
  if (!value) return m;
  for (const part of value.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const n = part[2].split(/[\s,]+/).filter(Boolean).map(Number);
    const fn = part[1];
    if (fn === 'translate') m = multiply(m, [1, 0, 0, 1, n[0] || 0, n[1] || 0]);
    else if (fn === 'scale') m = multiply(m, [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0]);
    else if (fn === 'matrix') m = multiply(m, n.slice(0, 6));
    else if (fn === 'rotate') {
      const rad = ((n[0] || 0) * Math.PI) / 180;
      const spin = [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];
      const cx = n[1] || 0;
      const cy = n[2] || 0;
      m = multiply(m, multiply(multiply([1, 0, 0, 1, cx, cy], spin), [1, 0, 0, 1, -cx, -cy]));
    } else {
      throw new Error(`unsupported transform ${fn}()`);
    }
  }
  return m;
}

/**
 * Absolute path geometry as a flat list of points, in user units.
 * Every control point is emitted, so the point set's hull contains the curve.
 */
function pathPoints(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const points = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let cmd = null;
  let lastCubic = null;
  let lastQuad = null;
  const num = () => Number(tokens[i++]);

  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    else if (cmd === null) throw new Error(`path does not start with a command: ${d}`);
    const rel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();
    const abs = (x, y) => [rel ? cx + x : x, rel ? cy + y : y];

    if (upper === 'Z') {
      cx = startX;
      cy = startY;
      points.push([cx, cy]);
      lastCubic = lastQuad = null;
    } else if (upper === 'M' || upper === 'L' || upper === 'T') {
      const [x, y] = abs(num(), num());
      if (upper === 'T') {
        const control = lastQuad
          ? [2 * cx - lastQuad[0], 2 * cy - lastQuad[1]]
          : [cx, cy];
        points.push(control);
      }
      cx = x;
      cy = y;
      if (upper === 'M') {
        startX = cx;
        startY = cy;
        cmd = rel ? 'l' : 'L';
      }
      points.push([cx, cy]);
      lastCubic = lastQuad = null;
    } else if (upper === 'H' || upper === 'V') {
      const v = num();
      if (upper === 'H') cx = rel ? cx + v : v;
      else cy = rel ? cy + v : v;
      points.push([cx, cy]);
      lastCubic = lastQuad = null;
    } else if (upper === 'C' || upper === 'S') {
      const c1 =
        upper === 'C'
          ? abs(num(), num())
          : lastCubic
            ? [2 * cx - lastCubic[0], 2 * cy - lastCubic[1]]
            : [cx, cy];
      const c2 = abs(num(), num());
      const end = abs(num(), num());
      points.push(c1, c2, end);
      [cx, cy] = end;
      lastCubic = c2;
      lastQuad = null;
    } else if (upper === 'Q') {
      const c1 = abs(num(), num());
      const end = abs(num(), num());
      points.push(c1, end);
      [cx, cy] = end;
      lastQuad = c1;
      lastCubic = null;
    } else {
      throw new Error(`unsupported path command ${cmd}`);
    }
  }
  return points;
}

/** Every id an element declares, mapped to the element, so <use> can resolve. */
function indexById(node, map = new Map()) {
  if (node.attrs?.id) map.set(node.attrs.id, node);
  (node.children ?? []).forEach((child) => indexById(child, map));
  return map;
}

function boxOfPoints(points, m) {
  if (!points.length) return null;
  let box = [Infinity, Infinity, -Infinity, -Infinity];
  points.forEach(([x, y]) => {
    const [tx, ty] = applyMatrix(m, x, y);
    box = [Math.min(box[0], tx), Math.min(box[1], ty), Math.max(box[2], tx), Math.max(box[3], ty)];
  });
  return box;
}

/** The element's own geometry, before its own transform, or null. */
function localBox(node) {
  const a = node.attrs;
  const num = (key, fallback = 0) => Number(a[key] ?? fallback);
  switch (node.tag) {
    case 'path':
      return boxOfPoints(pathPoints(a.d), IDENTITY);
    case 'circle':
      return [num('cx') - num('r'), num('cy') - num('r'), num('cx') + num('r'), num('cy') + num('r')];
    case 'ellipse':
      return [
        num('cx') - num('rx'),
        num('cy') - num('ry'),
        num('cx') + num('rx'),
        num('cy') + num('ry'),
      ];
    case 'rect':
      return [num('x'), num('y'), num('x') + num('width'), num('y') + num('height')];
    case 'line':
      return [
        Math.min(num('x1'), num('x2')),
        Math.min(num('y1'), num('y2')),
        Math.max(num('x1'), num('x2')),
        Math.max(num('y1'), num('y2')),
      ];
    case 'polygon':
    case 'polyline': {
      const pairs = (a.points ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
      const points = [];
      for (let i = 0; i + 1 < pairs.length; i += 2) points.push([pairs[i], pairs[i + 1]]);
      return boxOfPoints(points, IDENTITY);
    }
    case 'text': {
      // The one place a walk cannot be exact: glyph outlines live in the font.
      // Sized from the font-size and anchored the way the text is, generously.
      const size = num('font-size', 16);
      const x = num('x');
      const y = num('y');
      const width = size * 0.74;
      const left = a['text-anchor'] === 'middle' ? x - width / 2 : a['text-anchor'] === 'end' ? x - width : x;
      return [left, y - size * 0.76, left + width, y + size * 0.24];
    }
    default:
      return null;
  }
}

/** Union of an element's geometry in the parent's coordinate system. */
function boundsOf(node, m, byId) {
  const here = multiply(m, parseTransform(node.attrs?.transform));
  const union = (a, b) =>
    a && b
      ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
      : a || b;

  let box = null;
  if (node.tag === 'use') {
    const target = byId.get((node.attrs.href ?? '').replace('#', ''));
    if (!target) throw new Error(`<use> points at nothing: ${node.attrs.href}`);
    const offset = [1, 0, 0, 1, Number(node.attrs.x ?? 0), Number(node.attrs.y ?? 0)];
    box = boundsOf(target, multiply(here, offset), byId);
  } else {
    const own = localBox(node);
    if (own) {
      // A box is convex, so transforming its corners contains the true shape.
      const corners = [
        [own[0], own[1]],
        [own[0], own[3]],
        [own[2], own[1]],
        [own[2], own[3]],
      ];
      box = boxOfPoints(corners, here);
    }
    (node.children ?? []).forEach((child) => {
      box = union(box, boundsOf(child, here, byId));
    });
  }

  // A gloss band is deliberately larger than the silhouette it is painted into,
  // so a clipped group is measured against its clip, not against its own ink.
  const clip = /url\(#([^)]+)\)/.exec(node.attrs?.['clip-path'] ?? '');
  if (clip) {
    const shape = byId.get(clip[1]);
    if (!shape) throw new Error(`clip-path points at nothing: ${clip[1]}`);
    const clipBox = boundsOf(shape, m, byId);
    if (clipBox) {
      box = box
        ? [
            Math.max(box[0], clipBox[0]),
            Math.max(box[1], clipBox[1]),
            Math.min(box[2], clipBox[2]),
            Math.min(box[3], clipBox[3]),
          ]
        : null;
    }
  }
  return box;
}

/** Minimal SVG tree for one <symbol>, comments dropped so prose is not code. */
function parseSymbol(source) {
  const clean = source.replace(/<!--[\s\S]*?-->/g, ' ');
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const pattern = /<(\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let match;
  while ((match = pattern.exec(clean))) {
    const [, closing, tag, rawAttrs, selfClosing] = match;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = {};
    for (const a of rawAttrs.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    const node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(node);
  }
  return root;
}

/** The union of a whole sprite's rendered geometry, keyed by top-level id. */
function spriteBounds(spriteSource) {
  const root = parseSymbol(spriteSource);
  const byId = indexById(root);
  const bounds = new Map();
  const walk = (node) => {
    if (node.attrs?.id) bounds.set(node.attrs.id, boundsOf(node, IDENTITY, byId));
    (node.children ?? []).forEach(walk);
  };
  walk(root);
  return { byId, bounds };
}

export function runSymbolTests(suite) {
  const html = read('index.html');
  const css = read('style.css');

  /* ----------------------------------------------------------------------
     Sprite coverage
     ---------------------------------------------------------------------- */
  const spriteIds = [...html.matchAll(/<symbol\s+id="([^"]+)"/g)].map((match) => match[1]);

  suite.eq(
    'the sprite declares exactly one <symbol> per configured symbol',
    spriteIds.length,
    SYMBOL_ORDER.length,
  );

  const missingArt = SYMBOL_ORDER.filter((id) => !spriteIds.includes(symbolSpriteId(id)));
  suite.ok(
    'every symbol in config.js has vector artwork in index.html',
    missingArt.length === 0,
    missingArt.join(', '),
  );

  const orphanArt = spriteIds.filter(
    (spriteId) => !SYMBOL_ORDER.includes(spriteId.replace(SYMBOL_SPRITE_PREFIX, '')),
  );
  suite.ok(
    'the sprite declares no artwork for a symbol that does not exist',
    orphanArt.length === 0,
    orphanArt.join(', '),
  );

  const emptyArt = SYMBOL_ORDER.filter((id) => {
    const start = html.indexOf(`<symbol id="${symbolSpriteId(id)}"`);
    if (start === -1) return true;
    const end = html.indexOf('</symbol>', start);
    // A symbol needs real geometry, not just a title.
    return end === -1 || !/<(path|circle|rect|ellipse|g|text)\b/.test(html.slice(start, end));
  });
  suite.ok(
    'every symbol draws actual geometry (no placeholder art)',
    emptyArt.length === 0,
    emptyArt.join(', '),
  );

  const viewboxes = SYMBOL_ORDER.filter(
    (id) => !html.includes(`<symbol id="${symbolSpriteId(id)}" viewBox="0 0 64 64">`),
  );
  suite.ok(
    'every symbol shares the 64x64 artboard',
    viewboxes.length === 0,
    viewboxes.join(', '),
  );

  /* ----------------------------------------------------------------------
     References resolve
     ---------------------------------------------------------------------- */
  const references = [...html.matchAll(new RegExp(`href="#(${SYMBOL_SPRITE_PREFIX}[^"]+)"`, 'g'))]
    .map((match) => match[1]);
  suite.ok(
    'every sprite reference in index.html resolves to real artwork',
    references.every((id) => spriteIds.includes(id)),
    references.filter((id) => !spriteIds.includes(id)).join(', '),
  );
  suite.ok(
    'the cabinet legend shows the same art as the drums',
    references.includes(symbolSpriteId('wild')),
    references.join(', '),
  );

  // The wrapper is zero-sized rather than display:none, which would stop the
  // references from resolving in some engines.
  const spriteRule = css.slice(css.indexOf('.svg-defs,'));
  const spriteBlock = spriteRule.slice(0, spriteRule.indexOf('\n}'));
  suite.ok(
    'the sprite wrapper is hidden by size, never by display:none',
    /overflow:\s*hidden/.test(spriteBlock) &&
      /width:\s*0/.test(spriteBlock) &&
      !/display:\s*none/.test(spriteBlock),
    spriteBlock.replace(/\s+/g, ' ').trim(),
  );

  /* ----------------------------------------------------------------------
     The helper module
     ---------------------------------------------------------------------- */
  suite.eq('symbolHref builds the sprite reference', symbolHref('seven'), '#soqqa-sym-seven');
  suite.eq('symbolSpriteId strips the hash', symbolSpriteId('coin'), 'soqqa-sym-coin');

  const markup = symbolSvgMarkup('diamond', 'paytable__symbol-art');
  suite.ok('symbolSvgMarkup inlines the art', markup.includes('href="#soqqa-sym-diamond"'));
  suite.ok('symbolSvgMarkup applies the caller class', markup.includes('class="paytable__symbol-art"'));
  suite.ok('symbolSvgMarkup is hidden from assistive tech', markup.includes('aria-hidden="true"'));

  /* ----------------------------------------------------------------------
     Strip cells point straight at the sprite
     ---------------------------------------------------------------------- */
  {
    const doc = { createElement };
    const bad = [];
    SYMBOL_ORDER.forEach((id) => {
      const cell = createSymbolCell(doc, id);
      if (!cell.className.includes('reel-symbol')) bad.push(`${id}: class ${cell.className}`);
      if (cell.dataset.symbol !== id) bad.push(`${id}: data-symbol ${cell.dataset.symbol}`);
      if (!cell.innerHTML.includes(`href="${symbolHref(id)}"`)) bad.push(`${id}: href missing`);
      if (!cell.innerHTML.includes('<use ')) bad.push(`${id}: no <use>`);
      if (!cell.innerHTML.includes('aria-hidden="true"')) bad.push(`${id}: not hidden from AT`);
    });
    suite.ok(
      'every strip cell is built pointing at its own sprite artwork',
      bad.length === 0,
      bad.join('; '),
    );
  }

  /* ----------------------------------------------------------------------
     The drums carry no emoji, and no static cells at all
     ---------------------------------------------------------------------- */
  const cabinet = cabinetMarkup(html);
  suite.ok('the slots cabinet markup was located', cabinet.length > 400, `${cabinet.length} chars`);
  suite.ok(
    'the drums render vector art, not emoji',
    cabinet.length > 0 && !PICTOGRAPHIC.test(cabinet),
    (cabinet.match(PICTOGRAPHIC) ?? [''])[0],
  );

  // The drum strip itself, so the cabinet legend's own <use> does not confuse it.
  const reelWindow = cabinet.slice(
    cabinet.indexOf('class="reel-window"'),
    cabinet.indexOf('data-reel-summary'),
  );
  suite.ok('the reel window markup was located', reelWindow.length > 200, `${reelWindow.length} chars`);
  suite.eq(
    'the reel window declares one strip per drum',
    (reelWindow.match(/class="reel-strip"/g) ?? []).length,
    REEL_COUNT,
  );
  suite.ok(
    'every strip is empty — no symbol cell is baked into the markup',
    !reelWindow.includes('reel-symbol') && !reelWindow.includes('<use '),
    reelWindow.includes('reel-symbol') ? 'found a static reel-symbol' : 'clean',
  );

  const modules = ['js/ui/reelView.js', 'js/views/slotsView.js', 'js/ui/historyView.js'];
  const emojiRenderers = modules.filter((file) => /\.emoji\b/.test(read(file)));
  suite.ok(
    'no view renders a symbol through its emoji field any more',
    emojiRenderers.length === 0,
    emojiRenderers.join(', '),
  );

  /* ----------------------------------------------------------------------
     The static win line is gone
     ---------------------------------------------------------------------- */
  suite.ok('the win-line element is removed from index.html', !html.includes('reel-window__payline'));
  suite.ok('the win-line styles are removed too', !css.includes('.reel-window__payline'));
  suite.ok('its pulse keyframes are gone', !css.includes('payline-pulse'));

  /* ----------------------------------------------------------------------
     Drum geometry
     ---------------------------------------------------------------------- */
  const windowBlock = css.slice(css.indexOf('.reel-window {'), css.indexOf('\n}', css.indexOf('.reel-window {')));
  suite.ok(
    'the aperture is exactly three rows tall',
    windowBlock.includes('--reel-window-h: calc(3 * var(--reel-cell) + 2 * var(--reel-gap))'),
    '--reel-window-h',
  );
  suite.ok(
    'the strip is positioned by one numeric offset, not a transition',
    /\.reel-strip\s*{[^}]*transform:\s*translate3d\(0,\s*calc\(var\(--reel-offset[^)]*\)/.test(css) &&
      !/\.reel-strip\s*{[^}]*transition:/.test(css),
    'transform',
  );
  // Crisp scroll: the strip is moved and nothing else. A filter, a blur or a
  // fade anywhere on it would cost the symbols their sharpness mid-turn.
  suite.ok(
    'the strip is never filtered, blurred or faded',
    !/\.reel-strip\s*{[^}]*filter/.test(css) &&
      !/\.reel-strip\s*{[^}]*opacity/.test(css) &&
      !css.includes('--reel-blur'),
    'filter',
  );
  suite.ok(
    'the reel config declares no motion-blur budget either',
    !/blurMaxPx/.test(read('js/config.js')),
    'blurMaxPx',
  );

  // The gap is what keeps the aperture window from running off the end of the
  // shortest strip — see REEL_STRIP.cells and tests/reel-physics.test.mjs.
  const gap = /--sp-2:\s*(\d+)px/.exec(css);
  const cellScale = /--reel-cell:\s*calc\(var\(--reel-symbol-size\)\s*\*\s*([\d.]+)\)/.exec(css);
  suite.ok('the cell pitch is derived from the symbol size', Boolean(cellScale), '--reel-cell');
  suite.ok(
    'there is a real gap between cells, so the window always fits the strip',
    Number(gap?.[1] ?? 0) > 0 && Number(cellScale?.[1] ?? 0) > 1,
    `gap ${gap?.[1]}px · cell ${cellScale?.[1]}x`,
  );

  /* ----------------------------------------------------------------------
     The lock cue matches the physics
     ---------------------------------------------------------------------- */
  const cssLock = /--reel-lock-ms:\s*(\d+)ms/.exec(css);
  suite.ok('the stylesheet declares the lock duration', Boolean(cssLock), '--reel-lock-ms');
  suite.eq(
    'the default lock duration matches the reference landing beat',
    Number(cssLock?.[1]),
    REEL_TURN.phases.landingMs,
  );
  suite.ok(
    'the lock cue reads the per-drum duration the view writes',
    /\.reel\.is-locking\s*{[^}]*var\(--reel-lock-ms\)/.test(css) &&
      /\.reel\.is-locking::after\s*{[^}]*var\(--reel-lock-ms\)/.test(css),
    'is-locking',
  );
  suite.ok(
    'the view writes a per-drum lock duration',
    read('js/ui/reelView.js').includes("setProperty('--reel-lock-ms'"),
    'reelView',
  );
  ['reel-snap', 'reel-flash'].forEach((name) => {
    suite.ok(`the housing cue @keyframes ${name} exists`, css.includes(`@keyframes ${name}`));
  });
  suite.ok(
    'a bare lock still takes the mechanical give',
    /\.reel\.is-locking\s*{[^}]*reel-snap/.test(css),
    'reel-snap',
  );
  // The glint is a win cue, so it has to be scoped — and declared exactly once.
  // Two mentions means the bare `.reel.is-locking::after` rule came back, which
  // would flash gold on losing stops too.
  suite.ok(
    'the gold lock glint runs only on a paying turn',
    /\.reel-window\.is-paying\s+\.reel\.is-locking::after\s*{[^}]*reel-flash/.test(css) &&
      (css.match(/reel-flash/g) ?? []).length === 2,
    `${(css.match(/reel-flash/g) ?? []).length} mentions of reel-flash`,
  );
  suite.ok(
    'the view flags the paying turn before the drums move',
    read('js/ui/reelView.js').includes("'is-paying'") &&
      /if \(result\.matchType\) window_\?\.classList\.add\('is-paying'\)/.test(
        read('js/ui/reelView.js'),
      ),
    'is-paying',
  );

  /* ----------------------------------------------------------------------
     Lighting is earned, not ambient
     ---------------------------------------------------------------------- */
  suite.ok(
    'the resting cabinet carries no ambient gold glow',
    windowBlock.includes('box-shadow: var(--reel-window-shadow);') &&
      !windowBlock.includes('--glow-gold'),
    windowBlock.replace(/\s+/g, ' ').trim().slice(0, 120),
  );
  suite.ok(
    'the celebration layer is inert at rest',
    /\.reel-window__lights\s*{[^}]*opacity:\s*0/.test(css),
  );

  const winStates = ['.is-win', '.is-big-win', '.is-jackpot'].filter(
    (state) => !css.includes(`.reel-window${state} `),
  );
  suite.ok(
    'each win tier has its own cabinet treatment',
    winStates.length === 0,
    winStates.join(', '),
  );
  suite.ok(
    'the winning cells pop once and then settle into a glow',
    /\.reel-symbol\.is-win\s*{[^}]*win-pop/.test(css) && /\.reel-symbol\.is-win\s*{[^}]*win-glow/.test(css),
    'is-win',
  );
  suite.ok(
    'a winning symbol also carries a pulsing golden light stroke',
    /\.reel-symbol\.is-win\s*{[^}]*win-ring/.test(css) && css.includes('@keyframes win-ring'),
    'win-ring',
  );
  suite.ok(
    'the cabinet pulses with a neon halo on a win',
    /\.reel-window\.is-win\s*{[^}]*win-cabinet/.test(css) &&
      css.includes('@keyframes win-cabinet'),
    'win-cabinet',
  );

  // The burst is part of the celebration, so it has to paint *over* the win
  // banner — behind it the backdrop would dim and blur it to nothing. The canvas
  // rule must actually spend the token; a magic number could drift back under
  // the overlay without the tokens changing at all.
  const zConfetti = Number(/--z-confetti:\s*(-?\d+)/.exec(css)?.[1] ?? NaN);
  const zModal = Number(/--z-modal:\s*(-?\d+)/.exec(css)?.[1] ?? NaN);
  const canvasBlock = css.slice(
    css.indexOf('.confetti-canvas {'),
    css.indexOf('\n}', css.indexOf('.confetti-canvas {')),
  );
  suite.ok(
    'the celebration canvas is stacked above the win overlay',
    zConfetti > zModal && zModal > 0 && canvasBlock.includes('z-index: var(--z-confetti)'),
    `confetti ${zConfetti} vs modal ${zModal} · rule ${canvasBlock.replace(/\s+/g, ' ').trim().slice(0, 80)}`,
  );
  suite.ok(
    'the celebration layer can never intercept a click',
    /\.confetti-canvas\s*{[^}]*pointer-events:\s*none/.test(css),
  );

  /* ----------------------------------------------------------------------
     Premium 3D recipe
     ---------------------------------------------------------------------- */
  const spriteMarkup = html.slice(
    html.indexOf('<svg class="symbol-sprite"'),
    html.indexOf('</svg>', html.indexOf('<svg class="symbol-sprite"')),
  );
  // Comments talk about the rules, so measure the markup, not the prose.
  const spriteCode = spriteMarkup.replace(/<!--[\s\S]*?-->/g, ' ');

  suite.ok(
    'the artwork is drawn with gradients and shapes only \u2014 no SVG filters',
    !/<filter\b/.test(spriteCode) && !/\bfilter=/.test(spriteCode),
    'filter',
  );

  const rampsPerSymbol = SYMBOL_ORDER.map((id) => {
    const from = spriteCode.indexOf(`<symbol id="${symbolSpriteId(id)}"`);
    const body = spriteCode.slice(from, spriteCode.indexOf('</symbol>', from));
    return { id, ramps: new Set([...body.matchAll(/url\(#(sq\w+)\)/g)].map((m) => m[1])).size };
  });
  const flat = rampsPerSymbol.filter((s) => s.ramps < 2);
  suite.ok(
    'no symbol is flat: each one layers at least two of the shared ramps',
    flat.length === 0,
    flat.map((s) => `${s.id}: ${s.ramps}`).join(', '),
  );

  // Outlines are half a stroke thick either side of the geometry, so the ink a
  // symbol can spill is bounded by the widest stroke in the sprite. Keeping the
  // widest one thin is what makes that allowance negligible at cell size.
  const strokeWidths = [...spriteCode.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
  const widestStroke = strokeWidths.length ? Math.max(...strokeWidths) : 0;
  const ink = widestStroke / 2;
  suite.ok(
    'the widest stroke is thin enough that its overflow is sub-pixel in a cell',
    widestStroke <= 4,
    String(widestStroke),
  );
  suite.ok(
    'no path uses an arc, so the geometry walk below is exact',
    [...spriteCode.matchAll(/\sd="([^"]*)"/g)].every((m) => !/[Aa]/.test(m[1])),
    [...spriteCode.matchAll(/\sd="([^"]*)"/g)].filter((m) => /[Aa]/.test(m[1])).length,
  );

  /* ----------------------------------------------------------------------
     Artwork geometry: nothing may overflow the 64x64 artboard
     ---------------------------------------------------------------------- */
  const measured = [];
  {
    const { bounds } = spriteBounds(spriteMarkup);
    const overflow = [];
    const undersized = [];

    SYMBOL_ORDER.forEach((id) => {
      const box = bounds.get(symbolSpriteId(id));
      if (!box) {
        overflow.push(`${id}: not measured`);
        return;
      }
      const [minX, minY, maxX, maxY] = box.map((v) => Number(v.toFixed(2)));
      measured.push(`${id} ${(maxX - minX).toFixed(1)}\u00d7${(maxY - minY).toFixed(1)}`);
      if (minX - ink < 0 || minY - ink < 0 || maxX + ink > 64 || maxY + ink > 64) {
        overflow.push(`${id}: [${minX}, ${minY}, ${maxX}, ${maxY}] +${ink} ink`);
      }
      // Optical weight: a symbol that only fills a fraction of the artboard
      // would look like a smaller sticker next to all the others.
      if (maxX - minX < 36 || maxY - minY < 36) {
        undersized.push(`${id}: ${(maxX - minX).toFixed(1)}x${(maxY - minY).toFixed(1)}`);
      }
    });

    suite.ok(
      'every symbol stays inside its 64x64 artboard \u2014 nothing can clip',
      overflow.length === 0,
      overflow.join('; '),
    );
    suite.ok(
      'every symbol fills the artboard, so the set carries equal visual weight',
      undersized.length === 0,
      undersized.join('; '),
    );
  }

  /* ----------------------------------------------------------------------
     The artwork fits the cell
     ---------------------------------------------------------------------- */
  const artBlock = css.slice(
    css.indexOf('.reel-symbol__art {'),
    css.indexOf('\n}', css.indexOf('.reel-symbol__art {')),
  );
  const artSize = /--reel-symbol-size\)\s*\*\s*([\d.]+)\)/.exec(artBlock);
  const cellSize = /--reel-cell:\s*calc\(var\(--reel-symbol-size\)\s*\*\s*([\d.]+)\)/.exec(css);
  suite.ok(
    'the symbol art is drawn smaller than its cell, with room around it',
    Number(artSize?.[1] ?? 0) < Number(cellSize?.[1] ?? 0) && Number(artSize?.[1] ?? 0) > 0,
    `art ${artSize?.[1]}x vs cell ${cellSize?.[1]}x`,
  );

  suite.note(`${SYMBOL_ORDER.length} vector symbols \u00b7 artboard 64\u00d764 \u00b7 ${measured.join(' \u00b7 ')}`);
  suite.note(`lock beat ${REEL_TURN.phases.landingMs}ms \u00b7 widest stroke ${widestStroke} (${ink} units of ink)`);
}

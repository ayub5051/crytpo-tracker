/* ============================================================================
   SOQQA — symbol artwork helpers
   ----------------------------------------------------------------------------
   Every slot symbol is a premium vector `<symbol>` declared once in the sprite
   at the top of index.html, with the id `soqqa-sym-<symbol id>` (see SYMBOLS in
   js/config.js). Nothing here draws anything: this module owns the naming
   convention and the two ways the app consumes the artwork.

     1. The reels hold one fixed `<svg><use>` per cell, built once through
        `createSymbolCell()` and then never touched again. A drum moves by
        translating the whole strip, so a spin never writes to a cell at all —
        which is what makes "the symbol the engine drew is physically carried
        onto the payline" true by construction. See js/ui/reelPhysics.js for the
        strip layout and js/ui/reelView.js for the painting.

     2. Surfaces that build their rows in JS (the paytable, the history list and
        the cabinet legend) inline the same artwork through `symbolSvgMarkup()`.

   tests/wiring.test.mjs fails if a symbol in config has no matching `<symbol>`
   in the sprite, so the artwork can never drift away from the maths.
   ========================================================================= */

/** Prefix shared by every `<symbol>` in the index.html sprite. */
export const SYMBOL_SPRITE_PREFIX = 'soqqa-sym-';

/** @returns {string} the sprite element id for a symbol, without the hash. */
export function symbolSpriteId(id) {
  return `${SYMBOL_SPRITE_PREFIX}${id}`;
}

/** @returns {string} the `href` that points a `<use>` at a symbol's artwork. */
export function symbolHref(id) {
  return `#${symbolSpriteId(id)}`;
}

/**
 * Inline artwork for a symbol, for the surfaces that build their content in JS.
 * @param {string} id — symbol id from SYMBOLS
 * @param {string} [className] — class applied to the `<svg>` wrapper
 * @returns {string} SVG markup (never user input, so inlining it is safe)
 */
export function symbolSvgMarkup(id, className = 'symbol-art') {
  return (
    `<svg class="${className}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">` +
    `<use href="${symbolHref(id)}"></use></svg>`
  );
}

/**
 * One cell of a reel strip. Built once, when a strip is assembled — a strip's
 * cells are never re-created or re-painted afterwards, which is what lets the
 * drums scroll by transform alone.
 *
 * @param {Document} doc
 * @param {string} id — symbol id from SYMBOLS
 * @param {string} [className] — extra classes for the cell
 * @returns {HTMLElement}
 */
export function createSymbolCell(doc, id, className = '') {
  const cell = doc.createElement('span');
  cell.className = className ? `reel-symbol ${className}` : 'reel-symbol';
  // The id hook doubles as the strip's own record of what it is showing, and it
  // is why the tests can prove no symbol is ever swapped mid-spin.
  cell.dataset.symbol = id;
  // Deliberately no `data-symbol-use`: nothing retargets a cell any more. If a
  // spin ever had to rewrite this node, the continuous-strip guarantee would be
  // broken, so the absence of a hook is the point.
  cell.innerHTML = symbolSvgMarkup(id, 'reel-symbol__art');
  return cell;
}

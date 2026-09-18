/* ============================================================================
   SOQQA — chrome guards
   ----------------------------------------------------------------------------
   style.css states the intent once, on `*` (section 02): outside a real form
   control, nothing is selectable, nothing shows a caret, and nothing offers a
   text I-beam. That declaration is necessary but it is not sufficient — a
   selection drag can still be started in engines that resolve `user-select`
   through the user agent rather than from the declaration on the element, and a
   double- or triple-click never starts a selection drag at all.

   So the same rule is enforced at the event level too, which is the only place
   that is engine independent:

     • selectstart — cancels a selection drag the moment it begins
     • dragstart   — stops a text drag from starting at all
     • mousedown   — with detail > 1, kills the double-click word and
                     triple-click paragraph selections before they begin

   All three are capture-phase, so the app's own handlers still receive every
   event they care about afterwards, and all three step aside for anything
   genuinely editable — the same set the stylesheet opts back in.

   A single click is deliberately left alone: cancelling `mousedown` outright
   would also cancel the focus it performs, and would break keyboard flow.
   ========================================================================= */

/** Every control that stays natively editable. Mirrors the CSS opt-in. */
const EDITABLE_TAGS = new Set(['input', 'textarea', 'select']);

/**
 * Is this node, or anything above it, a real editable control?
 *
 * A property walk rather than `closest()`, so it cannot throw on a detached or
 * synthetic node and can be tested without a browser.
 *
 * @param {Node|null|undefined} node
 * @returns {boolean}
 */
export function isEditableTarget(node) {
  let el = node ?? null;
  while (el && el.nodeType !== 9) {
    if (el.nodeType === 1) {
      if (EDITABLE_TAGS.has(String(el.tagName ?? '').toLowerCase())) return true;
      // `contenteditable` and `contenteditable="true"` are both editable and
      // `contenteditable="false"` is not, which is exactly what this reports.
      if (el.isContentEditable === true) return true;
    }
    el = el.parentNode ?? el.parentElement ?? null;
  }
  return false;
}

/**
 * Installs the guards. Idempotent, and deliberately tolerant of a document
 * stub, because importing this module has to stay safe outside a browser.
 *
 * @param {Document} [doc]
 * @returns {boolean} true the first time it installs
 */
export function installChromeGuards(doc = typeof document === 'undefined' ? null : document) {
  if (!doc || typeof doc.addEventListener !== 'function' || !doc.documentElement) return false;
  const root = doc.documentElement;
  if (root.dataset && root.dataset.chromeGuarded === 'true') return false;
  if (root.dataset) root.dataset.chromeGuarded = 'true';

  const blockSelection = (event) => {
    if (!isEditableTarget(event.target)) event.preventDefault();
  };
  const blockWordSelect = (event) => {
    if (event.detail > 1 && !isEditableTarget(event.target)) event.preventDefault();
  };

  doc.addEventListener('selectstart', blockSelection, true);
  doc.addEventListener('dragstart', blockSelection, true);
  doc.addEventListener('mousedown', blockWordSelect, true);
  return true;
}

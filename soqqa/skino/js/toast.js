/* ============================================================================
   SKINO — toast notifications
   Small, self-dismissing messages used for purchases and mini-game results.
   ========================================================================= */

let stack = null;

function ensureStack() {
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.append(stack);
  }
  return stack;
}

/**
 * @param {string} message
 * @param {'info'|'success'|'error'} [variant]
 */
export function showToast(message, variant = 'info', duration = 3200) {
  const el = document.createElement('div');
  el.className = `toast toast-${variant}`;
  el.textContent = message;
  ensureStack().append(el);

  requestAnimationFrame(() => el.classList.add('is-in'));

  window.setTimeout(() => {
    el.classList.remove('is-in');
    window.setTimeout(() => el.remove(), 320);
  }, duration);
}

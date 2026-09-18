/* ============================================================================
   SOQQA — toast notifications
   Small, dependency-free status messages (storage recovery, insufficient
   balance, cleared history, big wins).
   ========================================================================= */

const ICONS = Object.freeze({
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✕',
  win: '★',
});

/**
 * @param {HTMLElement|null} root — container (uses #toast-root by default)
 */
export function createToaster(root = null) {
  const container = root ?? (typeof document !== 'undefined' ? document.querySelector('#toast-root') : null);
  const active = new Set();

  function dismiss(element) {
    if (!element || !active.has(element)) return;
    active.delete(element);
    element.classList.add('toast--leaving');
    const remove = () => element.remove();
    element.addEventListener('transitionend', remove, { once: true });
    // Safety net if transitions never fire (hidden tab / reduced motion).
    setTimeout(remove, 400);
  }

  return {
    /**
     * @param {string} message — Uzbek copy
     * @param {{ kind?: 'info'|'success'|'warning'|'error'|'win', duration?: number }} [options]
     */
    show(message, { kind = 'info', duration = 4200 } = {}) {
      if (!container || !message) return null;

      const toast = document.createElement('div');
      toast.className = `toast toast--${kind}`;
      toast.setAttribute('role', kind === 'error' || kind === 'warning' ? 'alert' : 'status');

      const icon = document.createElement('span');
      icon.className = 'toast__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = ICONS[kind] ?? ICONS.info;

      const text = document.createElement('span');
      text.className = 'toast__text';
      text.textContent = message;

      toast.append(icon, text);
      container.append(toast);
      active.add(toast);

      // Keep at most the three newest toasts on screen.
      while (active.size > 3) dismiss(active.values().next().value);

      setTimeout(() => dismiss(toast), duration);
      return toast;
    },

    dismiss,
    clear() {
      [...active].forEach(dismiss);
    },
  };
}

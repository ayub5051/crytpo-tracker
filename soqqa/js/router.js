/* ============================================================================
   SOQQA — hash router
   Routes:  #/  |  #/slots  |  #/wheel  |  #/history
   Toggles the view sections (hidden + aria-hidden) and keeps the nav in sync.
   ========================================================================= */

const DEFAULT_ROUTE = '/';

export function createRouter({ defaultRoute = DEFAULT_ROUTE } = {}) {
  const views = Array.from(document.querySelectorAll('[data-view]'));
  const navLinks = Array.from(document.querySelectorAll('[data-route]'));

  /** "#/slots//" → "/slots"; "" → "/" */
  function normalize(hash) {
    const path = String(hash ?? '').replace(/^#/, '').replace(/\/+$/, '');
    if (!path) return defaultRoute;
    return path.startsWith('/') ? path : `/${path}`;
  }

  function isKnown(route) {
    return views.some((view) => view.dataset.view === route);
  }

  /** Unknown hashes fall back to the landing view instead of showing nothing. */
  function resolve() {
    const route = normalize(window.location.hash);
    return isKnown(route) ? route : defaultRoute;
  }

  function render() {
    const route = resolve();

    views.forEach((view) => {
      const active = view.dataset.view === route;
      view.hidden = !active;
      view.setAttribute('aria-hidden', String(!active));
    });

    navLinks.forEach((link) => {
      const active = link.dataset.route === route;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    if (document.body) {
      document.body.dataset.route = route === defaultRoute ? 'home' : route.slice(1);
    }

    const reducedMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });

    return route;
  }

  return {
    start() {
      window.addEventListener('hashchange', render);
      return render();
    },
    go(route) {
      window.location.hash = `#${route}`;
    },
    current: resolve,
  };
}

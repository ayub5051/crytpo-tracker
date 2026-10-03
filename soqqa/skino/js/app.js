/* ============================================================================
   SKINO — app shell
   Navigation between Market and Inventory, plus mock market rendering.
   No filters, purchase logic or detail views yet.
   ========================================================================= */

import { SKINS, renderMarket } from './skins.js';

const VIEWS = ['market', 'inventory'];
const TRANSITION_MS = 500;

const views = new Map(
  VIEWS.map((name) => [name, document.querySelector(`[data-view="${name}"]`)])
);

const triggers = Array.from(document.querySelectorAll('[data-view-target]'));
const navLinks = Array.from(document.querySelectorAll('.primary-nav .nav-link'));
const indicator = document.querySelector('.nav-indicator');
const header = document.getElementById('siteHeader');

let current = 'market';
let switching = false;

/* ---------------------------------------------------------------- helpers */

function positionIndicator(link) {
  if (!indicator || !link) return;
  indicator.style.width = `${link.offsetWidth}px`;
  indicator.style.transform = `translateX(${link.offsetLeft - 4}px)`;
}

function syncTriggers(target) {
  navLinks.forEach((link) => {
    const active = link.dataset.viewTarget === target;
    link.classList.toggle('is-active', active);
    link.setAttribute('aria-selected', String(active));
  });
  positionIndicator(navLinks.find((l) => l.dataset.viewTarget === target));
}

/* -------------------------------------------------------- view switching */

function switchView(target) {
  if (target === current || switching || !views.has(target)) return;

  const outgoing = views.get(current);
  const incoming = views.get(target);
  if (!outgoing || !incoming) return;

  switching = true;
  current = target;
  syncTriggers(target);

  // Fade the outgoing view out, then reveal the incoming one. The incoming
  // element replays its CSS rise animation because it was display:none.
  outgoing.style.animation = 'none';
  outgoing.style.transition = `opacity ${TRANSITION_MS}ms var(--ease), transform ${TRANSITION_MS}ms var(--ease)`;
  outgoing.style.opacity = '0';
  outgoing.style.transform = 'translateY(10px)';

  window.setTimeout(() => {
    outgoing.hidden = true;
    outgoing.removeAttribute('style');

    incoming.hidden = false;
    incoming.style.opacity = '0';
    // Force a reflow so the transition below actually runs.
    void incoming.offsetWidth;
    incoming.style.transition = `opacity ${TRANSITION_MS}ms var(--ease), transform ${TRANSITION_MS}ms var(--ease)`;
    incoming.style.opacity = '1';
    incoming.style.transform = 'translateY(0)';

    window.setTimeout(() => {
      incoming.removeAttribute('style');
      switching = false;
    }, TRANSITION_MS);
  }, TRANSITION_MS);
}

/* ---------------------------------------------------------------- events */

triggers.forEach((el) => {
  el.addEventListener('click', () => switchView(el.dataset.viewTarget));
});

window.addEventListener('resize', () => {
  const active = navLinks.find((l) => l.dataset.viewTarget === current);
  positionIndicator(active);
});

window.addEventListener(
  'scroll',
  () => header?.classList.toggle('is-scrolled', window.scrollY > 8),
  { passive: true }
);

// Fonts load after first paint, which shifts nav widths — reposition once ready.
if (document.fonts?.ready) {
  document.fonts.ready.then(() => {
    positionIndicator(navLinks.find((l) => l.dataset.viewTarget === current));
  });
}

/* ------------------------------------------------------- market rendering */

const marketGrid = document.querySelector('[data-market-grid]');
const marketCount = document.querySelector('[data-market-count]');

renderMarket(marketGrid, SKINS);

if (marketCount) {
  marketCount.textContent = `${SKINS.length} listings`;
}

syncTriggers(current);

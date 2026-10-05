/* ============================================================================
   SKINO — app shell
   View navigation (Market / Inventory / Games), the Crystal balance readout,
   market rendering, the inventory view, the skin detail modal and the Wheel.
   ========================================================================= */

import { getSkinById } from './skins.js';
import { getCrystals, formatCrystals, onCrystalsChange } from './crystals.js';
import { openSkinModal } from './skinModal.js';
import { initMarketFilters } from './marketFilters.js';
import { initInventoryView } from './inventoryView.js';
import { initWheel } from './wheel.js';

const VIEWS = ['market', 'inventory', 'games'];
const TRANSITION_MS = 500;

const views = new Map(
  VIEWS.map((name) => [name, document.querySelector(`[data-view="${name}"]`)])
);

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

// Delegated so triggers created later (empty states, etc.) still work.
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-view-target]');
  if (trigger) switchView(trigger.dataset.viewTarget);
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

/* --------------------------------------------------------- Crystal balance */

const balanceEl = document.querySelector('[data-balance]');

function renderBalance(value = getCrystals()) {
  if (balanceEl) balanceEl.textContent = formatCrystals(value);
}

renderBalance();
onCrystalsChange(renderBalance);

/* ------------------------------------------ market, inventory & mini-games */

const marketGrid = document.querySelector('[data-market-grid]');

initMarketFilters();
initInventoryView();
initWheel();

/* Clicking a card (or activating it with the keyboard) opens the detail modal. */
function cardSkin(event) {
  const card = event.target.closest('.skin-card');
  return card ? getSkinById(card.dataset.skinId) : null;
}

marketGrid?.addEventListener('click', (event) => {
  const skin = cardSkin(event);
  if (skin) openSkinModal(skin);
});

marketGrid?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const skin = cardSkin(event);
  if (!skin) return;
  event.preventDefault();
  openSkinModal(skin);
});

syncTriggers(current);

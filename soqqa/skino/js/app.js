/* ============================================================================
   BLAZZER — app shell
   View navigation (Market / Inventory / Games / History), the animated Crystal
   balance readout, market rendering, the inventory view, the skin detail modal,
   the Wheel, Mines and Mystery Case mini-games, the Crystal rewards dialog and
   the transaction history.
   ========================================================================= */

// Runs the one-time LocalStorage key migration before any module reads a key.
import './storage.js';
import { getCrystals, formatCrystals, onCrystalsChange } from './crystals.js';
import { hydrateCrystalIcons } from './icons.js';
import { initMarketplace } from './marketplace.js';
import { initTrade } from './trade.js';
import { initInventoryView } from './inventoryView.js';
import { initWheel } from './wheel.js';
import { initMines } from './mines.js';
import { initMysteryCase } from './mysteryCase.js';
import { initUpgrade } from './upgrade.js';
import { initRewards } from './rewards.js';
import { initHistoryView } from './historyView.js';
import { initLiveFeed } from './live-feed.js';
import { initFair } from './fair-ui.js';
import { initPromoSlider } from './promo-slider.js';

const VIEWS = ['market', 'inventory', 'games', 'history'];
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
/* The balance counts up (never snaps) and scale-pulses on every change, so a
   win reads as the number physically climbing — the t=0.25s layer of the win
   choreography in js/celebration.js. Reduced motion snaps straight to the new
   value with no pulse. */

const balanceEl = document.querySelector('[data-balance]');
const balanceBox = balanceEl?.closest('.balance');
const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const BALANCE_COUNT_MS = 800;
const BALANCE_SPEND_MS = 400; // spends are snappy; wins hold the beat
const BALANCE_WIN_DELAY = 200; // wins land the count at ~t=0.25s of the celebration
let shownBalance = getCrystals();
let balanceRaf = 0;
let balanceDelay = 0;
let balanceGlowTimer = 0;

function paintBalance(value) {
  if (balanceEl) balanceEl.textContent = formatCrystals(Math.round(value));
}

/**
 * Count the shown balance → `to` with an ease-out curve, pulsing. A rise takes
 * ~0.8s (a win); a fall takes ~0.4s and dims the gem to read as a spend.
 */
function countBalance(to, duration = BALANCE_COUNT_MS, spend = false) {
  const from = shownBalance;
  const t0 = performance.now();

  // Restart the pulse for each change, picking the rise or spend treatment.
  balanceBox?.classList.remove('is-counting', 'is-spending');
  void balanceBox?.offsetWidth;
  balanceBox?.classList.add(spend ? 'is-spending' : 'is-counting');

  const step = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
    paintBalance(from + (to - from) * eased);
    if (p < 1) {
      balanceRaf = requestAnimationFrame(step);
    } else {
      shownBalance = to;
      paintBalance(to);
    }
  };
  balanceRaf = requestAnimationFrame(step);

  window.clearTimeout(balanceGlowTimer);
  balanceGlowTimer = window.setTimeout(
    () => balanceBox?.classList.remove('is-counting', 'is-spending'),
    duration + 120
  );
}

function renderBalance(value = getCrystals(), { animate = true } = {}) {
  if (!balanceEl) return;
  const target = Math.max(0, Math.round(value));
  window.cancelAnimationFrame(balanceRaf);
  window.clearTimeout(balanceDelay);

  if (!animate || reducedMotion || target === shownBalance) {
    paintBalance(target);
    shownBalance = target;
    return;
  }

  // A rise is a win: hold the count a beat so it lands inside the celebration
  // timeline. A fall (spending) is snappy and immediate.
  if (target > shownBalance) {
    balanceDelay = window.setTimeout(() => countBalance(target), BALANCE_WIN_DELAY);
  } else {
    // A spend: quick count-down with the dimmed-gem treatment.
    countBalance(target, BALANCE_SPEND_MS, true);
  }
}

hydrateCrystalIcons();
renderBalance(getCrystals(), { animate: false });
onCrystalsChange(renderBalance);

/* ------------------------------------------ market, inventory & mini-games */

initMarketplace();
initInventoryView();
// Trading is route-driven (/trade/:id); it mounts only when the URL asks for it.
initTrade();
initWheel();
initMines();
initMysteryCase();
initRewards();
initHistoryView();
// Live feed is best-effort: a missing server must never break the app.
initLiveFeed().catch((err) => console.warn('[live-feed] init failed:', err));
initFair();
// Upgrade settles through the fair pipeline, so it mounts after initFair().
initUpgrade();
initPromoSlider();

syncTriggers(current);

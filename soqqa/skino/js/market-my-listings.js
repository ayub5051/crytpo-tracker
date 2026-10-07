/* ============================================================================
   BLAZZER — my listings (Stage 3.2)
   A panel inside the Market view showing the current user's own active
   listings, each with a live expiry countdown and Cancel / Edit price actions.
   It re-renders whenever the market or the inventory changes, so a purchase or
   a cancellation is reflected immediately.
   ========================================================================= */

import { getSkinById } from './skins.js';
import { formatCrystals } from './crystals.js';
import { crystalIcon, hydrateCrystalIcons } from './icons.js';
import { showToast } from './toast.js';
import { myListings, cancelListing } from './marketplace.js';
import { openEditModal } from './market-sell.js';

let panel = null;
let toggle = null;
let countEl = null;
let open = false;
let tick = 0;

const money = (v) => `${formatCrystals(v)} ${crystalIcon(13)}`;

function endsLabel(expiresAt) {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'Ended';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 24) return `Ends in ${Math.round(h / 24)}d`;
  if (h >= 1) return `Ends in ${h}h`;
  return `Ends in ${Math.max(1, Math.round(ms / 60_000))}m`;
}

function card(listing) {
  const skin = getSkinById(listing.catalogueId);
  const el = document.createElement('article');
  el.className = 'mine-card';
  el.dataset.listingId = listing.id;
  el.innerHTML = `
    <span class="mine-thumb">${
      skin?.image ? `<img src="${skin.image}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<span class="mine-glyph">${crystalIcon(28)}</span>`
    }</span>
    <span class="mine-meta">
      <span class="mine-name"></span>
      <span class="mine-sub"></span>
      <span class="mine-ends" data-mine-ends>${endsLabel(listing.expiresAt)}</span>
    </span>
    <span class="mine-price">${money(listing.price)}</span>
    <span class="mine-actions">
      <button class="mf-chip" type="button" data-mine-edit>Edit price</button>
      <button class="mf-chip" type="button" data-mine-cancel>Cancel listing</button>
    </span>`;
  el.querySelector('.mine-name').textContent = `${listing.weapon} | ${listing.finish}`;
  el.querySelector('.mine-sub').textContent = `${listing.condition} · you receive ${formatCrystals(listing.payout)} ◆`;
  return el;
}

function render() {
  if (!panel) return;
  const rows = myListings();
  if (countEl) {
    countEl.hidden = rows.length === 0;
    countEl.textContent = String(rows.length);
  }
  if (!rows.length) {
    panel.innerHTML =
      '<div class="mine-empty">' +
      '<p class="empty-title">You have no active listings</p>' +
      '<p class="empty-copy">Sell something from your inventory.</p>' +
      '<button class="btn btn-ghost" type="button" data-view-target="inventory">Open inventory</button>' +
      '</div>';
    return;
  }
  panel.replaceChildren(...rows.map(card));
  hydrateCrystalIcons(panel);
}

export function refreshMyListings() {
  if (open) render();
  else if (countEl) {
    const n = myListings().length;
    countEl.hidden = n === 0;
    countEl.textContent = String(n);
  }
}

function setOpen(next) {
  open = next;
  if (!panel || !toggle) return;
  panel.hidden = !open;
  panel.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.classList.toggle('is-active', open);
  if (open) {
    render();
    window.clearInterval(tick);
    // Refresh the countdowns once a minute while the panel is open.
    tick = window.setInterval(render, 30_000);
  } else {
    window.clearInterval(tick);
    tick = 0;
  }
}

export function initMyListings() {
  panel = document.querySelector('[data-market-my-listings]');
  toggle = document.querySelector('[data-market-mine-toggle]');
  countEl = document.querySelector('[data-market-mine-count]');
  if (!panel || !toggle) return;

  toggle.addEventListener('click', () => setOpen(!open));

  panel.addEventListener('click', (event) => {
    const el = event.target.closest('.mine-card');
    if (!el) return;
    const listing = myListings().find((l) => l.id === el.dataset.listingId);
    if (!listing) return;
    if (event.target.closest('[data-mine-edit]')) openEditModal(listing);
    else if (event.target.closest('[data-mine-cancel]')) {
      try {
        cancelListing(listing.id);
        showToast('Listing cancelled — the item is back in your inventory', 'info');
      } catch (err) {
        showToast(err.message || 'Could not cancel that listing', 'error');
      }
    }
  });

  refreshMyListings();
}

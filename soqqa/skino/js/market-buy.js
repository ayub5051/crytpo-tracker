/* ============================================================================
   BLAZZER — market buy flow (Stage 3.2)
   Clicking a listing opens the detail modal; "Buy" opens a confirmation that
   spells out the price and the balance after. Confirming settles locally and
   instantly (the item lands in the inventory and the balance ticks down), with
   the shared purchase celebration as the reward. Any failure surfaces as a
   toast and leaves no partial state.
   ========================================================================= */

import { getSkinById, RARITIES } from './skins.js';
import { getCrystals, formatCrystals } from './crystals.js';
import { getListing, buyListing } from './marketplace.js';
import { crystalIcon, hydrateCrystalIcons } from './icons.js';
import { showToast } from './toast.js';
import { celebratePurchase } from './purchase.js';

let detail = null;
let confirm = null;
let currentId = null;
let lastFocused = null;

function money(value) {
  return `${formatCrystals(value)} ${crystalIcon(14)}`;
}

/* ------------------------------------------------------------------ detail */

function ensureDetail() {
  if (detail) return detail;
  detail = document.createElement('div');
  detail.className = 'market-modal';
  detail.innerHTML = `
    <div class="market-backdrop" data-buy-close></div>
    <div class="market-dialog" role="dialog" aria-modal="true" aria-labelledby="marketBuyTitle">
      <button class="market-modal-close" type="button" data-buy-close aria-label="Close">✕</button>
      <div class="market-media" data-buy-media>
        <span class="market-media-bar" aria-hidden="true"></span>
        <img class="market-media-img" alt="" />
        <span class="market-media-glyph" aria-hidden="true">${crystalIcon(56)}</span>
        <span class="market-stattrak" data-buy-stat hidden>StatTrak™</span>
      </div>
      <div class="market-body">
        <p class="market-rarity" data-buy-rarity></p>
        <h2 class="market-title" id="marketBuyTitle" data-buy-title></h2>
        <p class="market-cond" data-buy-cond></p>
        <dl class="market-meta">
          <div><dt>Weapon</dt><dd data-buy-weapon></dd></div>
          <div><dt>Wear</dt><dd data-buy-wear></dd></div>
          <div><dt>Float</dt><dd data-buy-float></dd></div>
          <div><dt>Seller</dt><dd data-buy-seller></dd></div>
          <div><dt>Ends</dt><dd data-buy-ends></dd></div>
        </dl>
        <div class="market-seller-card" data-buy-seller-card></div>
        <button class="market-proof" type="button" data-buy-proof>How it was obtained →</button>
        <p class="market-history" data-buy-history></p>
        <div class="market-price-row">
          <span class="market-price-label">Price</span>
          <span class="market-price" data-buy-price></span>
        </div>
        <div class="market-actions">
          <button class="btn btn-ghost" type="button" data-buy-close>Cancel</button>
          <button class="btn btn-primary market-buy-cta" type="button" data-buy-start>Buy</button>
        </div>
      </div>
    </div>`;
  detail.addEventListener('click', (event) => {
    if (event.target.closest('[data-buy-close]')) return closeBuy();
    if (event.target.closest('[data-buy-proof]')) return openProof();
    if (event.target.closest('[data-buy-start]')) return openConfirm(currentId);
    return undefined;
  });
  document.body.append(detail);
  return detail;
}

export function openBuyModal(id) {
  const listing = getListing(id);
  if (!listing) {
    showToast('That listing is no longer available', 'error');
    return;
  }
  const skin = getSkinById(listing.catalogueId);
  currentId = id;
  const modal = ensureDetail();

  const media = modal.querySelector('[data-buy-media]');
  media.classList.remove('is-fallback');
  const img = modal.querySelector('.market-media-img');
  if (skin?.image) {
    img.src = skin.image;
    img.alt = `${listing.weapon} | ${listing.finish}`;
    img.onerror = () => media.classList.add('is-fallback');
    img.hidden = false;
  } else {
    img.hidden = true;
    media.classList.add('is-fallback');
  }

  modal.style.setProperty('--rarity', RARITIES[listing.rarity] ?? RARITIES.Consumer);
  modal.querySelector('[data-buy-rarity]').textContent = listing.rarity;
  modal.querySelector('[data-buy-title]').textContent = `${listing.weapon} | ${listing.finish}`;
  modal.querySelector('[data-buy-cond]').textContent = listing.condition;
  modal.querySelector('[data-buy-weapon]').textContent = listing.weapon;
  modal.querySelector('[data-buy-wear]').textContent = listing.condition;
  modal.querySelector('[data-buy-float]').textContent = Number.isFinite(listing.floatValue)
    ? listing.floatValue.toFixed(6)
    : '—';
  modal.querySelector('[data-buy-stat]').hidden = !listing.stattrak;
  modal.querySelector('[data-buy-seller]').textContent = listing.seller.name;
  modal.querySelector('[data-buy-ends]').textContent = endsLabel(listing.expiresAt);
  modal.querySelector('[data-buy-price]').innerHTML = money(listing.price);
  modal.querySelector('[data-buy-history]').textContent = listing.stickers?.length
    ? `${listing.stickers.length} sticker(s) applied`
    : 'No previous owners recorded.';
  hydrateCrystalIcons(modal);

  lastFocused = document.activeElement;
  modal.classList.add('is-open');
  document.body.classList.add('modal-open');
  modal.querySelector('.market-buy-cta')?.focus();
}

export function closeBuy() {
  if (!detail) return;
  detail.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  currentId = null;
  if (lastFocused instanceof HTMLElement) lastFocused.focus();
}

function openProof() {
  if (window.BLAZZER_FAIR?.open) window.BLAZZER_FAIR.open();
  else showToast('Provably-fair panel is unavailable', 'info');
}

/* ----------------------------------------------------------------- confirm */

function ensureConfirm() {
  if (confirm) return confirm;
  confirm = document.createElement('div');
  confirm.className = 'market-modal';
  confirm.innerHTML = `
    <div class="market-backdrop" data-confirm-close></div>
    <div class="market-dialog market-dialog-sm" role="dialog" aria-modal="true" aria-labelledby="marketConfirmTitle">
      <h2 class="market-title" id="marketConfirmTitle">Confirm purchase</h2>
      <p class="market-cond" data-confirm-item></p>
      <dl class="market-meta">
        <div><dt>Price</dt><dd data-confirm-price></dd></div>
        <div><dt>Balance after</dt><dd data-confirm-after></dd></div>
      </dl>
      <div class="market-actions">
        <button class="btn btn-ghost" type="button" data-confirm-close>Cancel</button>
        <button class="btn btn-primary" type="button" data-confirm-ok>Confirm</button>
      </div>
    </div>`;
  confirm.addEventListener('click', (event) => {
    if (event.target.closest('[data-confirm-close]')) return closeConfirm();
    if (event.target.closest('[data-confirm-ok]')) return runPurchase();
    return undefined;
  });
  document.body.append(confirm);
  return confirm;
}

function openConfirm(id) {
  const listing = getListing(id);
  if (!listing) {
    closeBuy();
    showToast('That listing is no longer available', 'error');
    return;
  }
  currentId = id;
  const modal = ensureConfirm();
  modal.querySelector('[data-confirm-item]').textContent = `${listing.weapon} | ${listing.finish} · ${listing.condition}`;
  modal.querySelector('[data-confirm-price]').innerHTML = money(listing.price);
  modal.querySelector('[data-confirm-after]').innerHTML = money(Math.max(0, getCrystals() - listing.price));
  hydrateCrystalIcons(modal);

  modal.classList.add('is-open');
  document.body.classList.add('modal-open');
  modal.querySelector('[data-confirm-ok]')?.focus();
}

function closeConfirm() {
  if (!confirm) return;
  confirm.classList.remove('is-open');
  if (!detail?.classList.contains('is-open')) document.body.classList.remove('modal-open');
}

function runPurchase() {
  const id = currentId;
  const listing = getListing(id);
  if (!listing) {
    closeConfirm();
    closeBuy();
    showToast('That listing is no longer available', 'error');
    return;
  }
  const origin = detail?.querySelector('[data-buy-media]') || null;
  try {
    buyListing(id);
  } catch (err) {
    showToast(err.message || 'Purchase failed', 'error');
    return;
  }
  // Celebrate while the item is still on screen: the sweep is painted inside
  // `origin` and the fly-clone starts from its box, so closing the detail modal
  // first would hide both. onSettled dismisses it at t = 1.10s, once every node
  // and timer is gone. celebratePurchase() decides for itself what runs under
  // prefers-reduced-motion — badge + balance tick only, no sweep, no fly — so
  // it must never be skipped here.
  closeConfirm();
  celebratePurchase({ origin, onSettled: closeBuy });
  showToast(`Purchased ${listing.weapon} | ${listing.finish}`, 'success');
}

/* ---------------------------------------------------------------- helpers */

function endsLabel(expiresAt) {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'Ended';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 24) return `${Math.round(h / 24)}d`;
  if (h >= 1) return `${h}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (confirm?.classList.contains('is-open')) closeConfirm();
  else if (detail?.classList.contains('is-open')) closeBuy();
});

/* ============================================================================
   BLAZZER — market sell flow (Stage 3.2)
   From the inventory (or from My listings, to re-price), the owner picks a
   price with the help of a suggested band, chooses how long the listing runs,
   and sees exactly what they will take home after the 7% commission. The item
   is flagged as listed so the inventory card shows "Listed" immediately.
   ========================================================================= */

import { getSkinById } from './skins.js';
import { getItem } from './inventory.js';
import { formatCrystals } from './crystals.js';
import { crystalIcon, hydrateCrystalIcons } from './icons.js';
import { showToast } from './toast.js';
import {
  LISTING_DURATIONS,
  DEFAULT_DURATION,
  listItem,
  editListing,
  suggestPrice,
  payoutOf,
} from './marketplace.js';

let modal = null;
let mode = 'list'; // 'list' | 'edit'
let targetUid = null;
let targetListing = null;
// A literal here, not DEFAULT_DURATION: this module sits inside an import cycle
// (marketplace -> my-listings -> sell -> marketplace), so reading the binding at
// module-evaluation time would hit the temporal dead zone. It is set properly
// when a modal opens.
let duration = '24h';
let lastFocused = null;

const money = (v) => `${formatCrystals(v)} ${crystalIcon(13)}`;

function ensureModal() {
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'market-modal';
  modal.innerHTML = `
    <div class="market-backdrop" data-sell-close></div>
    <div class="market-dialog market-dialog-sm" role="dialog" aria-modal="true" aria-labelledby="marketSellTitle">
      <button class="market-modal-close" type="button" data-sell-close aria-label="Close">✕</button>
      <div class="sell-preview">
        <span class="sell-preview-thumb"><img alt="" /><span class="sell-preview-glyph">${crystalIcon(34)}</span></span>
        <span class="sell-preview-meta">
          <span class="sell-preview-name" id="marketSellTitle"></span>
          <span class="sell-preview-cond"></span>
        </span>
      </div>

      <div class="sell-price">
        <label class="sell-price-field">
          <span class="sell-price-currency">${crystalIcon(18)}</span>
          <input type="number" inputmode="numeric" min="1" step="1" data-sell-price aria-label="Listing price in Crystals" />
        </label>
        <p class="sell-suggest" data-sell-suggest></p>
        <div class="sell-quick">
          <button class="mf-chip" type="button" data-sell-adjust="-10">−10%</button>
          <button class="mf-chip" type="button" data-sell-adjust="-5">−5%</button>
          <button class="mf-chip" type="button" data-sell-adjust="0">Suggested</button>
          <button class="mf-chip" type="button" data-sell-adjust="5">+5%</button>
          <button class="mf-chip" type="button" data-sell-adjust="10">+10%</button>
        </div>
      </div>

      <div class="sell-duration" data-sell-duration role="group" aria-label="Listing duration"></div>

      <div class="sell-fee">
        <p data-sell-fee></p>
        <p class="sell-fee-note" data-sell-buyer></p>
      </div>

      <div class="market-actions">
        <button class="btn btn-ghost" type="button" data-sell-close>Cancel</button>
        <button class="btn btn-primary" type="button" data-sell-confirm>List for sale</button>
      </div>
    </div>`;

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-sell-close]')) return closeSellModal();
    const adjust = event.target.closest('[data-sell-adjust]');
    if (adjust) return adjustPrice(Number(adjust.dataset.sellAdjust));
    const pill = event.target.closest('[data-sell-pill]');
    if (pill) return setDuration(pill.dataset.sellPill);
    if (event.target.closest('[data-sell-confirm]')) return confirmSell();
    return undefined;
  });
  modal.querySelector('[data-sell-price]').addEventListener('input', refreshFee);

  // Duration pills are built once.
  const wrap = modal.querySelector('[data-sell-duration]');
  LISTING_DURATIONS.forEach((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sell-pill';
    b.dataset.sellPill = d.id;
    b.textContent = d.label;
    b.title = d.id === '24h' ? 'Recommended' : '';
    wrap.append(b);
  });

  document.body.append(modal);
  return modal;
}

function suggestedFor(catalogueId) {
  const base = suggestPrice(catalogueId);
  return base;
}

function setPrice(value) {
  const input = modal.querySelector('[data-sell-price]');
  input.value = String(Math.max(1, Math.round(value)));
  refreshFee();
}

function adjustPrice(pct) {
  const band = mode === 'edit' ? null : suggestedFor(priceSkinId());
  const base = band ? band.suggested : Number(modal.querySelector('[data-sell-price]').value) || 1;
  setPrice(Math.round(base * (1 + pct / 100)));
}

function setDuration(id) {
  duration = id;
  modal.querySelectorAll('[data-sell-pill]').forEach((b) => {
    const on = b.dataset.sellPill === id;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function refreshFee() {
  const price = Math.max(1, Math.round(Number(modal.querySelector('[data-sell-price]').value) || 1));
  modal.querySelector('[data-sell-fee]').innerHTML = `You'll receive <strong>${money(payoutOf(price))}</strong> after 7% fee`;
  modal.querySelector('[data-sell-buyer]').textContent = `Buyer pays ${money(price)}`;
}

function priceSkinId() {
  if (mode === 'edit') return targetListing?.catalogueId;
  const item = getItem(targetUid);
  return item?.id;
}

/* ------------------------------------------------------------------- open */

export function openSellModal(uid) {
  const item = getItem(uid);
  const skin = item && getSkinById(item.id);
  if (!item || !skin) {
    showToast('That item is unavailable', 'error');
    return;
  }
  mode = 'list';
  targetUid = uid;
  targetListing = null;
  duration = DEFAULT_DURATION;

  const el = ensureModal();
  el.querySelector('.sell-preview-name').textContent = `${skin.weapon} | ${skin.finish}`;
  el.querySelector('.sell-preview-cond').textContent = `${skin.condition} · ${skin.rarity}`;
  const img = el.querySelector('.sell-preview-thumb img');
  img.src = skin.image;
  img.alt = `${skin.weapon} | ${skin.finish}`;
  img.onerror = () => el.querySelector('.sell-preview-thumb').classList.add('is-fallback');
  el.querySelector('.sell-preview-thumb').classList.remove('is-fallback');
  el.querySelector('[data-sell-confirm]').textContent = 'List for sale';

  const band = suggestedFor(skin.id);
  el.querySelector('[data-sell-suggest]').textContent = band.samples
    ? `Similar items sold for ${formatCrystals(band.low)} – ${formatCrystals(band.high)} ◆`
    : `Suggested price: ${formatCrystals(band.suggested)} ◆`;
  setPrice(band.suggested);
  setDuration(duration);

  lastFocused = document.activeElement;
  el.classList.add('is-open');
  document.body.classList.add('modal-open');
  hydrateCrystalIcons(el);
  el.querySelector('[data-sell-price]')?.focus();
}

export function openEditModal(listing) {
  if (!listing) return;
  mode = 'edit';
  targetListing = listing;
  targetUid = null;
  duration = DEFAULT_DURATION;

  const el = ensureModal();
  el.querySelector('.sell-preview-name').textContent = `${listing.weapon} | ${listing.finish}`;
  el.querySelector('.sell-preview-cond').textContent = `${listing.condition} · ${listing.rarity}`;
  const img = el.querySelector('.sell-preview-thumb img');
  const skin = getSkinById(listing.catalogueId);
  if (skin?.image) {
    img.src = skin.image;
    img.alt = `${listing.weapon} | ${listing.finish}`;
    img.hidden = false;
  } else {
    img.hidden = true;
  }
  el.querySelector('[data-sell-suggest]').textContent = 'Update your asking price.';
  el.querySelector('[data-sell-confirm]').textContent = 'Save price';
  setPrice(listing.price);
  setDuration(duration);

  lastFocused = document.activeElement;
  el.classList.add('is-open');
  document.body.classList.add('modal-open');
  hydrateCrystalIcons(el);
  el.querySelector('[data-sell-price]')?.focus();
}

export function closeSellModal() {
  if (!modal) return;
  modal.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  if (lastFocused instanceof HTMLElement) lastFocused.focus();
}

function popListedBadge() {
  const el = document.createElement('div');
  el.className = 'listed-badge';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span class="listed-badge-mark" aria-hidden="true">✓</span><span>Listed!</span>';
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  window.setTimeout(() => {
    el.classList.remove('is-in');
    window.setTimeout(() => el.remove(), 320);
  }, 900);
}

function confirmSell() {
  const price = Math.max(1, Math.round(Number(modal.querySelector('[data-sell-price]').value) || 0));
  try {
    if (mode === 'edit') {
      const updated = editListing(targetListing.id, price);
      showToast(`Price updated to ${formatCrystals(updated.price)} ◆`, 'success');
    } else {
      const listing = listItem({ uid: targetUid, price, duration });
      showToast(`Listed! You'll earn ${formatCrystals(listing.payout)} ◆ when sold`, 'success');
      popListedBadge();
    }
  } catch (err) {
    showToast(err.message || 'Could not list that item', 'error');
    return;
  }
  closeSellModal();
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modal?.classList.contains('is-open')) closeSellModal();
});

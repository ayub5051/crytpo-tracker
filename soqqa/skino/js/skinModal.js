/* ============================================================================
   BLAZZER — skin detail modal
   A single reusable dialog that shows the full record for a skin: large image,
   name, condition, rarity, description and price. Built lazily so the page
   markup stays clean.
   ========================================================================= */

import { RARITIES, formatPrice, sellPrice } from './skins.js';
import {
  addToInventory,
  removeFromInventory,
  ownedCount,
  onInventoryChange,
} from './inventory.js';
import {
  getCrystals,
  spendCrystals,
  addCrystals,
  formatCrystals,
  onCrystalsChange,
} from './crystals.js';
import { crystalIcon } from './icons.js';
import { record } from './ledger.js';
import { showToast } from './toast.js';
import { celebratePurchase } from './purchase.js';

let root = null;
let lastFocused = null;
let currentSkin = null;

function build() {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.id = 'skinModal';
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="modal-backdrop" data-modal-close></div>
    <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="skinModalTitle">
      <button class="modal-close" type="button" aria-label="Close" data-modal-close>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round" />
        </svg>
      </button>
      <div class="modal-media">
        <span class="modal-rarity-bar" aria-hidden="true"></span>
        <img class="modal-img" alt="" />
        <span class="modal-media-fallback" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="64" height="64" fill="none">
            <path d="M2 15h13l3-3h4v2l-3 1v3h-3l-1-3H8l-1 3H4z" fill="currentColor"
              opacity="0.5" />
          </svg>
        </span>
      </div>
      <div class="modal-body">
        <div class="modal-head">
          <p class="modal-rarity" data-modal-rarity></p>
          <h2 class="modal-title" id="skinModalTitle" data-modal-title></h2>
          <p class="modal-condition" data-modal-condition></p>
        </div>
        <p class="modal-desc" data-modal-desc></p>
        <div class="modal-foot">
          <div class="modal-price-block">
            <span class="modal-price-label">Price</span>
            <span class="modal-price" data-modal-price></span>
            <span class="modal-owned" data-modal-owned></span>
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" type="button" data-modal-sell hidden>
              Sell
            </button>
            <button class="btn btn-primary modal-cta" type="button" data-modal-buy>
              Buy
            </button>
          </div>
        </div>
      </div>
    </div>`;

  wrap.addEventListener('click', (event) => {
    if (event.target.closest('[data-modal-close]')) closeSkinModal();
    if (event.target.closest('[data-modal-buy]')) buyCurrent();
    if (event.target.closest('[data-modal-sell]')) sellCurrent();
  });

  // Keep the modal's owned/affordability state live while it is open.
  onInventoryChange(() => syncActions());
  onCrystalsChange(() => syncActions());

  document.body.append(wrap);
  return wrap;
}

function syncActions() {
  if (!root || !currentSkin) return;
  const owned = ownedCount(currentSkin.id);

  root.querySelector('[data-modal-owned]').textContent =
    owned > 0 ? `Owned: ${owned}` : '';

  const buy = root.querySelector('[data-modal-buy]');
  buy.innerHTML = `Buy · ${formatPrice(currentSkin.price)}`;
  buy.classList.toggle('is-short', getCrystals() < currentSkin.price);

  const sell = root.querySelector('[data-modal-sell]');
  sell.hidden = owned === 0;
  sell.innerHTML = `Sell · ${formatCrystals(sellPrice(currentSkin))} ${crystalIcon(14)}`;
}

function buyCurrent() {
  if (!currentSkin) return;
  if (!spendCrystals(currentSkin.price)) {
    showToast('Not enough Crystals for this skin', 'error');
    return;
  }
  addToInventory(currentSkin.id);
  record({
    type: 'purchase',
    label: `Bought ${currentSkin.weapon} | ${currentSkin.finish}`,
    amount: -currentSkin.price,
    skinId: currentSkin.id,
  });
  // The celebration badge now carries the confirmation, so no duplicate toast.
  // The sweep and fly-clone start from the item panel the buyer is looking at.
  celebratePurchase({ origin: root?.querySelector('.modal-media') ?? null });
}

function sellCurrent() {
  if (!currentSkin || ownedCount(currentSkin.id) === 0) return;
  const gained = sellPrice(currentSkin);
  removeFromInventory(currentSkin.id, 1);
  addCrystals(gained);
  record({
    type: 'sale',
    label: `Sold ${currentSkin.weapon} | ${currentSkin.finish}`,
    amount: gained,
    skinId: currentSkin.id,
  });
  showToast(
    `Sold ${currentSkin.weapon} | ${currentSkin.finish} for ${formatCrystals(gained)} Crystals`,
    'success'
  );
}

function onKeydown(event) {
  if (event.key === 'Escape') closeSkinModal();
}

function ensureRoot() {
  if (!root) root = build();
  return root;
}

export function openSkinModal(skin) {
  if (!skin) return;
  const modal = ensureRoot();
  currentSkin = skin;

  const img = modal.querySelector('.modal-img');
  const fallback = modal.querySelector('.modal-media');
  fallback.classList.remove('is-fallback');
  img.src = skin.image;
  img.alt = `${skin.weapon} | ${skin.finish}`;
  img.onerror = () => fallback.classList.add('is-fallback');

  modal.style.setProperty(
    '--rarity',
    RARITIES[skin.rarity] ?? RARITIES.Consumer
  );
  modal.querySelector('[data-modal-rarity]').textContent = skin.rarity;
  modal.querySelector('[data-modal-title]').textContent = `${skin.weapon} | ${skin.finish}`;
  modal.querySelector('[data-modal-condition]').textContent = skin.condition;
  modal.querySelector('[data-modal-desc]').textContent = skin.description;
  modal.querySelector('[data-modal-price]').innerHTML = formatPrice(skin.price);
  syncActions();

  lastFocused = document.activeElement;
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add('is-open'));
  document.body.classList.add('modal-open');
  document.addEventListener('keydown', onKeydown);
  modal.querySelector('.modal-close')?.focus();
}

export function closeSkinModal() {
  if (!root || root.hidden) return;
  root.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  document.removeEventListener('keydown', onKeydown);
  window.setTimeout(() => {
    root.hidden = true;
  }, 260);
  if (lastFocused instanceof HTMLElement) lastFocused.focus();
}

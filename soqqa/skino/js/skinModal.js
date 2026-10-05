/* ============================================================================
   SKINO — skin detail modal
   A single reusable dialog that shows the full record for a skin: large image,
   name, condition, rarity, description and price. Built lazily so the page
   markup stays clean.
   ========================================================================= */

import { RARITIES, formatPrice } from './skins.js';

let root = null;
let lastFocused = null;

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
          </div>
          <button class="btn btn-ghost modal-cta" type="button" disabled
            title="Purchasing arrives in a later update">
            Coming soon
          </button>
        </div>
      </div>
    </div>`;

  wrap.addEventListener('click', (event) => {
    if (event.target.closest('[data-modal-close]')) closeSkinModal();
  });

  document.body.append(wrap);
  return wrap;
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
  modal.querySelector('[data-modal-price]').textContent = formatPrice(skin.price);

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

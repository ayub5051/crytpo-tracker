/* ============================================================================
   BLAZZER — Crystal rewards
   A small "Get more Crystals" dialog offering a once-a-day bonus and demo
   top-up packs. Claim state is persisted per calendar day in LocalStorage.
   ========================================================================= */

import { addCrystals, getCrystals, formatCrystals, onCrystalsChange } from './crystals.js';
import { record } from './ledger.js';
import { showToast } from './toast.js';
import { crystalIcon } from './icons.js';

export const DAILY_BONUS = 250;
export const TOPUP_PACKS = [500, 1000, 2500];

const DAILY_KEY = 'blazzer:dailyClaim';

let root = null;
let tickId = null;

function localDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function readClaim() {
  try {
    return window.localStorage.getItem(DAILY_KEY);
  } catch {
    return null;
  }
}

function writeClaim(value) {
  try {
    window.localStorage.setItem(DAILY_KEY, value);
  } catch {
    /* Storage unavailable — the bonus simply stays claimable this session. */
  }
}

export function canClaimDaily() {
  return readClaim() !== localDateKey();
}

/** Grants the daily bonus once per day. Returns the amount, or 0 if claimed. */
export function claimDaily() {
  if (!canClaimDaily()) return 0;
  writeClaim(localDateKey());
  addCrystals(DAILY_BONUS);
  return DAILY_BONUS;
}

function msUntilReset() {
  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  );
  return nextMidnight.getTime() - now.getTime();
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function build() {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.id = 'rewardsModal';
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="modal-backdrop" data-rewards-close></div>
    <div class="modal-dialog rewards-dialog" role="dialog" aria-modal="true"
      aria-labelledby="rewardsTitle">
      <button class="modal-close" type="button" aria-label="Close" data-rewards-close>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round" />
        </svg>
      </button>
      <div class="rewards-body">
        <p class="wheel-eyebrow">Crystal store</p>
        <h2 class="modal-title" id="rewardsTitle">Get more Crystals</h2>
        <p class="modal-desc">
          Claim your daily bonus, or add demo funds to keep trading.
        </p>

        <div class="reward-row">
          <div>
            <p class="reward-name">Daily bonus</p>
            <p class="reward-note" data-daily-note></p>
          </div>
          <button class="btn btn-primary reward-action" type="button" data-daily-claim>
            Claim
          </button>
        </div>

        <p class="rewards-label">Demo top-up — no real payment</p>
        <div class="reward-packs" data-topup-packs></div>

        <p class="rewards-balance">
          Balance · <span data-rewards-balance>0 ${crystalIcon(13)}</span>
        </p>
      </div>
    </div>`;

  const packs = wrap.querySelector('[data-topup-packs]');
  TOPUP_PACKS.forEach((amount) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reward-pack';
    btn.dataset.topup = String(amount);
    btn.innerHTML = `<span class="reward-pack-amount">+${formatCrystals(amount)} ${crystalIcon(13)}</span>
      <span class="reward-pack-note">Add</span>`;
    packs.append(btn);
  });

  wrap.addEventListener('click', (event) => {
    if (event.target.closest('[data-rewards-close]')) close();
    if (event.target.closest('[data-daily-claim]')) {
      const gained = claimDaily();
      if (gained > 0) {
        record({ type: 'daily', label: 'Daily bonus', amount: gained });
        showToast(`Daily bonus claimed: +${formatCrystals(gained)} Crystals`, 'success');
        refresh();
      }
    }
    const pack = event.target.closest('[data-topup]');
    if (pack) {
      const amount = Number(pack.dataset.topup);
      addCrystals(amount);
      record({ type: 'topup', label: `Top-up +${formatCrystals(amount)}`, amount });
      showToast(`Topped up +${formatCrystals(amount)} Crystals`, 'success');
    }
  });

  onCrystalsChange(() => refresh());

  document.body.append(wrap);
  return wrap;
}

function ensureRoot() {
  if (!root) root = build();
  return root;
}

function refresh() {
  if (!root) return;
  const claimable = canClaimDaily();
  const button = root.querySelector('[data-daily-claim]');
  const note = root.querySelector('[data-daily-note]');

  button.disabled = !claimable;
  button.innerHTML = claimable
    ? `Claim ${formatCrystals(DAILY_BONUS)} ${crystalIcon(13)}`
    : 'Claimed';
  note.innerHTML = claimable
    ? `Claim ${formatCrystals(DAILY_BONUS)} ${crystalIcon(12)} — resets at midnight.`
    : `Next bonus in ${formatCountdown(msUntilReset())}.`;

  root.querySelector('[data-rewards-balance]').innerHTML = `${formatCrystals(
    getCrystals()
  )} ${crystalIcon(13)}`;
}

function onKeydown(event) {
  if (event.key === 'Escape') close();
}

function open() {
  const modal = ensureRoot();
  refresh();
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add('is-open'));
  document.body.classList.add('modal-open');
  document.addEventListener('keydown', onKeydown);
  modal.querySelector('.modal-close')?.focus();
  if (tickId === null) tickId = window.setInterval(refresh, 1000);
}

function close() {
  if (!root || root.hidden) return;
  root.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  document.removeEventListener('keydown', onKeydown);
  if (tickId !== null) {
    window.clearInterval(tickId);
    tickId = null;
  }
  window.setTimeout(() => {
    root.hidden = true;
  }, 260);
}

export function initRewards() {
  document.querySelectorAll('[data-rewards-open]').forEach((el) => {
    el.addEventListener('click', open);
  });
}

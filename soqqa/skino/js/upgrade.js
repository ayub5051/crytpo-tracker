/* ============================================================================
   BLAZZER — Upgrade (trade-up wheel)
   Stake items out of your Inventory for one shot at a bigger item.

        chance = stake value ÷ target value × 0.95

   Both outcomes consume the stake — a win hands you the target, a loss hands
   you nothing. That is what keeps the return a flat 95% at every stake and
   every target (see js/upgrade-rules.js).

   The outcome is decided BEFORE the disc spins, by the provably-fair pipeline:
   `window.BLAZZER_FAIR.consume('upgrade', …)` when the API is reachable, or the
   identical HMAC maths against a locally-held seed when it is not. The spin is
   pure presentation — it lands on the wedge the outcome already chose, so the
   animation can never be the source of truth.

   Everything is transform/opacity, and the whole thing collapses under
   prefers-reduced-motion (the disc still settles, it just gets there faster).
   ========================================================================= */

import { getSkinById, SKINS, RARITIES, createSkinCard, formatPrice } from './skins.js';
import { formatCrystals } from './crystals.js';
import { getItems, removeItem, addToInventory, onInventoryChange } from './inventory.js';
import { record } from './ledger.js';
import { showToast } from './toast.js';
import { celebrateWin } from './celebration.js';
import { hydrateCrystalIcons } from './icons.js';
import { hmacSha256Hex, sha256Hex, rollFromHex, clampUpgradeChance } from './fair-verify.js';
import {
  assess,
  blockMessage,
  formatChance,
  formatMultiplier,
  MAX_INPUTS,
} from './upgrade-rules.js';
import { mountUpgradeWheel, spinTo, setUpgradeChance } from './upgradeWheel.js';

/* ------------------------------------------------------------------ config */

const HISTORY_KEY = 'blazzer:upgrade:history';
const TARGET_KEY = 'blazzer:upgrade:target';
const LOCAL_SEED_KEY = 'blazzer:fair:local';
const MAX_HISTORY = 24;

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* ------------------------------------------------------------------- state */

const state = {
  inputs: [], // inventory uids, max MAX_INPUTS
  targetId: null, // catalogue id
  busy: false,
  history: [],
};

let els = null;
let picker = null;
let pickerMode = 'stake';
let pickerQuery = '';

/* ------------------------------------------------------------------ helpers */

function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the panel still works for this session */
  }
}

/** A plain-text price, for places that assign to textContent. */
const plainPrice = (value) => `${formatCrystals(value)} ◆`;

/** Items that may be staked: real catalogue skins, unlisted, unlocked. */
function eligibleItems() {
  const now = Date.now();
  return getItems()
    .filter((item) => {
      if (!getSkinById(item.id)) return false;
      if (item.isListed) return false;
      if (item.tradeLocked && (!item.tradeLockedUntil || item.tradeLockedUntil > now)) return false;
      return true;
    })
    .map((item) => ({ item, skin: getSkinById(item.id) }));
}

function stakedEntries() {
  const byUid = new Map(getItems().map((item) => [item.uid, item]));
  return state.inputs
    .map((uid) => {
      const item = byUid.get(uid);
      const skin = item ? getSkinById(item.id) : null;
      return item && skin ? { item, skin } : null;
    })
    .filter(Boolean);
}

function stakeValue() {
  return stakedEntries().reduce((sum, { skin }) => sum + skin.price, 0);
}

function targetSkin() {
  return state.targetId ? getSkinById(state.targetId) : null;
}

/** The current assessment of the stake against the target. */
function currentAssessment() {
  const target = targetSkin();
  return assess({
    inputValue: stakeValue(),
    targetValue: target ? target.price : 0,
    inputCount: state.inputs.length,
  });
}

function persistTarget() {
  writeJson(TARGET_KEY, state.targetId);
}

/* ----------------------------------------------------------- local fairness */

/**
 * The offline fallback seed pair. Same shape as the server's, held in
 * localStorage, so a bet settled without an API is still verifiable by hand in
 * the Fairness modal's Verify tab.
 */
function localSeed() {
  let seed = readJson(LOCAL_SEED_KEY, null);
  if (!seed || !/^[0-9a-f]{64}$/i.test(String(seed.serverSeed || ''))) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    seed = {
      serverSeed: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''),
      clientSeed: Math.random().toString(36).slice(2, 12) || 'blazzer',
      nonce: 0,
    };
  }
  if (!seed.clientSeed) seed.clientSeed = 'blazzer';
  if (!Number.isFinite(seed.nonce)) seed.nonce = 0;
  writeJson(LOCAL_SEED_KEY, seed);
  return seed;
}

/**
 * Settle an Upgrade locally with the exact algorithm both fair twins use:
 * digest = HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`) → roll → roll < chance.
 */
async function localOutcome(params) {
  const seed = localSeed();
  const serverSeedHash = await sha256Hex(seed.serverSeed);
  const digest = await hmacSha256Hex(seed.serverSeed, `${seed.clientSeed}:${seed.nonce}`);
  const roll = rollFromHex(digest);
  const chance = clampUpgradeChance(params.chance);

  const bet = {
    id: `local_${Date.now().toString(36)}`,
    game: 'upgrade',
    nonce: seed.nonce,
    outcome: { chance, target: params.target, win: roll < chance },
    digest,
    serverSeedHash,
    clientSeed: seed.clientSeed,
    params,
    createdAt: Date.now(),
  };

  seed.nonce += 1;
  writeJson(LOCAL_SEED_KEY, seed);
  return { source: 'local', bet };
}

/** Ask the fair pipeline for the outcome, falling back to local settlement. */
async function resolveOutcome(params) {
  try {
    if (window.BLAZZER_FAIR?.consume) {
      const result = await window.BLAZZER_FAIR.consume('upgrade', params, params.stake);
      if (result?.bet?.outcome && result.bet.outcome.win !== undefined) {
        return { source: 'server', bet: result.bet };
      }
    }
  } catch {
    /* no API (or it refused) — settle locally rather than block the player */
  }
  return localOutcome(params);
}

/* -------------------------------------------------------------- rendering */

function setResult(text, variant = '') {
  if (!els.result) return;
  els.result.textContent = text;
  els.result.dataset.state = variant;
}

function renderSlots() {
  const entries = stakedEntries();
  els.slots.replaceChildren();
  els.slots.dataset.empty = entries.length ? 'false' : 'true';

  if (!entries.length) {
    const hint = document.createElement('p');
    hint.className = 'upgrade-slot-hint';
    hint.textContent = 'No items staked yet.';
    els.slots.append(hint);
  }

  entries.forEach(({ item, skin }) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'upgrade-chip';
    chip.dataset.uid = item.uid;
    chip.style.setProperty('--rarity', RARITIES[skin.rarity] ?? RARITIES.Consumer);
    chip.setAttribute('aria-label', `Remove ${skin.weapon} | ${skin.finish} from the stake`);
    chip.innerHTML =
      `<span class="upgrade-chip-name">${skin.weapon} | ${skin.finish}</span>` +
      `<span class="upgrade-chip-value">${plainPrice(skin.price)}</span>` +
      '<span class="upgrade-chip-x" aria-hidden="true">✕</span>';
    els.slots.append(chip);
  });

  els.count.textContent = `${entries.length} / ${MAX_INPUTS}`;
}

function renderTarget() {
  const skin = targetSkin();
  els.target.replaceChildren();
  els.target.dataset.empty = skin ? 'false' : 'true';

  if (!skin) {
    const hint = document.createElement('p');
    hint.className = 'upgrade-slot-hint';
    hint.textContent = 'No target picked yet — tap to choose one.';
    els.target.append(hint);
    return;
  }

  const slot = document.createElement('div');
  slot.className = 'upgrade-target-slot';

  const card = createSkinCard(skin);
  card.classList.add('upgrade-target-card');
  card.removeAttribute('tabindex');
  card.setAttribute('aria-hidden', 'true');

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'upgrade-target-clear';
  clear.dataset.upgradeClear = '';
  clear.textContent = 'Clear target';

  slot.append(card, clear);
  els.target.append(slot);
  hydrateCrystalIcons(els.target);
}

function renderStats() {
  const a = currentAssessment();
  const hasBoth = state.inputs.length > 0 && Boolean(state.targetId);

  els.stake.innerHTML = state.inputs.length ? formatPrice(stakeValue()) : '—';

  if (!hasBoth) {
    els.chance.textContent = '—';
    els.chance.dataset.tone = '';
    els.mult.textContent = '—';
    els.payout.innerHTML = targetSkin() ? formatPrice(targetSkin().price) : '—';
    els.play.disabled = true;
    els.blockedEl.textContent = '';
    els.blockedEl.hidden = true;
    hydrateCrystalIcons(els.stats);
    return;
  }

  els.chance.textContent = formatChance(a.chance);
  els.chance.dataset.tone = a.ok ? (a.chance >= 0.5 ? 'good' : 'edge') : 'bad';
  els.mult.textContent = formatMultiplier(a.multiplier);
  els.payout.innerHTML = formatPrice(a.targetValue);

  els.play.disabled = state.busy || !a.ok;
  els.blockedEl.textContent = a.ok ? '' : blockMessage(a.reason);
  els.blockedEl.hidden = a.ok;

  hydrateCrystalIcons(els.stats);
}

/** One repaint of everything that depends on the current selection. */
function refresh() {
  // Drop any selection whose item vanished (sold, traded, consumed elsewhere).
  const live = new Set(getItems().map((item) => item.uid));
  state.inputs = state.inputs.filter((uid) => live.has(uid));

  renderSlots();
  renderTarget();
  renderStats();

  const a = currentAssessment();
  setUpgradeChance(a.ok ? a.chance : 0.5);
}

/* ---------------------------------------------------------------- history */

function loadHistory() {
  const stored = readJson(HISTORY_KEY, []);
  state.history = Array.isArray(stored) ? stored.slice(0, MAX_HISTORY) : [];
}

function pushHistory(entry) {
  state.history.unshift(entry);
  state.history = state.history.slice(0, MAX_HISTORY);
  writeJson(HISTORY_KEY, state.history);
  renderHistory();
}

function renderHistory() {
  if (!els.history) return;
  els.history.replaceChildren();

  if (!state.history.length) {
    const empty = document.createElement('p');
    empty.className = 'upgrade-history-empty';
    empty.textContent = 'No upgrades yet.';
    els.history.append(empty);
    return;
  }

  state.history.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'upgrade-log';
    row.dataset.win = entry.win ? 'true' : 'false';

    const count = Number(entry.inputCount) || 0;
    row.innerHTML =
      `<span class="upgrade-log-mark" aria-hidden="true">${entry.win ? '✓' : '✕'}</span>` +
      '<span class="upgrade-log-body">' +
      '<span class="upgrade-log-name"></span>' +
      '<span class="upgrade-log-meta"></span>' +
      '</span>' +
      `<span class="upgrade-log-chance">${formatChance(entry.chance)}</span>`;

    row.querySelector('.upgrade-log-name').textContent = entry.win
      ? `Won ${entry.targetName}`
      : `Lost ${count} item${count === 1 ? '' : 's'}`;
    row.querySelector('.upgrade-log-meta').textContent = entry.win
      ? `${plainPrice(entry.stakeValue)} → ${entry.targetName}`
      : `${plainPrice(entry.stakeValue)} staked`;
    row.title = `Chance ${formatChance(entry.chance)} · ${entry.source} proof · nonce ${entry.nonce}`;

    els.history.append(row);
  });
}

/* ------------------------------------------------------------------- play */

async function play() {
  if (state.busy) return;

  const target = targetSkin();
  const a = currentAssessment();
  if (!a.ok) {
    showToast(blockMessage(a.reason), 'error');
    return;
  }

  // Snapshot the stake before anything is consumed — the history entry and the
  // settlement both need it, and removeItem() empties the live inventory.
  const entries = stakedEntries();
  const stakeUids = entries.map(({ item }) => item.uid);
  const stakeValueAtPlay = entries.reduce((sum, { skin }) => sum + skin.price, 0);

  state.busy = true;
  els.play.disabled = true;
  els.play.classList.add('is-busy');
  setResult('Spinning…', 'spin');

  const params = { chance: a.chance, target: target.id, stake: stakeValueAtPlay };
  const settled = await resolveOutcome(params);
  const win = Boolean(settled.bet.outcome.win);

  // Show the outcome, then settle. The stake leaves either way.
  await spinTo({ win, chance: a.chance, origin: els.stage });

  stakeUids.forEach((uid) => removeItem(uid));
  state.inputs = [];

  if (win) {
    addToInventory(target.id, 1, { obtainedVia: 'upgrade' });
    record({
      type: 'upgrade',
      label: `Upgrade win: ${target.weapon} | ${target.finish}`,
      amount: 0,
      skinId: target.id,
    });
    setResult(`Won ${target.weapon} | ${target.finish}`, 'win');
    showToast(`Upgrade win: ${target.weapon} | ${target.finish}!`, 'success');
    if (!reducedMotion) {
      celebrateWin({ text: `${target.weapon} | ${target.finish}`, big: a.multiplier >= 5 });
    }
  } else {
    record({
      type: 'upgrade',
      label: `Upgrade loss: ${entries.length} item(s) consumed`,
      amount: 0,
    });
    setResult('Lost the stake — the target stayed out of reach.', 'lose');
    showToast('Upgrade lost — your staked items are gone', 'error');
  }

  pushHistory({
    at: Date.now(),
    win,
    chance: a.chance,
    multiplier: a.multiplier,
    stakeValue: stakeValueAtPlay,
    inputCount: entries.length,
    target: target.id,
    targetName: `${target.weapon} | ${target.finish}`,
    targetValue: target.price,
    source: settled.source,
    nonce: settled.bet.nonce,
    digest: settled.bet.digest,
  });

  state.busy = false;
  els.play.classList.remove('is-busy');
  refresh();
}

/* ----------------------------------------------------------------- picker */

/**
 * One modal serves both pickers: `stake` lists what you can put in, `target`
 * lists the catalogue. Reusing a single shell keeps the two flows visually
 * identical and halves the DOM we have to keep in sync.
 */
function ensurePicker() {
  if (picker) return picker;

  picker = document.createElement('div');
  picker.className = 'upgrade-modal';
  picker.innerHTML = `
    <div class="upgrade-backdrop" data-upgrade-close></div>
    <div class="upgrade-dialog" role="dialog" aria-modal="true" aria-labelledby="upgradePickTitle">
      <button class="upgrade-modal-close" type="button" data-upgrade-close aria-label="Close">✕</button>
      <div class="upgrade-dialog-head">
        <h2 class="upgrade-dialog-title" id="upgradePickTitle" data-upgrade-pick-title></h2>
        <p class="upgrade-dialog-sub" data-upgrade-pick-sub></p>
      </div>
      <label class="field field-search upgrade-dialog-search">
        <span class="field-label">Search</span>
        <input type="search" data-upgrade-search placeholder="Weapon, finish or rarity" autocomplete="off" />
      </label>
      <div class="card-grid upgrade-pick-grid" data-upgrade-pick-grid></div>
      <p class="upgrade-dialog-empty" data-upgrade-pick-empty hidden>Nothing matches that search.</p>
      <div class="upgrade-dialog-actions">
        <button class="btn btn-primary" type="button" data-upgrade-done>Done</button>
      </div>
    </div>`;

  picker.addEventListener('click', (event) => {
    if (event.target.closest('[data-upgrade-close]') || event.target.closest('[data-upgrade-done]')) {
      closePicker();
      return;
    }
    const card = event.target.closest('[data-skin-id]');
    if (card) pickCard({ catalogueId: card.dataset.skinId, uid: card.dataset.uid || null });
  });

  picker.addEventListener('input', (event) => {
    if (!event.target.matches('[data-upgrade-search]')) return;
    pickerQuery = event.target.value.trim().toLowerCase();
    renderPickerGrid();
  });

  picker.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    closePicker();
  });

  document.body.append(picker);
  return picker;
}

function pickerSource() {
  if (pickerMode === 'target') return SKINS.map((skin) => ({ skin, uid: null }));
  // The inventory uid travels with each card: two copies of one skin are two
  // separate rows, and each has to be pickable and un-pickable on its own.
  return eligibleItems().map(({ item, skin }) => ({ skin, uid: item.uid }));
}

function matchesQuery(entry, query) {
  if (!query) return true;
  return `${entry.skin.weapon} ${entry.skin.finish} ${entry.skin.rarity} ${entry.skin.condition}`
    .toLowerCase()
    .includes(query);
}

function renderPickerGrid() {
  const grid = picker.querySelector('[data-upgrade-pick-grid]');
  const rows = pickerSource().filter((entry) => matchesQuery(entry, pickerQuery));

  picker.querySelector('[data-upgrade-pick-empty]').hidden = rows.length > 0;

  grid.replaceChildren(
    ...rows.map(({ skin, uid }) => {
      const card = createSkinCard(skin);
      card.classList.add('upgrade-pick-card');
      card.removeAttribute('tabindex');
      card.dataset.uid = uid || '';
      const picked =
        pickerMode === 'target' ? skin.id === state.targetId : Boolean(uid) && state.inputs.includes(uid);
      card.classList.toggle('is-picked', picked);
      card.setAttribute('aria-pressed', String(picked));
      return card;
    })
  );
  hydrateCrystalIcons(grid);
}

function renderPickerHead() {
  picker.querySelector('[data-upgrade-pick-title]').textContent =
    pickerMode === 'target' ? 'Choose a target' : 'Add items to your stake';
  picker.querySelector('[data-upgrade-pick-sub]').textContent =
    pickerMode === 'target'
      ? 'The item you are aiming for. A bigger target means a smaller chance.'
      : `${state.inputs.length} of ${MAX_INPUTS} picked. Listed and trade-locked items are not available.`;
}

/**
 * Pick or un-pick one card.
 *
 * Stake mode toggles the exact INSTANCE the card represents — two copies of the
 * same skin are two independent picks, so clicking the second copy must add the
 * second copy rather than toggle the first one. Target mode has no instance, so
 * it keys off the catalogue id instead.
 *
 * @param {{catalogueId: string, uid: string|null}} card
 */
function pickCard({ catalogueId, uid }) {
  if (pickerMode === 'target') {
    state.targetId = catalogueId;
    persistTarget();
    renderPickerHead();
    renderPickerGrid();
    refresh();
    return;
  }

  const candidates = eligibleItems().filter(({ skin }) => skin.id === catalogueId);
  if (!candidates.length) return;

  const instance = uid
    ? candidates.find(({ item }) => item.uid === uid)
    : candidates.find(({ item }) => !state.inputs.includes(item.uid));
  if (!instance) return;

  const itemUid = instance.item.uid;
  if (state.inputs.includes(itemUid)) {
    state.inputs = state.inputs.filter((existing) => existing !== itemUid);
  } else {
    if (state.inputs.length >= MAX_INPUTS) {
      showToast(`You can stake at most ${MAX_INPUTS} items`, 'info');
      return;
    }
    state.inputs = [...state.inputs, itemUid];
  }

  renderPickerHead();
  renderPickerGrid();
  refresh();
}

function openPicker(mode) {
  pickerMode = mode;
  pickerQuery = '';
  const el = ensurePicker();
  el.querySelector('[data-upgrade-search]').value = '';
  renderPickerHead();
  renderPickerGrid();
  el.classList.add('is-open');
  document.body.classList.add('modal-open');
  el.querySelector('[data-upgrade-search]')?.focus();
}

function closePicker() {
  if (!picker) return;
  picker.classList.remove('is-open');
  document.body.classList.remove('modal-open');
}

/* -------------------------------------------------------------------- init */

export function initUpgrade() {
  const panel = document.querySelector('[data-upgrade-panel]');
  if (!panel) return;

  els = {
    panel,
    stage: panel.querySelector('[data-upgrade-stage]'),
    slots: panel.querySelector('[data-upgrade-slots]'),
    target: panel.querySelector('[data-upgrade-target]'),
    count: panel.querySelector('[data-upgrade-count]'),
    chance: panel.querySelector('[data-upgrade-chance]'),
    mult: panel.querySelector('[data-upgrade-mult]'),
    stake: panel.querySelector('[data-upgrade-stake]'),
    payout: panel.querySelector('[data-upgrade-payout]'),
    stats: panel.querySelector('.upgrade-stats'),
    play: panel.querySelector('[data-upgrade-play]'),
    result: panel.querySelector('[data-upgrade-result]'),
    blockedEl: panel.querySelector('[data-upgrade-blocked]'),
    history: document.querySelector('[data-upgrade-history]'),
  };

  // A target from last visit is convenient, but never a staked item: the stake
  // must always be a deliberate choice.
  state.targetId = readJson(TARGET_KEY, null);
  if (state.targetId && !getSkinById(state.targetId)) state.targetId = null;

  loadHistory();
  renderHistory();

  panel.querySelector('[data-upgrade-add]')?.addEventListener('click', () => openPicker('stake'));
  panel.querySelector('[data-upgrade-choose]')?.addEventListener('click', () => openPicker('target'));
  els.play.addEventListener('click', play);

  // Owning the target area's clicks in one handler keeps "choose" and "clear"
  // from fighting over the same element.
  els.target.addEventListener('click', (event) => {
    if (event.target.closest('[data-upgrade-clear]')) {
      state.targetId = null;
      persistTarget();
      refresh();
      return;
    }
    if (els.target.dataset.empty === 'true') openPicker('target');
  });

  els.slots.addEventListener('click', (event) => {
    const chip = event.target.closest('.upgrade-chip');
    if (!chip) return;
    state.inputs = state.inputs.filter((uid) => uid !== chip.dataset.uid);
    refresh();
  });

  mountUpgradeWheel();
  refresh();

  onInventoryChange(refresh);
}

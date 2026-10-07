/* ============================================================================
   BLAZZER — provably-fair UI
   The user-facing half of Stage 2: a header shield button, a four-tab modal
   (Current Seeds / Verify / History / Rotate), per-game "provably fair" badges,
   a first-visit onboarding tip, and a soft glow + chime on rotation.

   Everything is additive: this module injects its own DOM and never edits the
   game engines. Games can opt into server-authoritative outcomes with one call:
       await window.BLAZZER_FAIR.consume('wheel', {})
   ========================================================================= */

import { isMuted } from './celebration.js';
import { verifyOutcome } from './fair-verify.js';

const LS_TOKEN = 'blazzer:fair:token';
const LS_ONBOARD = 'blazzer:fair:onboarded';
const LS_BET_SEEN = 'blazzer:fair:bet-seen';
const LS_TAB = 'blazzer:fair:tab';

const GAMES = [
  { id: 'wheel', label: 'Wheel' },
  { id: 'mines', label: 'Mines' },
  { id: 'case', label: 'Mystery Case' },
  { id: 'crash', label: 'Crash' },
  { id: 'upgrade', label: 'Upgrade' },
];

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const SHIELD_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">' +
  '<path d="M12 2.8 19 5.6v5.3c0 4.3-2.9 8.2-7 9.3-4.1-1.1-7-5-7-9.3V5.6z" ' +
  'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
  '<path d="m8.6 12 2.3 2.3 4.5-4.6" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

const X_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">' +
  '<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

/* ------------------------------------------------------------------- state */

const state = {
  seeds: null,
  history: null,
  rotateResult: null,
  activeTab: 'seeds',
  busy: false,
};

let els = null;
let channel = null;
let onboardTimer = 0;

/* --------------------------------------------------------------- utilities */

function lsGet(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch {
    return false;
  }
}

/** Short chime for a successful rotation — respects the global mute flag. */
let audioCtx = null;
function chime() {
  if (isMuted() || window.BLAZZER_MUTED === true) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx ||= new Ctx();
    const now = audioCtx.currentTime;
    [660, 990].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const at = now + i * 0.09;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.09, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(at);
      osc.stop(at + 0.24);
    });
  } catch {
    /* autoplay blocked */
  }
}

/* -------------------------------------------------------------------- API */

async function getToken(force = false) {
  if (!force) {
    try {
      const cached = JSON.parse(lsGet(LS_TOKEN, 'null'));
      if (cached?.token && cached.exp > Date.now()) return cached.token;
    } catch {
      /* fall through to a fresh mint */
    }
  }
  try {
    const res = await fetch('/api/live/token');
    if (!res.ok) return null;
    const data = await res.json();
    // guest tokens live 2h; refresh a little early.
    lsSet(LS_TOKEN, JSON.stringify({ token: data.token, exp: Date.now() + 110 * 60 * 1000 }));
    return data.token;
  } catch {
    return null;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const token = await getToken();
  if (!token) throw new Error('Fair server unavailable');
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (res.status === 401) {
    // stale token — re-mint once and retry
    const fresh = await getToken(true);
    if (fresh && fresh !== token) return api(path, { method, body });
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* --------------------------------------------------------------- injection */

function buildShield() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fair-shield';
  button.setAttribute('data-fair-open', '');
  button.setAttribute('aria-label', 'Provably fair — verify your bets');
  button.title = 'Provably fair. Click to verify.';
  button.innerHTML = `${SHIELD_SVG}<span class="fair-shield-text">Fair</span>`;
  button.addEventListener('click', () => openModal());

  const headerInner = document.querySelector('.header-inner');
  const balance = headerInner?.querySelector('.balance');
  if (balance) balance.before(button);
  else headerInner?.append(button);
  return button;
}

const GAME_SIDES = ['.wheel-side', '.mines-side', '.case-side', '.upgrade-side'];

function injectBadges() {
  GAME_SIDES.forEach((selector) => {
    const side = document.querySelector(selector);
    if (!side || side.querySelector('.fair-badge')) return;
    const title = side.querySelector('.wheel-title') || side.firstElementChild;
    if (!title) return;
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'fair-badge';
    badge.setAttribute('data-fair-open', '');
    badge.title = 'This game is provably fair. Click to verify.';
    badge.setAttribute('aria-label', 'This game is provably fair. Click to verify.');
    badge.innerHTML = `${SHIELD_SVG}<span>Provably fair</span>`;
    badge.addEventListener('click', () => openModal('verify'));
    title.insertAdjacentElement('afterend', badge);
  });
}

/** First-visit nudge beside the shield; auto-dismisses and never nags again. */
function maybeOnboard() {
  if (lsGet(LS_ONBOARD, '0') === '1' || reducedMotion) return;
  const tip = document.createElement('div');
  tip.className = 'fair-onboard';
  tip.setAttribute('role', 'note');
  tip.innerHTML = `${SHIELD_SVG}<span>Every game is provably fair — click to verify your bets.</span>`;
  els.shield.insertAdjacentElement('afterend', tip);
  requestAnimationFrame(() => tip.classList.add('is-in'));

  const dismiss = () => {
    lsSet(LS_ONBOARD, '1');
    tip.classList.remove('is-in');
    window.setTimeout(() => tip.remove(), 300);
  };
  onboardTimer = window.setTimeout(dismiss, 7000);
  tip.addEventListener('click', dismiss);
}

/* ------------------------------------------------------------- modal build */

function buildModal() {
  const modal = document.createElement('div');
  modal.className = 'fair-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="fair-backdrop" data-fair-close></div>
    <div class="fair-dialog" role="dialog" aria-modal="true" aria-labelledby="fairTitle">
      <button class="fair-close" type="button" data-fair-close aria-label="Close">${X_SVG}</button>
      <header class="fair-head">
        <span class="fair-head-shield" aria-hidden="true">${SHIELD_SVG}</span>
        <h2 id="fairTitle" class="fair-title">Provably fair</h2>
        <p class="fair-sub">Every outcome is fixed before you bet. Verify any of them yourself.</p>
      </header>
      <div class="fair-tabs" role="tablist" aria-label="Provably fair sections">
        <button type="button" role="tab" data-fair-tab="seeds">Current Seeds</button>
        <button type="button" role="tab" data-fair-tab="verify">Verify</button>
        <button type="button" role="tab" data-fair-tab="history">History</button>
        <button type="button" role="tab" data-fair-tab="rotate">Rotate Seed</button>
      </div>
      <div class="fair-body">
        <section class="fair-panel" data-fair-panel="seeds"></section>
        <section class="fair-panel" data-fair-panel="verify" hidden></section>
        <section class="fair-panel" data-fair-panel="history" hidden></section>
        <section class="fair-panel" data-fair-panel="rotate" hidden></section>
      </div>
    </div>`;

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-fair-close]')) closeModal();
  });
  modal.querySelector('.fair-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-fair-tab]');
    if (tab) selectTab(tab.dataset.fairTab);
  });

  document.body.append(modal);
  return modal;
}

function panel(name) {
  return els.modal.querySelector(`[data-fair-panel="${name}"]`);
}

/* --------------------------------------------------------------- tab: seeds */

function renderSeeds() {
  const s = state.seeds;
  const target = panel('seeds');
  if (!s) {
    target.innerHTML = '<p class="fair-empty">Loading seeds…</p>';
    return;
  }
  target.innerHTML = `
    <div class="fair-field">
      <span class="fair-label">Server seed hash <em>(commitment)</em></span>
      <div class="fair-readonly">
        <code data-fair-hash>${escapeHtml(s.serverSeedHash)}</code>
        <button class="fair-copy" type="button" data-fair-copy="hash" aria-label="Copy hash">Copy</button>
      </div>
    </div>
    <div class="fair-field">
      <label class="fair-label" for="fairClient">Client seed <em>(editable)</em></label>
      <div class="fair-row">
        <input id="fairClient" class="fair-input" data-fair-client value="${escapeHtml(s.clientSeed)}" spellcheck="false" />
        <button class="btn btn-ghost fair-save" type="button" data-fair-save>Save</button>
      </div>
    </div>
    <div class="fair-field">
      <span class="fair-label">Nonce <em>(bets used with this seed pair)</em></span>
      <div class="fair-readonly"><code data-fair-nonce>${Number(s.nonce) || 0}</code></div>
    </div>
    <p class="fair-note">
      We commit to a random server seed by publishing its SHA-256 hash before you bet.
      Each bet mixes that secret seed with your client seed and an incrementing nonce
      to produce a result you can re-compute. Rotate to reveal the seed and prove it.
    </p>
    <p class="fair-msg" data-fair-msg="seeds" role="status"></p>`;

  target.querySelector('[data-fair-copy="hash"]').addEventListener('click', async (event) => {
    const ok = await copyText(state.seeds.serverSeedHash);
    flashMsg('seeds', ok ? 'Hash copied' : 'Copy failed', ok ? 'ok' : 'err');
    event.currentTarget.blur();
  });
  target.querySelector('[data-fair-save]').addEventListener('click', saveClientSeed);
}

async function saveClientSeed() {
  const input = panel('seeds').querySelector('[data-fair-client]');
  const value = input.value.trim();
  if (!value) return flashMsg('seeds', 'Client seed cannot be empty', 'err');
  setBusy(true, 'seeds', 'Saving…');
  try {
    const updated = await api('/api/fair/client-seed', { method: 'POST', body: { clientSeed: value } });
    state.seeds = { ...state.seeds, ...updated };
    broadcast();
    flashMsg('seeds', 'Client seed saved', 'ok');
  } catch (err) {
    flashMsg('seeds', err.message, 'err');
  } finally {
    setBusy(false);
  }
}

/* -------------------------------------------------------------- tab: verify */

function gameParamsFields(game) {
  if (game === 'mines') {
    return `<label class="fair-label" for="fairMines">Mines on the field</label>
      <select id="fairMines" class="fair-input" data-fair-mines>
        <option value="3">3</option><option value="5">5</option><option value="8">8</option>
      </select>`;
  }
  if (game === 'case') {
    return `<label class="fair-label" for="fairTier">Case tier</label>
      <select id="fairTier" class="fair-input" data-fair-tier>
        <option value="bronze">Bronze</option><option value="silver">Silver</option>
        <option value="gold">Gold</option><option value="neon">Neon</option>
      </select>`;
  }
  if (game === 'upgrade') {
    return `<label class="fair-label" for="fairChance">Win chance <em>(0.02–0.95)</em></label>
      <input id="fairChance" class="fair-input" type="number" step="0.0001" min="0.02" max="0.95" placeholder="0.4429" data-fair-chance />`;
  }
  return '';
}

function renderVerify(prefill = null) {
  const target = panel('verify');
  const p = prefill || state.verifyPrefill || {};
  const game = p.game || 'wheel';
  target.innerHTML = `
    <div class="fair-grid">
      <label class="fair-label" for="fairServerSeed">Server seed <em>(revealed on rotation)</em></label>
      <input id="fairServerSeed" class="fair-input fair-input-mono" data-fair-server value="${escapeHtml(p.serverSeed || '')}" placeholder="64 hex characters" spellcheck="false" />
      <label class="fair-label" for="fairVerifyClient">Client seed</label>
      <input id="fairVerifyClient" class="fair-input fair-input-mono" data-fair-vclient value="${escapeHtml(p.clientSeed || state.seeds?.clientSeed || '')}" spellcheck="false" />
      <label class="fair-label" for="fairNonce">Nonce</label>
      <input id="fairNonce" class="fair-input" type="number" min="0" step="1" data-fair-nonce-input value="${p.nonce ?? 0}" />
      <label class="fair-label" for="fairGame">Game</label>
      <select id="fairGame" class="fair-input" data-fair-game>
        ${GAMES.map((g) => `<option value="${g.id}"${g.id === game ? ' selected' : ''}>${g.label}</option>`).join('')}
      </select>
      <div class="fair-params" data-fair-params>${gameParamsFields(game)}</div>
    </div>
    <div class="fair-actions">
      <button class="btn btn-primary" type="button" data-fair-run>Verify</button>
      <button class="btn btn-ghost" type="button" data-fair-fill>Use current seeds</button>
    </div>
    <div class="fair-result" data-fair-result hidden></div>
    <p class="fair-msg" data-fair-msg="verify" role="status"></p>`;

  const gameSelect = target.querySelector('[data-fair-game]');
  gameSelect.addEventListener('change', () => {
    target.querySelector('[data-fair-params]').innerHTML = gameParamsFields(gameSelect.value);
  });
  target.querySelector('[data-fair-fill]').addEventListener('click', () => {
    if (!state.seeds) return;
    target.querySelector('[data-fair-vclient]').value = state.seeds.clientSeed;
    target.querySelector('[data-fair-nonce-input]').value = state.seeds.nonce;
  });
  target.querySelector('[data-fair-run]').addEventListener('click', runVerify);
}

async function runVerify() {
  const target = panel('verify');
  const serverSeed = target.querySelector('[data-fair-server]').value.trim();
  const clientSeed = target.querySelector('[data-fair-vclient]').value.trim();
  const nonce = Number(target.querySelector('[data-fair-nonce-input]').value);
  const game = target.querySelector('[data-fair-game]').value;
  const result = target.querySelector('[data-fair-result]');

  if (!/^[0-9a-f]{64}$/i.test(serverSeed)) {
    return flashMsg('verify', 'Server seed must be 64 hex characters', 'err');
  }
  if (!clientSeed) return flashMsg('verify', 'Client seed is required', 'err');
  if (!Number.isInteger(nonce) || nonce < 0) return flashMsg('verify', 'Nonce must be a non-negative integer', 'err');

  const params = {};
  const minesSel = target.querySelector('[data-fair-mines]');
  const tierSel = target.querySelector('[data-fair-tier]');
  const chanceEl = target.querySelector('[data-fair-chance]');
  if (game === 'mines' && minesSel) params.mines = Number(minesSel.value);
  if (game === 'case' && tierSel) params.tier = tierSel.value;
  if (game === 'upgrade' && chanceEl) params.chance = Number(chanceEl.value);

  result.hidden = false;
  result.innerHTML = '<p class="fair-empty">Computing…</p>';
  flashMsg('verify', '');

  try {
    const local = await verifyOutcome({
      serverSeed,
      clientSeed,
      nonce,
      game,
      params,
      expectedHash: state.seeds?.serverSeedHash || null,
    });

    // Best-effort server cross-check (offline verification already succeeded).
    let server = null;
    try {
      server = await api('/api/fair/verify', {
        method: 'POST',
        body: { serverSeed, clientSeed, nonce, game, params },
      });
    } catch {
      server = null;
    }

    const hashBadge =
      local.hashMatches === true
        ? '<span class="fair-chip ok">Seed matches commitment</span>'
        : local.hashMatches === false
          ? '<span class="fair-chip err">Seed does not match hash</span>'
          : '<span class="fair-chip">Commitment not loaded</span>';

    const recordedBadge = server?.matchesRecorded;
    const recorded =
      recordedBadge === true
        ? '<span class="fair-chip ok">Matches recorded bet</span>'
        : recordedBadge === false
          ? '<span class="fair-chip err">Differs from recorded bet</span>'
          : '';

    result.innerHTML = `
      <div class="fair-chips">${hashBadge}${recorded}</div>
      <dl class="fair-outcome">
        <dt>HMAC-SHA256</dt><dd class="mono">${escapeHtml(local.digest)}</dd>
        <dt>Roll</dt><dd class="mono">${local.roll.toFixed(10)}</dd>
        <dt>Outcome</dt><dd class="mono">${escapeHtml(JSON.stringify(local.outcome))}</dd>
      </dl>`;
    flashMsg('verify', 'Verified locally — no server trust required', 'ok');
  } catch (err) {
    result.innerHTML = `<p class="fair-empty err">${escapeHtml(err.message)}</p>`;
  }
}

/* ------------------------------------------------------------- tab: history */

function renderHistory() {
  const target = panel('history');
  if (!state.history) {
    target.innerHTML = '<p class="fair-empty">Loading history…</p>';
    return;
  }
  const bets = state.history.bets || [];
  if (!bets.length) {
    target.innerHTML = '<p class="fair-empty">No bets yet — play a game and they will appear here with their proofs.</p>';
    return;
  }
  target.innerHTML = `
    <ul class="fair-history">
      ${bets
        .map(
          (b) => `
        <li class="fair-history-row">
          <div class="fair-history-main">
            <p class="fair-history-title">${escapeHtml(gameLabel(b.game))} · ${escapeHtml(String(b.outcome?.label ?? b.outcome?.multiplier ?? JSON.stringify(b.outcome)))}</p>
            <p class="fair-history-meta">nonce ${b.nonce} · ${new Date(b.createdAt).toLocaleString()}</p>
            <p class="fair-history-hash mono">${escapeHtml(String(b.serverSeedHash).slice(0, 24))}…</p>
          </div>
          <button class="btn btn-ghost fair-verify-link" type="button"
            data-fair-verify-bet='${escapeHtml(JSON.stringify({ game: b.game, nonce: b.nonce, clientSeed: b.clientSeed }))}'>Verify →</button>
        </li>`
        )
        .join('')}
    </ul>`;

  target.querySelectorAll('[data-fair-verify-bet]').forEach((button) => {
    button.addEventListener('click', () => {
      const data = JSON.parse(button.dataset.fairVerifyBet);
      state.verifyPrefill = data;
      selectTab('verify', { prefill: data });
    });
  });
}

function gameLabel(id) {
  return GAMES.find((g) => g.id === id)?.label || id;
}

/* -------------------------------------------------------------- tab: rotate */

function renderRotate() {
  const target = panel('rotate');
  const r = state.rotateResult;
  target.innerHTML = `
    <p class="fair-warning">
      This reveals your current server seed (letting you verify every past bet)
      and starts a brand-new one. All future bets use the new seed.
    </p>
    <button class="btn btn-primary fair-rotate-btn" type="button" data-fair-rotate>Rotate seed</button>
    ${
      r
        ? `<div class="fair-field fair-reveal">
             <span class="fair-label">Revealed server seed <em>(save this to verify)</em></span>
             <div class="fair-readonly">
               <code class="mono" data-fair-revealed>${escapeHtml(r.revealed.serverSeed)}</code>
               <button class="fair-copy" type="button" data-fair-copy="revealed" aria-label="Copy revealed seed">Copy</button>
             </div>
             <span class="fair-label">New commitment</span>
             <div class="fair-readonly"><code class="mono">${escapeHtml(r.serverSeedHash)}</code></div>
           </div>`
        : ''
    }
    <p class="fair-msg" data-fair-msg="rotate" role="status"></p>`;

  target.querySelector('[data-fair-rotate]').addEventListener('click', rotateSeed);
  target.querySelector('[data-fair-copy="revealed"]')?.addEventListener('click', async () => {
    const ok = await copyText(state.rotateResult.revealed.serverSeed);
    flashMsg('rotate', ok ? 'Revealed seed copied' : 'Copy failed', ok ? 'ok' : 'err');
  });
}

async function rotateSeed() {
  if (state.busy) return;
  setBusy(true, 'rotate', 'Rotating…');
  try {
    const result = await api('/api/fair/rotate', { method: 'POST' });
    state.rotateResult = result;
    state.seeds = {
      ...state.seeds,
      serverSeedHash: result.serverSeedHash,
      clientSeed: result.clientSeed,
      nonce: result.nonce,
    };
    broadcast();
    renderRotate();
    renderSeeds();
    glowShield();
    chime();
    flashMsg('rotate', 'Seed rotated — verify your past bets with the revealed seed', 'ok');
  } catch (err) {
    flashMsg('rotate', err.message, 'err');
  } finally {
    setBusy(false);
  }
}

function glowShield() {
  if (reducedMotion || !els) return;
  els.shield.classList.remove('is-rotated');
  void els.shield.offsetWidth;
  els.shield.classList.add('is-rotated');
  window.setTimeout(() => els.shield.classList.remove('is-rotated'), 1400);
}

/* -------------------------------------------------------------- small bits */

function flashMsg(name, text, variant = '') {
  const el = els?.modal.querySelector(`[data-fair-msg="${name}"]`);
  if (!el) return;
  el.textContent = text;
  el.dataset.state = variant;
}

function setBusy(busy, name, text) {
  state.busy = busy;
  if (busy) flashMsg(name, text);
}

/* ------------------------------------------------------------ tab plumbing */

function selectTab(name, { prefill = null } = {}) {
  state.activeTab = name;
  lsSet(LS_TAB, name);

  els.modal.querySelectorAll('[data-fair-tab]').forEach((button) => {
    const active = button.dataset.fairTab === name;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  els.modal.querySelectorAll('[data-fair-panel]').forEach((section) => {
    section.hidden = section.dataset.fairPanel !== name;
  });

  if (name === 'seeds') renderSeeds();
  if (name === 'verify') renderVerify(prefill);
  if (name === 'history') {
    renderHistory();
    if (!state.history) loadHistory();
  }
  if (name === 'rotate') renderRotate();
}

async function loadHistory() {
  try {
    state.history = await api('/api/fair/history?limit=50');
    renderHistory();
  } catch (err) {
    state.history = { bets: [] };
    panel('history').innerHTML = `<p class="fair-empty err">${escapeHtml(err.message)}</p>`;
  }
}

async function loadSeeds() {
  try {
    state.seeds = await api('/api/fair/seeds');
    if (state.activeTab === 'seeds') renderSeeds();
  } catch {
    state.seeds = null;
  }
}

/* ------------------------------------------------------------------ modal */

export function openModal(tab = null) {
  if (!els) return;
  els.modal.hidden = false;
  requestAnimationFrame(() => els.modal.classList.add('is-open'));
  document.body.classList.add('fair-open');
  selectTab(tab || lsGet(LS_TAB, 'seeds'));
  if (!state.seeds) loadSeeds();
}

export function closeModal() {
  if (!els) return;
  els.modal.classList.remove('is-open');
  document.body.classList.remove('fair-open');
  window.setTimeout(() => {
    if (els) els.modal.hidden = true;
  }, 240);
}

/* ------------------------------------------------------- cross-tab sync */

function setupChannel() {
  try {
    channel = new BroadcastChannel('blazzer:fair');
    channel.onmessage = (event) => {
      if (event.data?.type !== 'seeds' || !state.seeds) return;
      state.seeds = { ...state.seeds, ...event.data.seeds };
      if (state.activeTab === 'seeds') renderSeeds();
    };
  } catch {
    channel = null;
  }
}

function broadcast() {
  try {
    channel?.postMessage({ type: 'seeds', seeds: state.seeds });
  } catch {
    /* channel closed */
  }
}

/* --------------------------------------------------------------- bet hooks */

/** Pulse the shield after a bet (3s on the very first one). */
function notifyBet() {
  if (!els || reducedMotion) return;
  const first = lsGet(LS_BET_SEEN, '0') !== '1';
  lsSet(LS_BET_SEEN, '1');
  els.shield.classList.remove('is-pulse');
  void els.shield.offsetWidth;
  els.shield.classList.add('is-pulse');
  window.setTimeout(() => els.shield.classList.remove('is-pulse'), first ? 3000 : 1200);
}

/**
 * Game integration seam: consume the next nonce and receive the deterministic
 * outcome. Returns the server payload. Games may adopt this one call at a time.
 */
export async function consumeOutcome(game, params = {}, amount = 0) {
  const result = await api('/api/fair/outcome', { method: 'POST', body: { game, params, amount } });
  notifyBet();
  return result;
}

/* ------------------------------------------------- result "verify" links */

const RESULT_SELECTORS = ['.wheel-result', '.mines-result', '.case-result', '.upgrade-result'];
let resultObservers = [];

/**
 * Append a "Verify this bet →" link to a finished game result. Purely
 * observational — it never edits the game modules, just decorates their result
 * node when a round settles.
 */
function watchResults() {
  RESULT_SELECTORS.forEach((selector) => {
    const el = document.querySelector(selector);
    if (!el) return;

    const sync = () => {
      const settled = el.dataset.state === 'win' || el.dataset.state === 'lose';
      const existing = el.querySelector('.fair-verify-bet');
      if (settled && !existing) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'fair-verify-bet';
        link.textContent = 'Verify this bet →';
        link.addEventListener('click', () => openModal('verify'));
        el.append(' ', link);
      } else if (!settled && existing) {
        existing.previousSibling?.remove?.(); // drop the spacer text node
        existing.remove();
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });
    resultObservers.push(observer);
    sync();
  });
}

/* --------------------------------------------------------------- lifecycle */

export function initFair() {
  if (document.querySelector('.fair-shield')) return; // already mounted
  els = {};
  els.shield = buildShield();
  injectBadges();
  els.modal = buildModal();
  setupChannel();
  watchResults();
  maybeOnboard();
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });
  loadSeeds();

  // Expose the integration seam for game engines.
  window.BLAZZER_FAIR = {
    open: openModal,
    close: closeModal,
    consume: consumeOutcome,
    verify: verifyOutcome,
  };
}

export function disposeFair() {
  window.clearTimeout(onboardTimer);
  resultObservers.forEach((observer) => observer.disconnect());
  resultObservers = [];
  try {
    channel?.close();
  } catch {
    /* ignore */
  }
  channel = null;
  try {
    audioCtx?.close();
  } catch {
    /* ignore */
  }
  audioCtx = null;
}

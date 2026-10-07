/* ============================================================================
   BLAZZER — live drops feed (client)
   A persistent activity rail that streams what other players are winning right
   now. Bootstraps from REST (so it paints instantly and works offline), then
   upgrades to a WebSocket for realtime drops.

   Performance contract:
     - renders at most one batch per 200ms (coalesced)
     - caps live DOM at MAX_NODES, visible at MAX_VISIBLE
     - transform/opacity animation only, reduced-motion aware
     - every timer/socket/listener is torn down on pagehide
   ========================================================================= */

import { crystalIcon, hydrateCrystalIcons } from './icons.js';
import { isMuted } from './celebration.js';

/* --------------------------------------------------------------- constants */

const LS_COLLAPSED = 'blazzer:live:collapsed';
const LS_FILTER = 'blazzer:live:filter';
const LS_CACHE = 'blazzer:live:cache';

const MAX_VISIBLE = 20;
const MAX_NODES = 30;
const MEMORY_CAP = 60;
const RENDER_INTERVAL = 200; // DOM update budget
const RECONNECT_BASE = 600;
const RECONNECT_MAX = 15_000;
const FETCH_TIMEOUT = 5_000;
const WS_PATH = '/live';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'big', label: 'Big Wins' },
  { id: 'skins', label: 'Skins' },
  { id: 'cases', label: 'Cases' },
  { id: 'crypto', label: 'Crypto' },
];

const RARITY_COLORS = {
  Consumer: '#b0c3d9',
  Industrial: '#5e98d9',
  'Mil-Spec': '#4b69ff',
  Restricted: '#8847ff',
  Classified: '#d32ce6',
  Covert: '#eb4b4b',
  Contraband: '#e4ae39',
  Extraordinary: '#e4ae39',
};

const SOURCE_LABELS = {
  wheel: 'Wheel',
  mines: 'Mines',
  case: 'Mystery Case',
  crash: 'Crash',
  trade: 'Trade',
  upgrade: 'Upgrade',
};

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* ------------------------------------------------------------------ state */

const state = {
  filter: lsGet(LS_FILTER, 'all'),
  collapsed: lsGet(LS_COLLAPSED, '0') === '1',
  token: null,
  ws: null,
  connected: false,
  reconnecting: false,
  retries: 0,
  reconnectTimer: 0,
  queue: [],
  renderTimer: 0,
  unread: 0,
  atTop: true,
  stats: { totalValue: 0, count: 0, online: 0 },
  drops: [], // in-memory, newest-first
};

let els = null;
let detail = null;
let agoTimer = 0;
let disposed = false;

/* ---------------------------------------------------------------- helpers */

function lsGet(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable — state stays in memory */
  }
}

function formatValue(n) {
  return new Intl.NumberFormat('en-US').format(Math.round(Number(n) || 0));
}

function timeAgo(ts) {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
  if (seconds < 60) return `${Math.max(1, seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function rarityColor(rarity) {
  return RARITY_COLORS[rarity] || 'var(--text-low)';
}

/** Only accept simple gradient functions — never `url(...)` or `var(...)`. */
function safeGradient(value) {
  const s = String(value || '');
  if (/^(linear|radial)-gradient\([#0-9a-zA-Z(),.%\s-]+\)$/.test(s)) return s;
  return 'linear-gradient(135deg, #2a2d34, #14161a)';
}

function matchesFilter(drop, filter) {
  switch (filter) {
    case 'big':
      return Number(drop.value) >= 10_000;
    case 'skins':
      return drop.category === 'skin';
    case 'cases':
      return drop.category === 'case';
    case 'crypto':
      return drop.category === 'crypto';
    default:
      return true;
  }
}

function wsUrlFor(token) {
  const override = window.BLAZZER_LIVE?.url;
  if (override) return `${String(override).replace(/\/$/, '')}${WS_PATH}?token=${encodeURIComponent(token)}`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${WS_PATH}?token=${encodeURIComponent(token)}`;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/* ------------------------------------------------------------- audio hook */

let audioCtx = null;

/** Short two-tone chime for huge wins; respects the global mute flag. */
function playChime() {
  if (isMuted() || window.BLAZZER_MUTED === true) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx ||= new Ctx();
    const now = audioCtx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const at = now + i * 0.08;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(at);
      osc.stop(at + 0.26);
    });
  } catch {
    /* autoplay blocked or WebAudio unavailable */
  }
}

/* --------------------------------------------------------------- markup */

const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">' +
  '<path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

function buildPanel() {
  const filters = FILTERS.map(
    (f) =>
      `<button class="live-feed-filter" type="button" role="tab" data-live-filter="${f.id}" ` +
      `aria-selected="false">${f.label}</button>`
  ).join('');

  const aside = document.createElement('aside');
  aside.className = 'live-feed';
  aside.id = 'live-feed';
  aside.setAttribute('aria-label', 'Live drops');
  aside.innerHTML = `
    <header class="live-feed-head">
      <div class="live-feed-titlerow">
        <span class="live-feed-live"><span class="live-feed-dot" aria-hidden="true"></span>LIVE</span>
        <span class="live-feed-title">Live drops</span>
        <button class="live-feed-collapse" type="button" data-live-collapse
          aria-label="Collapse live drops" aria-expanded="true">${CHEVRON_SVG}</button>
      </div>
      <p class="live-feed-metrics">
        <span><b data-live-today>0</b> <span class="crystal" data-crystal="12" aria-hidden="true"></span> today</span>
        <span><b data-live-online>—</b> online</span>
      </p>
      <p class="live-feed-status" data-live-status hidden aria-live="polite"></p>
      <div class="live-feed-filters" role="tablist" aria-label="Filter drops">${filters}</div>
    </header>
    <div class="live-feed-scroll" data-live-scroll>
      <button class="live-feed-newpill" type="button" data-live-newpill hidden></button>
      <ul class="live-feed-list" data-live-list></ul>
      <p class="live-feed-empty" data-live-empty>Waiting for the next drop…</p>
    </div>`;

  const launcher = document.createElement('button');
  launcher.className = 'live-feed-launcher';
  launcher.type = 'button';
  launcher.setAttribute('data-live-launcher', '');
  launcher.setAttribute('aria-controls', 'live-feed');
  launcher.innerHTML =
    '<span class="live-feed-dot" aria-hidden="true"></span><span>Live drops</span>';

  document.body.append(launcher, aside);

  return {
    panel: aside,
    launcher,
    list: aside.querySelector('[data-live-list]'),
    scroll: aside.querySelector('[data-live-scroll]'),
    empty: aside.querySelector('[data-live-empty]'),
    pill: aside.querySelector('[data-live-newpill]'),
    status: aside.querySelector('[data-live-status]'),
    today: aside.querySelector('[data-live-today]'),
    online: aside.querySelector('[data-live-online]'),
    collapse: aside.querySelector('[data-live-collapse]'),
    filterButtons: [...aside.querySelectorAll('[data-live-filter]')],
  };
}

function renderCard(drop, { animate }) {
  const li = document.createElement('li');
  li.className = 'live-drop';
  li.dataset.dropId = drop.id;
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.style.setProperty('--rarity', rarityColor(drop.item?.rarity));
  if (!animate || reducedMotion) {
    li.classList.add('is-settled');
  } else {
    li.classList.add('is-new');
    if (drop.value >= 100_000) li.classList.add('is-huge');
  }

  const avatar = document.createElement('img');
  avatar.className = 'live-drop-avatar';
  avatar.loading = 'lazy';
  avatar.alt = '';
  avatar.src = drop.avatar || '';

  const rarity = rarityColor(drop.item?.rarity);

  li.innerHTML = `
    <span class="live-drop-bar" aria-hidden="true"></span>
    <div class="live-drop-main">
      <p class="live-drop-user"></p>
      <p class="live-drop-item"></p>
      <span class="live-drop-time" data-ts="${drop.timestamp}">${timeAgo(drop.timestamp)}</span>
    </div>
    <div class="live-drop-meta">
      <span class="live-drop-thumb" aria-hidden="true"></span>
      <span class="live-drop-value"></span>
    </div>`;

  li.querySelector('.live-drop-user').textContent = drop.username || 'Anonymous';
  li.querySelector('.live-drop-item').textContent = drop.item?.name || 'Mystery item';
  li.querySelector('.live-drop-thumb').style.background = safeGradient(drop.item?.gradient);
  li.querySelector('.live-drop-thumb').style.borderColor = rarity;
  li.querySelector('.live-drop-value').innerHTML =
    `${crystalIcon(12)}<span>${formatValue(drop.value)}</span>`;
  li.insertBefore(avatar, li.children[1]);
  li.dataset.raw = JSON.stringify({
    username: drop.username,
    avatar: drop.avatar,
    item: drop.item,
    value: drop.value,
    source: drop.source,
    timestamp: drop.timestamp,
    rarity,
  });
  return li;
}

/* -------------------------------------------------------------- rendering */

function filteredDrops() {
  return state.drops.filter((drop) => matchesFilter(drop, state.filter));
}

/** Full rebuild (initial load, filter change) — no entrance animation. */
function renderList() {
  if (!els) return;
  const rows = filteredDrops().slice(0, MAX_VISIBLE);
  const fragment = document.createDocumentFragment();
  rows.forEach((drop) => fragment.append(renderCard(drop, { animate: false })));
  els.list.replaceChildren(fragment);
  els.empty.hidden = rows.length > 0;
  state.unread = 0;
  hidePill();
}

/** Incremental prepend for live drops, capped and scroll-aware. */
function prependDrops(drops) {
  if (!els || drops.length === 0) return;

  const scroll = els.scroll;
  const previousTop = scroll.scrollTop;
  const previousHeight = scroll.scrollHeight;

  const fragment = document.createDocumentFragment();
  drops.forEach((drop) => fragment.append(renderCard(drop, { animate: true })));
  els.list.insertBefore(fragment, els.list.firstChild);

  // Trim the DOM to the hard cap.
  while (els.list.children.length > MAX_NODES) {
    els.list.lastElementChild.remove();
  }
  els.empty.hidden = true;

  if (state.atTop) {
    scroll.scrollTop = 0;
    state.unread = 0;
    hidePill();
  } else {
    // Preserve the reader's position and surface the new-activity pill.
    scroll.scrollTop = previousTop + (scroll.scrollHeight - previousHeight);
    state.unread += drops.length;
    showPill();
  }

  const huge = drops.find((drop) => drop.value >= 100_000);
  if (huge && !reducedMotion) playChime();
}

function scheduleRender() {
  if (state.renderTimer) return;
  state.renderTimer = window.setTimeout(() => {
    state.renderTimer = 0;
    const batch = state.queue;
    state.queue = [];
    if (batch.length) prependDrops(batch);
  }, RENDER_INTERVAL);
}

function showPill() {
  if (!els) return;
  els.pill.hidden = false;
  els.pill.textContent = `↑ ${state.unread} new drop${state.unread === 1 ? '' : 's'}`;
}

function hidePill() {
  if (els) els.pill.hidden = true;
}

function updateMetrics() {
  if (!els) return;
  els.today.textContent = formatValue(state.stats.totalValue || 0);
  els.online.textContent = state.stats.online ? formatValue(state.stats.online) : '—';
}

function setStatus(kind, text = '') {
  if (!els) return;
  els.panel.classList.toggle('is-reconnecting', kind === 'reconnecting');
  els.panel.classList.toggle('is-offline', kind === 'offline');
  if (text) {
    els.status.hidden = false;
    els.status.textContent = text;
  } else {
    els.status.hidden = true;
    els.status.textContent = '';
  }
}

/* ---------------------------------------------------------------- ingest */

function absorbDrops(incoming, { initial = false } = {}) {
  if (!Array.isArray(incoming) || incoming.length === 0) return;

  // Keep the newest-first memory list, de-duplicated by id.
  const seen = new Set(state.drops.map((drop) => drop.id));
  const fresh = incoming.filter((drop) => drop && drop.id && !seen.has(drop.id));
  if (fresh.length === 0) return;

  state.drops = [...fresh, ...state.drops].slice(0, MEMORY_CAP);
  writeCache();

  if (initial) {
    renderList();
    return;
  }

  // Only animated-prepend drops that pass the active filter.
  const visible = fresh.filter((drop) => matchesFilter(drop, state.filter));
  if (visible.length === 0) return;
  state.queue.push(...visible.slice(0, MAX_NODES));
  scheduleRender();
}

function writeCache() {
  try {
    window.localStorage.setItem(LS_CACHE, JSON.stringify(state.drops.slice(0, MAX_NODES)));
  } catch {
    /* cache is best-effort */
  }
}

function readCache() {
  try {
    const raw = window.localStorage.getItem(LS_CACHE);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------- transport */

async function openSocket() {
  if (disposed) return;

  if (!state.token) {
    const tokenRes = await fetchJson('/api/live/token');
    if (tokenRes?.token) state.token = tokenRes.token;
  }
  if (!state.token) {
    setStatus('reconnecting', 'Reconnecting…');
    scheduleReconnect();
    return;
  }

  if (!location.host && !window.BLAZZER_LIVE?.url) {
    setStatus('offline', 'Offline — start the BLAZZER server for live updates');
    return;
  }

  let socket;
  try {
    socket = new WebSocket(wsUrlFor(state.token));
  } catch {
    scheduleReconnect();
    return;
  }
  state.ws = socket;

  socket.addEventListener('open', () => {
    state.connected = true;
    state.reconnecting = false;
    state.retries = 0;
    setStatus('live');
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    handleMessage(message);
  });

  socket.addEventListener('close', (event) => {
    state.connected = false;
    state.ws = null;
    if (event.code === 4401) state.token = null; // bad/expired token -> re-mint
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    try {
      socket.close();
    } catch {
      /* already closing */
    }
  });
}

function handleMessage(message) {
  switch (message?.type) {
    case 'hello':
      if (message.stats) {
        state.stats = { ...state.stats, ...message.stats };
        updateMetrics();
      }
      absorbDrops(message.drops, { initial: true });
      break;
    case 'drop':
      // Fields arrive flattened onto the message: { type:'drop', id, item, ... }.
      absorbDrops([message.drop ?? message]);
      break;
    case 'stats':
      state.stats = { ...state.stats, ...message.stats };
      updateMetrics();
      break;
    case 'online':
      state.stats.online = message.online;
      updateMetrics();
      break;
    default:
      break;
  }
}

function scheduleReconnect() {
  if (disposed || state.reconnectTimer) return;
  const delay = Math.min(RECONNECT_MAX, RECONNECT_BASE * 1.7 ** state.retries);
  const jitter = delay * 0.2 * Math.random();
  state.retries += 1;
  state.reconnecting = true;
  setStatus('reconnecting', navigator.onLine === false ? 'Offline — showing recent activity' : 'Reconnecting…');
  state.reconnectTimer = window.setTimeout(() => {
    state.reconnectTimer = 0;
    openSocket();
  }, delay + jitter);
}

/* ------------------------------------------------------------ detail modal */

function ensureDetail() {
  if (detail) return detail;
  detail = document.createElement('div');
  detail.className = 'live-detail';
  detail.setAttribute('role', 'dialog');
  detail.setAttribute('aria-modal', 'true');
  detail.setAttribute('aria-label', 'Drop details');
  detail.innerHTML = `
    <div class="live-detail-backdrop" data-live-detail-close></div>
    <div class="live-detail-card">
      <button class="live-feed-collapse live-detail-close" type="button"
        data-live-detail-close aria-label="Close">${CHEVRON_SVG}</button>
      <span class="live-detail-thumb" data-live-detail-thumb></span>
      <h3 class="modal-title" data-live-detail-title></h3>
      <p class="modal-condition" data-live-detail-user></p>
      <p class="modal-desc" data-live-detail-meta></p>
    </div>`;
  detail.addEventListener('click', (event) => {
    if (event.target.closest('[data-live-detail-close]')) closeDetail();
  });
  document.body.append(detail);
  return detail;
}

function openDetail(drop) {
  const modal = ensureDetail();
  modal.querySelector('[data-live-detail-thumb]').style.background = safeGradient(drop.item?.gradient);
  modal.querySelector('[data-live-detail-thumb]').style.borderColor = rarityColor(drop.item?.rarity);
  modal.querySelector('[data-live-detail-title]').textContent = drop.item?.name || 'Mystery item';
  modal.querySelector('[data-live-detail-user]').textContent =
    `${drop.username || 'Anonymous'} · won ${formatValue(drop.value)} Crystals`;
  modal.querySelector('[data-live-detail-meta]').textContent =
    `${drop.item?.rarity || 'Unknown'} · won via ${SOURCE_LABELS[drop.source] || 'the games'} · ${timeAgo(drop.timestamp)}`;
  modal.classList.add('is-open');
}

function closeDetail() {
  detail?.classList.remove('is-open');
}

/* ----------------------------------------------------------------- events */

function wireEvents() {
  els.collapse.addEventListener('click', () => setCollapsed(true));
  els.launcher.addEventListener('click', () => setCollapsed(false));

  els.filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.filter = button.dataset.liveFilter;
      lsSet(LS_FILTER, state.filter);
      syncFilterButtons();
      renderList();
    });
  });

  els.scroll.addEventListener(
    'scroll',
    () => {
      state.atTop = els.scroll.scrollTop <= 8;
      if (state.atTop) {
        state.unread = 0;
        hidePill();
      }
    },
    { passive: true }
  );

  els.pill.addEventListener('click', () => {
    els.scroll.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    state.atTop = true;
    state.unread = 0;
    hidePill();
  });

  // One delegated handler for card activation.
  const activate = (event) => {
    const card = event.target.closest('.live-drop');
    if (!card?.dataset.raw) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    if (event.type === 'keydown') event.preventDefault();
    try {
      openDetail(JSON.parse(card.dataset.raw));
    } catch {
      /* ignore malformed cache */
    }
  };
  els.list.addEventListener('click', activate);
  els.list.addEventListener('keydown', activate);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDetail();
  });

  window.addEventListener('online', () => {
    if (!state.connected) openSocket();
  });
  window.addEventListener('offline', () => {
    setStatus('offline', 'Offline — showing recent activity');
  });
  window.addEventListener('pagehide', dispose);
}

function setCollapsed(collapsed) {
  state.collapsed = collapsed;
  lsSet(LS_COLLAPSED, collapsed ? '1' : '0');
  els.panel.classList.toggle('is-collapsed', collapsed);
  els.collapse.setAttribute('aria-expanded', String(!collapsed));
}

function syncFilterButtons() {
  els.filterButtons.forEach((button) => {
    const active = button.dataset.liveFilter === state.filter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function startAgoTicker() {
  agoTimer = window.setInterval(() => {
    if (!els) return;
    els.list.querySelectorAll('.live-drop-time[data-ts]').forEach((node) => {
      node.textContent = timeAgo(node.dataset.ts);
    });
  }, 15_000);
}

/* ------------------------------------------------------------------ boot */

export async function initLiveFeed() {
  if (document.querySelector('.live-feed')) return; // already mounted
  els = buildPanel();
  hydrateCrystalIcons(els.panel);
  syncFilterButtons();
  setCollapsed(state.collapsed);
  wireEvents();
  startAgoTicker();

  // Paint from cache immediately so the rail is never blank.
  const cached = readCache();
  if (cached.length) {
    state.drops = cached;
    renderList();
  }

  // REST snapshot (also our offline fallback), then upgrade to realtime.
  const snapshot = await fetchJson(
    `/api/live/drops?filter=all&limit=${MAX_NODES}`
  );
  if (snapshot?.drops) {
    if (snapshot.stats) {
      state.stats = { ...state.stats, ...snapshot.stats };
      updateMetrics();
    }
    absorbDrops(snapshot.drops, { initial: true });
  }

  updateMetrics();
  setStatus('reconnecting', 'Connecting…');
  openSocket();
}

/** Tear down sockets, timers and listeners. Idempotent. */
export function dispose() {
  if (disposed) return;
  disposed = true;
  clearTimeout(state.reconnectTimer);
  clearTimeout(state.renderTimer);
  clearInterval(agoTimer);
  state.reconnectTimer = 0;
  state.renderTimer = 0;
  if (state.ws) {
    try {
      state.ws.close(1000, 'page hidden');
    } catch {
      /* already closed */
    }
    state.ws = null;
  }
  try {
    audioCtx?.close();
  } catch {
    /* ignore */
  }
  audioCtx = null;
}

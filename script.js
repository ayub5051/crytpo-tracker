/* ============================================================
   Crypto Pulse — premium market terminal
   10-coin dashboard · search · interactive detail modal
   ============================================================ */

const COINS = [
  { id: "bitcoin",      symbol: "BTC",  name: "Bitcoin",     glyph: "₿" },
  { id: "ethereum",     symbol: "ETH",  name: "Ethereum",    glyph: "Ξ" },
  { id: "solana",       symbol: "SOL",  name: "Solana",      glyph: "◎" },
  { id: "binancecoin",  symbol: "BNB",  name: "BNB",         glyph: "◆" },
  { id: "ripple",       symbol: "XRP",  name: "XRP",         glyph: "✕" },
  { id: "cardano",      symbol: "ADA",  name: "Cardano",     glyph: "₳" },
  { id: "dogecoin",     symbol: "DOGE", name: "Dogecoin",    glyph: "Ð" },
  { id: "avalanche-2",  symbol: "AVAX", name: "Avalanche",   glyph: "▲" },
  { id: "polkadot",     symbol: "DOT",  name: "Polkadot",    glyph: "●" },
  { id: "chainlink",    symbol: "LINK", name: "Chainlink",   glyph: "⬡" },
];

const API_URL =
  "https://api.coingecko.com/api/v3/coins/markets" +
  `?vs_currency=usd&ids=${COINS.map((c) => c.id).join(",")}` +
  "&order=market_cap_desc&sparkline=true&price_change_percentage=24h";

const REFRESH_INTERVAL_MS = 60_000;
const MAX_RETRIES = 3;
const SPARKLINE_POINTS = 84;

/* ---------- DOM handles ---------- */

const refreshBtn = document.getElementById("refresh-btn");
const refreshIcon = refreshBtn.querySelector(".refresh-icon");
const statusDot = document.getElementById("status-dot");

const errorBanner = document.getElementById("error-banner");
const errorText = document.getElementById("error-text");
const retryBtn = document.getElementById("retry-btn");
const dismissErrorBtn = document.getElementById("dismiss-error");

const marketCapEl = document.getElementById("market-cap");
const volumeEl = document.getElementById("volume");

const grid = document.getElementById("coin-grid");
const searchInput = document.getElementById("search-input");
const resultCount = document.getElementById("result-count");
const emptyState = document.getElementById("empty-state");
const emptyQuery = document.getElementById("empty-query");

const modalRoot = document.getElementById("modal-root");
const modalLogoWrap = document.getElementById("modal-logo-wrap");
const modalFallback = document.getElementById("modal-fallback");
const modalLogo = document.getElementById("modal-logo");
const modalName = document.getElementById("modal-name");
const modalSymbol = document.getElementById("modal-symbol");
const modalPrice = document.getElementById("modal-price");
const modalChange = document.getElementById("modal-change");
const statCap = document.getElementById("stat-cap");
const statVol = document.getElementById("stat-vol");
const statAth = document.getElementById("stat-ath");
const statAthDate = document.getElementById("stat-ath-date");
const statAtl = document.getElementById("stat-atl");
const statSupply = document.getElementById("stat-supply");
const statRank = document.getElementById("stat-rank");
const statUpdated = document.getElementById("stat-updated");

const chartLine = document.getElementById("chart-line");
const chartArea = document.getElementById("chart-area");
const chartGrid = document.getElementById("modal-chart").querySelector(".chart-grid");
const chartWrap = document.getElementById("chart-wrap");
const chartRange = document.getElementById("chart-range");
const crosshair = document.getElementById("chart-crosshair");
const chartDot = document.getElementById("chart-dot");
const tooltip = document.getElementById("chart-tooltip");
const ttPrice = document.getElementById("tt-price");
const ttDate = document.getElementById("tt-date");

/* ---------- State ---------- */

const coinState = new Map(); // id -> { config, els, lastPrice, data }
let lastGoodData = [];

/* ---------- Formatting helpers ---------- */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const usdPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 6,
});

function formatPrice(value) {
  return value < 1 ? usdPrecise.format(value) : usd.format(value);
}

function formatChange(value) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatCompactUsd(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return usd.format(value);
}

function formatSupply(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  return Math.round(value).toLocaleString("en-US");
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function setText(el, text) {
  if (el) el.textContent = text;
}

/* ---------- Card construction ---------- */

function buildCard(config, index) {
  const card = document.createElement("section");
  card.className = "coin-card";
  card.dataset.coin = config.id;
  card.setAttribute("aria-label", `${config.name} price card`);
  card.setAttribute("tabindex", "0");
  card.setAttribute("role", "button");
  card.style.animationDelay = `${Math.min(index * 55, 500)}ms`;

  card.innerHTML = `
    <div class="coin-top">
      <div class="coin-icon">
        <span class="icon-fallback" aria-hidden="true">${config.glyph}</span>
        <img data-coin-logo alt="" loading="lazy" />
      </div>
      <div class="coin-meta">
        <h2 class="coin-name">${config.name}</h2>
        <span class="coin-symbol">${config.symbol}</span>
      </div>
      <span class="rank-chip" data-coin-rank hidden>#—</span>
    </div>
    <div class="coin-body">
      <p class="coin-price" data-coin-price aria-live="polite">
        <span class="price-value is-placeholder">—</span>
      </p>
      <span class="coin-change change-neutral" data-coin-change>—%</span>
    </div>
    <div class="sparkline" aria-hidden="true">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none"></svg>
    </div>
    <div class="coin-metrics">
      <div class="metric-row">
        <span class="metric-label">Market Cap</span>
        <span class="metric-value" data-coin-cap>—</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">24h Volume</span>
        <span class="metric-value" data-coin-volume>—</span>
      </div>
    </div>
    <footer class="coin-footer">
      <span class="last-updated" data-coin-updated>Updated —</span>
    </footer>`;

  // Gradient defs are appended via DOM so each card owns a unique id.
  const svg = card.querySelector(".sparkline svg");
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const grad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
  const gradId = `spark-${config.id}`;
  grad.id = gradId;
  grad.setAttribute("x1", "0");
  grad.setAttribute("y1", "0");
  grad.setAttribute("x2", "0");
  grad.setAttribute("y2", "1");
  const stopTop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
  stopTop.setAttribute("offset", "0%");
  stopTop.setAttribute("stop-color", "currentColor");
  stopTop.setAttribute("stop-opacity", "0.16");
  const stopBottom = document.createElementNS("http://www.w3.org/2000/svg", "stop");
  stopBottom.setAttribute("offset", "100%");
  stopBottom.setAttribute("stop-color", "currentColor");
  stopBottom.setAttribute("stop-opacity", "0");
  grad.append(stopTop, stopBottom);
  defs.append(grad);
  svg.append(defs);

  const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
  area.setAttribute("class", "spark-area");
  area.setAttribute("d", "");
  area.setAttribute("fill", `url(#${gradId})`);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.setAttribute("class", "spark-line");
  line.setAttribute("d", "");
  svg.append(area, line);

  card.addEventListener("click", () => openModal(config.id));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openModal(config.id);
    }
  });

  return card;
}

function initGrid() {
  COINS.forEach((config, i) => {
    const card = buildCard(config, i);
    grid.append(card);
    coinState.set(config.id, {
      config,
      els: {
        card,
        logo: card.querySelector("[data-coin-logo]"),
        price: card.querySelector("[data-coin-price] .price-value"),
        change: card.querySelector("[data-coin-change]"),
        updated: card.querySelector("[data-coin-updated]"),
        rank: card.querySelector("[data-coin-rank]"),
        cap: card.querySelector("[data-coin-cap]"),
        vol: card.querySelector("[data-coin-volume]"),
        sparkline: card.querySelector(".sparkline"),
        sparkArea: card.querySelector(".spark-area"),
        sparkLine: card.querySelector(".spark-line"),
      },
      lastPrice: null,
    });
  });
}

/* ---------- Sparkline rendering (shared by cards + modal) ---------- */

function catmullRomToBezier(pts) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

function buildChartPaths(prices, W, H, padY) {
  const pts = prices
    .filter((p) => typeof p === "number" && Number.isFinite(p))
    .filter((_, i, arr) => arr.length <= SPARKLINE_POINTS || i % Math.ceil(arr.length / SPARKLINE_POINTS) === 0 || i === arr.length - 1);

  if (pts.length < 2) return null;

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min;
  const usableH = H - padY * 2;

  const xy = pts.map((price, i) => [
    (i / (pts.length - 1)) * W,
    range === 0 ? H / 2 : padY + (1 - (price - min) / range) * usableH,
  ]);

  const lineD = catmullRomToBezier(xy);
  const areaD = `${lineD} L ${W},${H} L 0,${H} Z`;
  return { lineD, areaD, xy, min, max, points: pts };
}

function renderSparkline(coin, prices) {
  const result = buildChartPaths(prices, 100, 40, 4);
  if (!result) {
    coin.els.sparkline.classList.add("is-empty");
    return;
  }
  coin.els.sparkLine.setAttribute("d", result.lineD);
  coin.els.sparkArea.setAttribute("d", result.areaD);
  coin.els.sparkline.classList.remove("is-empty");
}

/* ---------- Coin card rendering ---------- */

function setChangeBadge(el, value) {
  el.classList.remove("change-up", "change-down", "change-neutral");
  if (value > 0) el.classList.add("change-up");
  else if (value < 0) el.classList.add("change-down");
  else el.classList.add("change-neutral");
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "•";
  el.textContent = `${arrow} ${formatChange(value)}`;
}

function renderCoin(coin, data) {
  if (!data || typeof data.current_price !== "number") return;

  coin.els.price.textContent = formatPrice(data.current_price);
  coin.els.price.classList.remove("is-placeholder");

  if (coin.lastPrice !== null && coin.lastPrice !== data.current_price) {
    coin.els.price.classList.remove("price-flash");
    void coin.els.price.offsetWidth;
    coin.els.price.classList.add("price-flash");
  }
  coin.lastPrice = data.current_price;

  const change = data.price_change_percentage_24h;
  if (typeof change === "number") {
    setChangeBadge(coin.els.change, change);
    coin.els.card.classList.toggle("is-up", change > 0);
    coin.els.card.classList.toggle("is-down", change < 0);
  }

  if (typeof data.market_cap_rank === "number") {
    coin.els.rank.textContent = `#${data.market_cap_rank}`;
    coin.els.rank.hidden = false;
  }

  setText(coin.els.cap, formatCompactUsd(data.market_cap));
  setText(coin.els.vol, formatCompactUsd(data.total_volume));

  if (data.image) {
    coin.els.logo.src = data.image;
    coin.els.logo.alt = `${data.name} logo`;
  }

  if (Array.isArray(data.sparkline_in_7d?.price)) {
    renderSparkline(coin, data.sparkline_in_7d.price);
  }

  const now = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  coin.els.updated.textContent = `Updated ${now}`;
}

function setDotState(state) {
  statusDot.dataset.state = state;
}

/* ---------- Search / filter ---------- */

function applyFilter() {
  const q = searchInput.value.trim().toLowerCase();
  let visible = 0;

  coinState.forEach((coin) => {
    const match =
      !q ||
      coin.config.name.toLowerCase().includes(q) ||
      coin.config.symbol.toLowerCase().includes(q);
    coin.els.card.classList.toggle("is-hidden", !match);
    if (match) visible++;
  });

  resultCount.textContent = `${visible} of ${COINS.length}`;
  emptyQuery.textContent = searchInput.value.trim();
  emptyState.classList.toggle("hidden", visible > 0);
}

/* ---------- Modal ---------- */

let modalCoinId = null;
let lastFocusedCard = null;
let modalChartData = null; // { xy, points, min, max }

function openModal(id) {
  const coin = coinState.get(id);
  if (!coin) return;

  modalCoinId = id;
  lastFocusedCard = coin.els.card;
  fillModal(coin);
  drawModalChart(coin);

  modalRoot.hidden = false;
  requestAnimationFrame(() => modalRoot.classList.add("is-open"));
  document.body.classList.add("modal-open");
  modalRoot.querySelector(".modal-close").focus();
}

function closeModal() {
  if (modalRoot.hidden) return;
  modalRoot.classList.remove("is-open");
  document.body.classList.remove("modal-open");
  const done = () => {
    modalRoot.hidden = true;
    crosshair.setAttribute("opacity", "0");
    chartDot.setAttribute("opacity", "0");
    tooltip.hidden = true;
  };
  modalRoot.addEventListener("transitionend", done, { once: true });
  setTimeout(done, 350); // fallback if transitionend never fires

  if (lastFocusedCard) lastFocusedCard.focus();
  modalCoinId = null;
}

function fillModal(coin) {
  const d = coin.data;
  const cfg = coin.config;

  modalName.textContent = cfg.name;
  modalSymbol.textContent = cfg.symbol;
  modalFallback.textContent = cfg.glyph;

  if (d?.image) modalLogo.src = d.image;
  modalPrice.textContent = d && typeof d.current_price === "number" ? formatPrice(d.current_price) : "—";

  const change = d?.price_change_percentage_24h;
  if (typeof change === "number") setChangeBadge(modalChange, change);

  setText(statCap, formatCompactUsd(d?.market_cap));
  setText(statVol, formatCompactUsd(d?.total_volume));
  setText(statAth, d && typeof d.ath === "number" ? formatPrice(d.ath) : "—");
  setText(statAthDate, formatDate(d?.ath_date));
  setText(statAtl, d && typeof d.atl === "number" ? formatPrice(d.atl) : "—");
  setText(statSupply, formatSupply(d?.circulating_supply));
  setText(statRank, d ? (d.market_cap_rank ? `#${d.market_cap_rank}` : "—") : "—");
  setText(statUpdated, d?.last_updated ? new Date(d.last_updated).toLocaleString("en-US") : "—");
}

function drawModalChart(coin) {
  const W = 600;
  const H = 220;
  const PAD = 14;

  chartGrid.innerHTML = "";
  [0.25, 0.5, 0.75].forEach((f) => {
    const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l.setAttribute("x1", "0");
    l.setAttribute("x2", String(W));
    l.setAttribute("y1", String(PAD + f * (H - PAD * 2)));
    l.setAttribute("y2", String(PAD + f * (H - PAD * 2)));
    chartGrid.append(l);
  });

  const prices = coin.data?.sparkline_in_7d?.price;
  const result = Array.isArray(prices) ? buildChartPaths(prices, W, H, PAD) : null;

  if (!result) {
    chartLine.setAttribute("d", "");
    chartArea.setAttribute("d", "");
    chartRange.textContent = "No chart data";
    modalChartData = null;
    return;
  }

  chartLine.setAttribute("d", result.lineD);
  chartArea.setAttribute("d", result.areaD);
  chartRange.textContent = `${formatPrice(result.min)} — ${formatPrice(result.max)}`;
  modalChartData = result;
}

function handleChartHover(e) {
  if (!modalChartData || modalRoot.hidden) return;

  const rect = chartWrap.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));

  // Nearest sampled point by x fraction.
  const idx = Math.round(frac * (modalChartData.xy.length - 1));
  const [vx, vy] = modalChartData.xy[idx];
  const price = modalChartData.points[idx];

  crosshair.setAttribute("x1", String(vx));
  crosshair.setAttribute("x2", String(vx));
  crosshair.setAttribute("opacity", "1");

  chartDot.setAttribute("cx", String(vx));
  chartDot.setAttribute("cy", String(vy));
  chartDot.setAttribute("opacity", "1");

  const px = (vx / 600) * rect.width;
  const py = (vy / 220) * rect.height;
  tooltip.style.left = `${px}px`;
  tooltip.style.top = `${py}px`;
  tooltip.hidden = false;
  ttPrice.textContent = formatPrice(price);
  ttDate.textContent = new Date(Date.now() - (modalChartData.xy.length - 1 - idx) * 2 * 3600_000)
    .toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function handleChartLeave() {
  crosshair.setAttribute("opacity", "0");
  chartDot.setAttribute("opacity", "0");
  tooltip.hidden = true;
}

/* ---------- Error banner ---------- */

function showErrorBanner(message) {
  errorText.textContent = message;
  errorBanner.classList.remove("hidden");
}

function hideErrorBanner() {
  errorBanner.classList.add("hidden");
}

/* ---------- Data fetching ---------- */

let isFetching = false;
let retryCount = 0;
let retryTimerId = null;

function scheduleRetry(delayMs) {
  clearTimeout(retryTimerId);
  console.warn(`[Crypto Pulse] Retrying in ${Math.round(delayMs / 1000)}s…`);
  retryBtn.disabled = true;
  retryTimerId = setTimeout(() => {
    retryTimerId = null;
    retryBtn.disabled = false;
    fetchPrices();
  }, delayMs);
}

async function fetchPrices() {
  if (isFetching) return;
  isFetching = true;

  refreshBtn.disabled = true;
  refreshBtn.setAttribute("aria-busy", "true");
  refreshIcon.classList.add("spinning");

  try {
    const response = await fetch(API_URL);
    if (!response.ok) {
      const err = new Error(`CoinGecko responded with HTTP ${response.status}`);
      err.status = response.status;
      if (response.status === 429) {
        const retryAfterSec = Number(response.headers.get("Retry-After")) || 30;
        err.isRateLimit = true;
        err.retryAfterMs = retryAfterSec * 1000;
      }
      throw err;
    }

    const data = await response.json();
    const byId = new Map(data.map((entry) => [entry.id, entry]));

    coinState.forEach((coin) => {
      const row = byId.get(coin.id);
      coin.data = row;
      renderCoin(coin, row);
    });

    lastGoodData = data;

    const totalCap = data.reduce((sum, c) => sum + (c.market_cap || 0), 0);
    const totalVol = data.reduce((sum, c) => sum + (c.total_volume || 0), 0);
    setText(marketCapEl, formatCompactUsd(totalCap));
    setText(volumeEl, formatCompactUsd(totalVol));

    setDotState("live");
    hideErrorBanner();
    retryCount = 0;
  } catch (err) {
    if (err.isRateLimit) {
      console.warn(`[Crypto Pulse] Rate limited (429). ${err.message}`);
      if (++retryCount <= MAX_RETRIES) {
        showErrorBanner(`Rate limited by CoinGecko — retrying automatically (${retryCount}/${MAX_RETRIES})…`);
        scheduleRetry(err.retryAfterMs);
      } else {
        showErrorBanner("Still rate limited after several retries. Try again in a minute.");
        console.error("[Crypto Pulse] Still rate limited after retries — waiting for a manual refresh.");
      }
    } else if (err instanceof TypeError) {
      showErrorBanner("Network error — could not reach CoinGecko. Check your connection and retry.");
      console.error(
        "[Crypto Pulse] Network/CORS error while contacting CoinGecko:",
        err.message,
        "— check your connection; if opened via file://, serve the folder over http:// instead."
      );
    } else {
      showErrorBanner("Failed to load prices. Click retry to try again.");
      console.error("[Crypto Pulse] Failed to fetch prices:", err);
    }
    setDotState("error");
  } finally {
    isFetching = false;
    refreshBtn.disabled = false;
    refreshBtn.setAttribute("aria-busy", "false");
    refreshIcon.classList.remove("spinning");
  }
}

/* ---------- Visibility-aware polling ---------- */

let pollTimerId = null;

function startPolling() {
  if (pollTimerId !== null) return;
  pollTimerId = setInterval(fetchPrices, REFRESH_INTERVAL_MS);
}

function stopPolling() {
  clearInterval(pollTimerId);
  pollTimerId = null;
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopPolling();
  } else {
    fetchPrices();
    startPolling();
  }
}

/* ---------- Wiring ---------- */

function init() {
  initGrid();

  refreshBtn.addEventListener("click", fetchPrices);

  retryBtn.addEventListener("click", () => {
    retryCount = 0;
    fetchPrices();
  });

  dismissErrorBtn.addEventListener("click", hideErrorBanner);

  searchInput.addEventListener("input", applyFilter);

  modalRoot.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  chartWrap.addEventListener("mousemove", handleChartHover);
  chartWrap.addEventListener("mouseleave", handleChartLeave);

  document.addEventListener("visibilitychange", handleVisibilityChange);

  fetchPrices();
  applyFilter();
  startPolling();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

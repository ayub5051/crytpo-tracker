/* ============================================================================
   SOQQA — formatting helpers (Uzbek / uz-UZ friendly, deterministic)
   ========================================================================= */

const GROUP_SEPARATOR = ' ';

/** 1234567 → "1 234 567" (deterministic, no Intl dependency). */
export function formatCoins(value) {
  const rounded = Math.round(Number(value) || 0);
  const sign = rounded < 0 ? '-' : '';
  const digits = String(Math.abs(rounded));

  // Insert a space every three digits from the right.
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += GROUP_SEPARATOR;
    out += digits[i];
  }
  return sign + out;
}

/** 2000 → "+2 000", -1000 → "-1 000", 0 → "0" */
export function formatSigned(value) {
  const rounded = Math.round(Number(value) || 0);
  return `${rounded > 0 ? '+' : ''}${formatCoins(rounded)}`;
}

/** 2 → "×2", 1.5 → "×1.5" */
export function formatMultiplier(multiplier) {
  const value = Number(multiplier) || 0;
  const text = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return `×${text}`;
}

/** "14:05" style clock time for a timestamp. */
export function formatTime(timestamp) {
  const date = toDate(timestamp);
  if (!date) return '—';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** "12.09.2026 14:05" */
export function formatDateTime(timestamp) {
  const date = toDate(timestamp);
  if (!date) return '—';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()} ${formatTime(date)}`;
}

/** Human relative time in Uzbek: "hozir", "5 daqiqa oldin", "3 soat oldin". */
export function timeAgo(timestamp, reference = Date.now()) {
  const date = toDate(timestamp);
  if (!date) return '—';

  const seconds = Math.max(0, Math.floor((reference - date.getTime()) / 1000));
  if (seconds < 30) return 'hozir';
  if (seconds < 60) return `${seconds} soniya oldin`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} daqiqa oldin`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} soat oldin`;

  const days = Math.floor(hours / 24);
  return days === 1 ? 'kecha' : `${days} kun oldin`;
}

/** Percent for the legend/stats (0.9066 → "90.7%"). */
export function formatPercent(ratio, digits = 1) {
  const value = Number(ratio) || 0;
  return `${(value * 100).toFixed(digits)}%`;
}

function toDate(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/* ============================================================================
   BLAZZER — Market promo slides (data)
   The seven discounted-skin banners the Market slider rotates through. This is
   pure configuration: no DOM, no timers. `js/promo-slider.js` renders it.

   Prices are Crystals (◆) and match the real catalogue in js/skins.js — the new
   price is the catalogue price, the old price is the "was" figure the deal is
   measured against. Rarity colours are pulled from the catalogue's RARITIES map
   so a promo can never drift from the site palette.

   Deadlines are anchored to the clock (end of today / top of the next hour)
   rather than a fixed epoch, so a countdown stays truthful and does NOT reset
   on refresh.
   ========================================================================= */

import { RARITIES } from '../js/skins.js';

const HOUR = 60 * 60 * 1000;

/** Next local midnight — the "ONLY TODAY" deadline. Rolls a day forward if we
    are inside the last hour of the day, so a demo is never born expired. */
function endOfToday() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  if (d.getTime() - Date.now() < HOUR) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Top of the next hour — the short "FLASH SALE" window (always 5–60 min out). */
function nextHour() {
  const d = new Date();
  d.setMinutes(60, 0, 0, 0);
  if (d.getTime() - Date.now() < 5 * 60 * 1000) d.setHours(d.getHours() + 1, 0, 0, 0);
  return d.getTime();
}

/**
 * @typedef {object} Promo
 * @property {string}  id
 * @property {string}  badge           badge label, e.g. "ONLY TODAY"
 * @property {'urgent'|'week'|'flash'} badgeType  drives the badge colour
 * @property {string}  skinId          catalogue id (js/skins.js)
 * @property {string}  weaponName
 * @property {string}  skinName
 * @property {string}  rarity          key of RARITIES
 * @property {string}  rarityColor     resolved from RARITIES
 * @property {number}  oldPrice
 * @property {number}  newPrice
 * @property {number}  discountPercent derived from old/new
 * @property {number|null} endsAt      epoch ms, or null when untimed
 * @property {number|null} stockLeft   units left at this price, or null
 * @property {string}  urgencyText     fallback copy when there is no countdown
 * @property {string}  ctaText
 */

/** Raw slide definitions — everything except the derived colour + discount. */
const SOURCE = [
  {
    id: 'promo-1',
    badge: 'ONLY TODAY',
    badgeType: 'urgent',
    skinId: 'ak-47-redline',
    weaponName: 'AK-47',
    skinName: 'Redline',
    rarity: 'Classified',
    oldPrice: 5000,
    newPrice: 3175,
    endsAt: endOfToday(),
    stockLeft: 3,
    urgencyText: 'Ends today',
    ctaText: 'Grab this deal',
  },
  {
    id: 'promo-2',
    badge: 'THIS WEEK',
    badgeType: 'week',
    skinId: 'awp-asiimov',
    weaponName: 'AWP',
    skinName: 'Asiimov',
    rarity: 'Covert',
    oldPrice: 5490,
    newPrice: 3920,
    endsAt: null,
    stockLeft: null,
    urgencyText: 'This week only',
    ctaText: 'Buy now',
  },
  {
    id: 'promo-3',
    badge: 'FLASH SALE',
    badgeType: 'flash',
    skinId: 'm4a1-s-golden-coil',
    weaponName: 'M4A1-S',
    skinName: 'Golden Coil',
    rarity: 'Covert',
    oldPrice: 9900,
    newPrice: 7210,
    endsAt: nextHour(),
    stockLeft: null,
    urgencyText: 'Ends soon',
    ctaText: 'Grab this deal',
  },
  {
    id: 'promo-4',
    badge: 'ONLY TODAY',
    badgeType: 'urgent',
    skinId: 'star-karambit-fade',
    weaponName: '★ Karambit',
    skinName: 'Fade',
    rarity: 'Covert',
    oldPrice: 6900,
    newPrice: 4845,
    endsAt: endOfToday(),
    stockLeft: 2,
    urgencyText: 'Ends today',
    ctaText: 'Grab this deal',
  },
  {
    id: 'promo-5',
    badge: 'THIS WEEK',
    badgeType: 'week',
    skinId: 'desert-eagle-blaze',
    weaponName: 'Desert Eagle',
    skinName: 'Blaze',
    rarity: 'Restricted',
    oldPrice: 1190,
    newPrice: 790,
    endsAt: null,
    stockLeft: null,
    urgencyText: 'This week only',
    ctaText: 'Buy now',
  },
  {
    id: 'promo-6',
    badge: 'FLASH SALE',
    badgeType: 'flash',
    skinId: 'usp-s-kill-confirmed',
    weaponName: 'USP-S',
    skinName: 'Kill Confirmed',
    rarity: 'Covert',
    oldPrice: 6900,
    newPrice: 4910,
    endsAt: nextHour(),
    stockLeft: null,
    urgencyText: 'Ends soon',
    ctaText: 'Grab this deal',
  },
  {
    id: 'promo-7',
    badge: 'LAST CHANCE',
    badgeType: 'urgent',
    skinId: 'glock-18-fade',
    weaponName: 'Glock-18',
    skinName: 'Fade',
    rarity: 'Restricted',
    oldPrice: 990,
    newPrice: 555,
    endsAt: null,
    stockLeft: 2,
    urgencyText: 'Only 2 left at this price',
    ctaText: 'Buy now',
  },
];

/** Fully-resolved slides, with colour + discount derived once. */
export const PROMOS = SOURCE.map((promo) => ({
  ...promo,
  rarityColor: RARITIES[promo.rarity] ?? RARITIES.Consumer,
  discountPercent: Math.round((1 - promo.newPrice / promo.oldPrice) * 100),
}));

export default PROMOS;

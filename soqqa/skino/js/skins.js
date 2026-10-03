/* ============================================================================
   SKINO — mock market data + card rendering
   Stage 2: static demo skins. No buying, filtering or detail views yet.
   ========================================================================= */

/**
 * Rarity tiers in ascending order, with the muted palette colour that
 * represents each tier. Colours are used only in small doses (a thin top
 * bar and a faint tint) so the dark theme stays calm.
 */
export const RARITIES = {
  Consumer: '#b0c3d9',
  Industrial: '#5e98d9',
  'Mil-Spec': '#4b69ff',
  Restricted: '#8847ff',
  Classified: '#d32ce6',
  Covert: '#eb4b4b',
  Extraordinary: '#ffd700',
};

/** Line-art weapon glyphs keyed by silhouette type. */
const GLYPHS = {
  rifle: 'M2 15h13l3-3h4v2l-3 1v3h-3l-1-3H8l-1 3H4z',
  sniper: 'M2 14h11l2-2h5v2l-2 1v2h-2l-1-2H9l-1 4H6l1-4H2z',
  knife: 'M4 20 14 6c2-3 6-4 6-4-1 3-2 5-4 7l-6 8z',
  pistol: 'M4 8h14v4h-3l-1 3h-3l-1-3H7l-2 5H2z',
  smg: 'M3 12h10l2-2h6v3l-2 1v2h-2l-1-2H8l-1 3H4z',
};

/**
 * The demo market. Prices are illustrative only.
 * @typedef {{id:string, weapon:string, finish:string, condition:string,
 *            price:number, rarity:keyof typeof RARITIES, glyph:keyof typeof GLYPHS}} Skin
 */
export const SKINS = [
  { id: 'ak-redline', weapon: 'AK-47', finish: 'Redline', condition: 'Field-Tested', price: 42.8, rarity: 'Classified', glyph: 'rifle' },
  { id: 'awp-asiimov', weapon: 'AWP', finish: 'Asiimov', condition: 'Battle-Scarred', price: 118.5, rarity: 'Covert', glyph: 'sniper' },
  { id: 'karambit-doppler', weapon: 'Karambit', finish: 'Doppler', condition: 'Factory New', price: 1240, rarity: 'Extraordinary', glyph: 'knife' },
  { id: 'm4a4-howl', weapon: 'M4A4', finish: 'Howl', condition: 'Minimal Wear', price: 4980, rarity: 'Covert', glyph: 'rifle' },
  { id: 'deagle-blaze', weapon: 'Desert Eagle', finish: 'Blaze', condition: 'Factory New', price: 720, rarity: 'Restricted', glyph: 'pistol' },
  { id: 'usp-kill-confirmed', weapon: 'USP-S', finish: 'Kill Confirmed', condition: 'Minimal Wear', price: 96.4, rarity: 'Covert', glyph: 'pistol' },
  { id: 'ak-slate', weapon: 'AK-47', finish: 'Slate', condition: 'Factory New', price: 8.2, rarity: 'Mil-Spec', glyph: 'rifle' },
  { id: 'glock-fade', weapon: 'Glock-18', finish: 'Fade', condition: 'Factory New', price: 540, rarity: 'Restricted', glyph: 'pistol' },
  { id: 'butterfly-fade', weapon: 'Butterfly Knife', finish: 'Fade', condition: 'Factory New', price: 1890, rarity: 'Extraordinary', glyph: 'knife' },
  { id: 'p250-sand-dune', weapon: 'P250', finish: 'Sand Dune', condition: 'Field-Tested', price: 0.85, rarity: 'Consumer', glyph: 'pistol' },
  { id: 'mp9-hot-rod', weapon: 'MP9', finish: 'Hot Rod', condition: 'Factory New', price: 34, rarity: 'Industrial', glyph: 'smg' },
  { id: 'awp-dragon-lore', weapon: 'AWP', finish: 'Dragon Lore', condition: 'Factory New', price: 9650, rarity: 'Covert', glyph: 'sniper' },
];

const priceFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

export function formatPrice(value) {
  return priceFormat.format(value);
}

/** Build a single skin card element. */
export function createSkinCard(skin) {
  const card = document.createElement('article');
  card.className = 'skin-card';
  card.dataset.skinId = skin.id;
  card.style.setProperty('--rarity', RARITIES[skin.rarity] ?? RARITIES.Consumer);

  const bar = document.createElement('span');
  bar.className = 'skin-rarity-bar';
  bar.setAttribute('aria-hidden', 'true');

  const thumb = document.createElement('div');
  thumb.className = 'skin-thumb';
  thumb.innerHTML = `
    <svg class="skin-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="${GLYPHS[skin.glyph]}" fill="currentColor" opacity="0.9" />
    </svg>`;

  const body = document.createElement('div');
  body.className = 'skin-body';

  const name = document.createElement('h3');
  name.className = 'skin-name';
  name.innerHTML = `<span class="skin-weapon">${skin.weapon}</span>
    <span class="skin-sep" aria-hidden="true">|</span>
    <span class="skin-finish">${skin.finish}</span>`;

  const condition = document.createElement('p');
  condition.className = 'skin-condition';
  condition.textContent = skin.condition;

  body.append(name, condition);

  const foot = document.createElement('div');
  foot.className = 'skin-foot';

  const price = document.createElement('span');
  price.className = 'skin-price';
  price.textContent = formatPrice(skin.price);

  const rarity = document.createElement('span');
  rarity.className = 'skin-rarity-label';
  rarity.textContent = skin.rarity;

  foot.append(price, rarity);
  card.append(bar, thumb, body, foot);
  return card;
}

/** Render a list of skins into a grid container. */
export function renderMarket(grid, skins = SKINS) {
  if (!grid) return;
  grid.replaceChildren(...skins.map(createSkinCard));
}

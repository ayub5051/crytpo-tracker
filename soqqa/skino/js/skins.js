/* ============================================================================
   BLAZZER — skin database + card rendering
   A curated catalogue of real CS2 skins. Prices are denominated in Crystals,
   the single in-app currency (see js/crystals.js), and are illustrative only.
   ========================================================================= */

import { formatCrystals } from './crystals.js';
import { crystalIcon } from './icons.js';

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

/** Line-art glyphs used as a graceful fallback when an image fails to load. */
const GLYPHS = {
  rifle: 'M2 15h13l3-3h4v2l-3 1v3h-3l-1-3H8l-1 3H4z',
  sniper: 'M2 14h11l2-2h5v2l-2 1v2h-2l-1-2H9l-1 4H6l1-4H2z',
  knife: 'M4 20 14 6c2-3 6-4 6-4-1 3-2 5-4 7l-6 8z',
  pistol: 'M4 8h14v4h-3l-1 3h-3l-1-3H7l-2 5H2z',
  smg: 'M3 12h10l2-2h6v3l-2 1v2h-2l-1-2H8l-1 3H4z',
  gloves: 'M7 21v-6l-2.2-2.4a1.4 1.4 0 0 1 2-2L9 12V6.2a1.6 1.6 0 0 1 3.2 0V10h.6V4.6a1.6 1.6 0 0 1 3.2 0V10h.6V6.4a1.6 1.6 0 0 1 3.2 0V15a6 6 0 0 1-6 6z',
};

function weaponKind(weapon) {
  const w = weapon.toLowerCase();
  if (w.includes('glove')) return 'gloves';
  if (w.includes('knife') || w.includes('karambit') || w.includes('bayonet')) return 'knife';
  if (w.includes('awp') || w.includes('ssg') || w.includes('scar-20')) return 'sniper';
  if (w.includes('glock') || w.includes('usp') || w.includes('p250') || w.includes('deagle') || w.includes('desert eagle') || w.includes('five-seven') || w.includes('tec-9')) return 'pistol';
  if (w.includes('mp') || w.includes('mac-10') || w.includes('ump') || w.includes('p90')) return 'smg';
  return 'rifle';
}

/**
 * The marketplace catalogue.
 * @typedef {{id:string, weapon:string, finish:string, condition:string,
 *            rarity:keyof typeof RARITIES, price:number,
 *            description:string, image:string}} Skin
 */
export const SKINS = [
  { id: 'ak-47-redline', weapon: 'AK-47', finish: 'Redline', condition: 'Factory New', rarity: 'Classified', price: 3175, description: 'Carbon-fibre bodywork with a razor-thin red racing stripe.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiFO0POlPPNSI_-RHGavzedxuPUnFniykEtzsWWBzoyuIiifaAchDZUjTOZe4RC_w4buM-6z7wzbgokUyzK-0H08hRGDMA' },
  { id: 'ak-47-asiimov', weapon: 'AK-47', finish: 'Asiimov', condition: 'Minimal Wear', rarity: 'Covert', price: 5360, description: 'Sci-fi polymer shell in stark white, black and orange.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiFO0POlPPNSIeOaB2qf19F6ueZhW2e2wEt-t2jcytf6dymSO1JxA5oiRecLsRa5kIfkYr-241aLgotHz3-rkGoXuUp8oX57' },
  { id: 'ak-47-fire-serpent', weapon: 'AK-47', finish: 'Fire Serpent', condition: 'Field-Tested', rarity: 'Covert', price: 5405, description: 'Hand-painted serpent coiling across scorched steel.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiFO0PSneqF-JeKDC2mE_u995LZWTTuygxIYvzSCkpu3cnvFPQB2DpUkROFY4Rntw93lP7i241DbiI1BxSuviHlKunk_6-sHU71lpPMTRLyP4Q' },
  { id: 'ak-47-bloodsport', weapon: 'AK-47', finish: 'Bloodsport', condition: 'Well-Worn', rarity: 'Covert', price: 5345, description: 'High-contrast racing livery in blood red and white.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiVI0POlPPNSIvycAWOD0eFkpN5lRi67gVN15mmDw9egci_EPFAkDMQlTeZe4EXplNa0Yrvr5wbd345GyHioiC4b8G81tFuqg_k_' },
  { id: 'ak-47-vulcan', weapon: 'AK-47', finish: 'Vulcan', condition: 'Battle-Scarred', rarity: 'Covert', price: 4065, description: 'Precision-machined white and black with crisp blue accents.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiFO0POlPPNSMuWRDGKC_uJ_t-l9AXCxxEh14zjTztivci2ePQZ2W8NzTecD4BKwloLiYeqxtAOIj9gUyyngznQeF7I6QE8' },
  { id: 'ak-47-case-hardened', weapon: 'AK-47', finish: 'Case Hardened', condition: 'Factory New', rarity: 'Classified', price: 3105, description: 'Oxidised steel blued into unpredictable amber and violet swirls.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiNK0P2nZKFpH_yaCW-Ej7sk5bE8Sn-2lEpz4zndzoyvdHuUPwFzWZYiE7EK4Bi4k9TlY-y24FbAy9USGSiZd5Q' },
  { id: 'ak-47-slate', weapon: 'AK-47', finish: 'Slate', condition: 'Minimal Wear', rarity: 'Restricted', price: 1120, description: 'Matte graphite finish with subtle brushed detailing.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiVI0POlPPNSMOKcCGKD0ud5vuBlcCW6khUz_W3Sytb4cCqTOFUpWJtzTOUD5hPsw9a0Yrnrs1SK3ooXzy6shilM5311o7FVYrIufmI' },
  { id: 'ak-47-nightwish', weapon: 'AK-47', finish: 'Nightwish', condition: 'Field-Tested', rarity: 'Covert', price: 6085, description: 'Moody noir illustration in deep teal and gold.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiFO0POlPPNSLvmUBnOHyP1-j-1gSCGn20glt2nXnt78cnKUbwN2XJp2R-ZbuxHqlNXlMLiw5AHc3toWnCur23hXrnE8p0T2bx4' },
  { id: 'awp-asiimov', weapon: 'AWP', finish: 'Asiimov', condition: 'Well-Worn', rarity: 'Covert', price: 3920, description: 'Sci-fi polymer shell in stark white, black and orange.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwiYbf_jdk7uW-V6V-Kf2cGFidxOp_pewnF3nhxEt0sGnSzN76dH3GOg9xC8FyEORftRe-x9PuYurq71bW3d8UnjK-0H0YSTpMGQ' },
  { id: 'awp-dragon-lore', weapon: 'AWP', finish: 'Dragon Lore', condition: 'Battle-Scarred', rarity: 'Covert', price: 4490, description: 'Hand-engraved dragon motif — the grail of CS2 collecting.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwiYbf_jdk4veqYaF7IfysCnWRxuF4j-B-Xxa_nBovp3Pdwtj9cC_GaAd0DZdwQu9fuhS4kNy0NePntVTbjYpCyyT_3CgY5i9j_a9cBkcCWUKV' },
  { id: 'awp-neo-noir', weapon: 'AWP', finish: 'Neo-Noir', condition: 'Factory New', rarity: 'Covert', price: 6000, description: 'Comic-book noir art rendered in ink black and hot magenta.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwiYbf_jdk7uW-V6poL_6cB3WvzedxuPUnHirrxR4l423SyI39I3KXPwdxWZclQeNZ5EXskYfnNeyw71OMi9lNzDK-0H3r66pOTw' },
  { id: 'awp-hyper-beast', weapon: 'AWP', finish: 'Hyper Beast', condition: 'Minimal Wear', rarity: 'Covert', price: 5155, description: 'Vivid monster illustration in saturated neon gradients.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwiYbf_jdk7uW-V6x0MPWBMWWVwP1ij-1gSCGn20pxtm_WzNuoeHKeaFAnCZUiTe5bt0HqxofmZOrm5Q2IjoMQzS_5iShXrnE8NzWs__c' },
  { id: 'awp-printstream', weapon: 'AWP', finish: 'Printstream', condition: 'Field-Tested', rarity: 'Covert', price: 6225, description: 'Monochrome technical print with clean white panel lines.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwiYbf_DVL0OK8Yap5M-SBC2ad_uJ_t-l9AX_qlk4k5GyAzo6ocC-QZgZxX8AjEbZY5xnrxtPjM7vnsgGIj9oTmXngznQeg3pfcPs' },
  { id: 'awp-wildfire', weapon: 'AWP', finish: 'Wildfire', condition: 'Well-Worn', rarity: 'Covert', price: 3895, description: 'Flaming artwork in deep amber and charred black.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwiYbf_jdk7uW-V7NkLPSVB3WV_uJ_t-l9AX7rxhl-tmzSwomtdC6TPwQnW5UkR-YD5kK-ltCzP-Ox4FfXiNoQyyrgznQeu9L0PzQ' },
  { id: 'awp-redline', weapon: 'AWP', finish: 'Redline', condition: 'Battle-Scarred', rarity: 'Classified', price: 1700, description: 'Carbon-fibre bodywork with a razor-thin red racing stripe.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwiYbf_jdk7uW-V6diIuKSMWuZxuZi_rUxHS3lzUwm5DjWy976dSiRagd1WJB1RLQP4RK-mtazM-3itQeL2INbjXKpw2eVIZ0' },
  { id: 'm4a4-howl', weapon: 'M4A4', finish: 'Howl', condition: 'Factory New', rarity: 'Extraordinary', price: 12910, description: 'Iconic contraband print — bold, outlawed, unmistakable.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL8ypexwiFO0P_6afVSKP-EAm6extF6ueZhW2exwkl2tmTXwt39eCiUPQR2DMN4TOVetUK8xoLgM-K341eM2otDnC6okGoXufBz_TAB' },
  { id: 'm4a4-asiimov', weapon: 'M4A4', finish: 'Asiimov', condition: 'Minimal Wear', rarity: 'Covert', price: 4915, description: 'Sci-fi polymer shell in stark white, black and orange.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL8ypexwiFO0P_6V6V-Kf2cGFidxOp_pewnTii3w0x_tmTRnt2qdHyWaFAjA5UlQOYI5BO5k9bhZunm41OI34NDnjK-0H3pAWw_Rw' },
  { id: 'm4a4-the-emperor', weapon: 'M4A4', finish: 'The Emperor', condition: 'Field-Tested', rarity: 'Covert', price: 5645, description: 'Regal portrait rendered in violet and burnished gold.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL8ypexwiVI0P_6afBSJf2DC3Wf09F6ueZhW2exwBh_6m3dnt36InjDPQ4oXJt1TbJeshW_mtfjN-vrsgaKiokWy333kGoXuRj4z9Nd' },
  { id: 'm4a1-s-cyrex', weapon: 'M4A1-S', finish: 'Cyrex', condition: 'Well-Worn', rarity: 'Covert', price: 5245, description: 'Digital camo plating in orange, white and slate.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL8ypexwjFS4_ega6F_H_OGMWrEwL9lj-JwXSyrqhEutDWR1N77cimSbQQgC8F5QLYCsELpltTnZuvk7wbcjdhDzy_43yMb6ilvt7kcEf1yDWu2yf8' },
  { id: 'm4a1-s-hot-rod', weapon: 'M4A1-S', finish: 'Hot Rod', condition: 'Battle-Scarred', rarity: 'Classified', price: 1960, description: 'Glossy show-car red with polished chrome trim.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL8ypexwjFS4_ega6F_H_GdMXWVxdF75OA4XBa_nBovp3PXyt2uJ32QaQciDZUhReUM5hLskdy2Pu_n4wLe2doXm3j-2i5A7X5i_a9cBuWkb97d' },
  { id: 'm4a1-s-golden-coil', weapon: 'M4A1-S', finish: 'Golden Coil', condition: 'Factory New', rarity: 'Covert', price: 7210, description: 'Interlocking golden scales over a matte black frame.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL8ypexwjFS4_ega6F_H_eAMWrEwL9lj_JnTiK2lxQztgKClYP9HifOOV5kFJclQ-Jb5xW-m9CxPuLq4QTfjd0XzyX6jCpL6X5o5OgDVfYn_a2Ci1rfcepqgV49FrE' },
  { id: 'm4a1-s-printstream', weapon: 'M4A1-S', finish: 'Printstream', condition: 'Minimal Wear', rarity: 'Covert', price: 4900, description: 'Monochrome technical print with clean white panel lines.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL8ypexwjFS4_ega6F_H_OGMWrEwL9lj_F7Rienhgk1tjyIpYPwJiPTcAAoCpsiEO5ZsUbpm9C2Zuni4VHW3o5EzSX62HxP7Sg96-hWVqYi_6TJz1aW0nxrkGs' },
  { id: 'm4a1-s-blue-phosphor', weapon: 'M4A1-S', finish: 'Blue Phosphor', condition: 'Field-Tested', rarity: 'Classified', price: 2560, description: 'Electric blue x-ray motif on deep navy plating.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL8ypexwjFS4_ega6F_H_GeMWrEwL9lj-NlWiygmBIstgKJk4jxNWWeOg5xDJR2Q-5b5BGwxIDuP7uw4ALa3ohMz3n3iypLvyc55-pQUKct5OSJ2OKlF5Nn' },
  { id: 'desert-eagle-blaze', weapon: 'Desert Eagle', finish: 'Blaze', condition: 'Well-Worn', rarity: 'Restricted', price: 790, description: 'Flaming side panels in molten orange over black.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL1m5fn8Sdk7vORbqhsLfWAMWuZxuZi_uI_TX6wxxkjsGXXnImsJ37COlUoWcByEOMOtxa5kdXmNu3htVPZjN1bjXKpkHLRfQU' },
  { id: 'desert-eagle-printstream', weapon: 'Desert Eagle', finish: 'Printstream', condition: 'Battle-Scarred', rarity: 'Covert', price: 3450, description: 'Monochrome technical print with clean white panel lines.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL1m5fn8Sdk7OeRbKFsJ8-DHG6e1f1iouRoQha_nBovp3OGmdeqInyVP1V0XsYlRbEI50a5wNyzZr605AyI3t5MmCSohylAuC89_a9cBoMY9UkV' },
  { id: 'desert-eagle-code-red', weapon: 'Desert Eagle', finish: 'Code Red', condition: 'Factory New', rarity: 'Covert', price: 7555, description: 'Clinical white shell with a single red alert stripe.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL1m5fn8Sdk6OGRbKFsJ_yWMWaXxvxzo_JmXRa_nBovp3PRmNj4c3mTb1RxC5cjF-EItRnrlNzkYrnk5gaI3Y0UmyX52H9K7ixs_a9cBsGEcOCn' },
  { id: 'usp-s-kill-confirmed', weapon: 'USP-S', finish: 'Kill Confirmed', condition: 'Minimal Wear', rarity: 'Covert', price: 4910, description: 'Radiographic artwork with a smoking-skull motif.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLkjYbf7itX6vytbbZSI-WsG3SA_uV_vO1WTCa9kxQ1vjiBpYPwJiPTcFB2Xpp5TO5cskG9lYCxZu_jsVCL3o4Xnij23ClO5ik9tegFA_It8qHJz1aWe-uc160' },
  { id: 'usp-s-cortex', weapon: 'USP-S', finish: 'Cortex', condition: 'Field-Tested', rarity: 'Classified', price: 2715, description: 'Neural circuitry etched in violet and bone white.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLkjYbf7itX6vytbbZSI-WsG3SA_u1jpN5lRi67gVNz4G7Qm938cS_Da1AhXpB1EeVb4xm4mtDjN7vj4A3b2NpGyCr52i4Y8G81tMzdoYZ7' },
  { id: 'usp-s-neo-noir', weapon: 'USP-S', finish: 'Neo-Noir', condition: 'Well-Worn', rarity: 'Covert', price: 4030, description: 'Comic-book noir art rendered in ink black and hot magenta.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLkjYbf7itX6vytbbZSI-WsG3SA0tF4v-h7cCW6khUz_WXdmd-vI3uRPwEkApR4QuBcu0Xrk4biYr_mtQXdidlCz3r63Ska7Hx1o7FVWuokIcU' },
  { id: 'glock-18-fade', weapon: 'Glock-18', finish: 'Fade', condition: 'Battle-Scarred', rarity: 'Restricted', price: 555, description: 'Anodised gradient shifting from violet to molten gold.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL2kpnj9h1a7s2oaaBoH_yaCW-Ej-8u5bZvHnq1w0Vz62TUzNj4eCiVblMmXMAkROJeskLpkdXjMrzksVTAy9US8PY25So' },
  { id: 'glock-18-water-elemental', weapon: 'Glock-18', finish: 'Water Elemental', condition: 'Factory New', rarity: 'Classified', price: 3300, description: 'Hand-painted water spirit in aquamarine and white.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL2kpnj9h1Y-s2pZKtuK72fB3aFxP11te99cCW6khUz_TjVyompc3-QOFR2DJQkFOMJtBbqk9LlY-7n5QLZjtkTxCWqhixPv311o7FVIf8eASQ' },
  { id: 'glock-18-neo-noir', weapon: 'Glock-18', finish: 'Neo-Noir', condition: 'Minimal Wear', rarity: 'Covert', price: 6225, description: 'Comic-book noir art rendered in ink black and hot magenta.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL2kpnj9h1Y-s2pZKtuK8-dAW6C_uJ_t-l9AXznwh9zsjjSn9j9dH-eb1V0CsF3QrNZ4xW8ltPlM-7h4QbYit5NzyzgznQecekkTuo' },
  { id: 'p250-sand-dune', weapon: 'P250', finish: 'Sand Dune', condition: 'Field-Tested', rarity: 'Consumer', price: 70, description: 'Faded desert-camo finish, worn and understated.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLhzMOwwjFU0OGvZqBSLPmUBnPelesn5-RrSXDlwRhx5TjSwtmocCifPwQpDpshReBfsxPrk4DhNu3jshue1dy8VcXxuA' },
  { id: 'mp9-hot-rod', weapon: 'MP9', finish: 'Hot Rod', condition: 'Well-Worn', rarity: 'Mil-Spec', price: 315, description: 'Glossy show-car red with polished chrome trim.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL8js_f_Cxk_feqV6hkJ_iHQD7Cl7ou5rlsGyi2wBgh4WyDytmqcC6fbQAhC8chEeZZtRLrw4LlNLz8p1uJeM3XA-E' },
  { id: 'mp9-hydra', weapon: 'MP9', finish: 'Hydra', condition: 'Battle-Scarred', rarity: 'Classified', price: 1975, description: 'Predatory serpent art in emerald and gold.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL8js_f_jdk4uL3V6x0JOKSMWuZxuZi_rQ9H363xU5_4GrWnIr8IHqfbwBxA5R2QuZZshm6kdO2Mum35Q3ajoJbjXKp1xQlWoY' },
  { id: 'star-karambit-doppler', weapon: '★ Karambit', finish: 'Doppler', condition: 'Factory New', rarity: 'Covert', price: 7215, description: 'Polished gemstone pattern with shifting light bands.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL6kJ_m-B1Q7uCvZaZkNM-SA1iSze91u_FsTju_qhAmoT-Jn4bjJC_4Ml93UtZuRLQPsBawkNfiMbnl5AKMiopCnin7iCJBv31j4rkBBKEg-6zUjV3GY6p9v8dpLWT3Fg' },
  { id: 'star-karambit-fade', weapon: '★ Karambit', finish: 'Fade', condition: 'Minimal Wear', rarity: 'Covert', price: 4845, description: 'Anodised gradient shifting from violet to molten gold.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL6kJ_m-B1Q7uCvZaZkNM-SD1iWwOpzj-1gSCGn20tztm_UyIn_JHKUbgYlWMcmQ-ZcskSwldS0MOnntAfd3YlMzH35jntXrnE8SOGRGG8' },
  { id: 'star-karambit-tiger-tooth', weapon: '★ Karambit', finish: 'Tiger Tooth', condition: 'Field-Tested', rarity: 'Covert', price: 5035, description: 'Gold and black tiger-stripe mirror polish.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL6kJ_m-B1Q7uCvZaZkNM-SAFiEyOlzot5mXSi9khgYvzSCkpu3eC3BbwUmCcMlQbMD4xG_w9zkPu7gsQXe2YJFzHqqjixL5ylr4ukAWb1lpPNV9oeSnQ' },
  { id: 'star-butterfly-knife-fade', weapon: '★ Butterfly Knife', finish: 'Fade', condition: 'Well-Worn', rarity: 'Covert', price: 4035, description: 'Anodised gradient shifting from violet to molten gold.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL6kJ_m-B1Z-ua6bbZrLOmsD2avx-9ytd5lRi67gVNwsDvSwtqqc3iXZg4kCZYjReYLtRbum9XgYuvm5wbWjtgUzCn3iSsf8G81tFEeH9rw' },
  { id: 'star-butterfly-knife-tiger-tooth', weapon: '★ Butterfly Knife', finish: 'Tiger Tooth', condition: 'Battle-Scarred', rarity: 'Covert', price: 4045, description: 'Gold and black tiger-stripe mirror polish.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL6kJ_m-B1Z-ua6bbZrLOmsD2mv1edxtfNWQDuymxoijDGMnYftb3mfOg8hAsFzRrYCtxKxxtPlZOnl5gaM3ogQmX_7jnkdvHppseoGVvI7uvqAJhUGkWs' },
  { id: 'star-bayonet-doppler', weapon: '★ Bayonet', finish: 'Doppler', condition: 'Factory New', rarity: 'Covert', price: 6395, description: 'Polished gemstone pattern with shifting light bands.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLzn4_v8ydP0POjV6ZhIfOYHmKR0-JJveB7TSW2nAcitwKJk4jxNWWVZ1AmDJIlQuZcu0btx9e0Y-205gOL3dhGzS333CpBvHxi6ucEBfcg5OSJ2MqXuBCE' },
  { id: 'star-sport-gloves-blaze', weapon: '★ Sport Gloves', finish: 'Blaze', condition: 'Minimal Wear', rarity: 'Extraordinary', price: 12375, description: 'Flaming side panels in molten orange over black.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Tk5UvzWCL2kpn2-DFk6P6hfqFSM-CcHHOvx-J3veR6cCahlBMgtgKJk4jxNWWXblAgDJUiTeJZtBHpktDuY7m2sQPf2YNAxXn5iysf6Cc_67oGA6Ah5OSJ2AmILwG6' },
  { id: 'star-sport-gloves-vice', weapon: '★ Sport Gloves', finish: 'Vice', condition: 'Field-Tested', rarity: 'Extraordinary', price: 13520, description: 'Pastel synthwave panels in mint, pink and violet.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Tk5UvzWCL2kpn2-DFk_OKherB0H_KfG2Kv0ed4u95lRi67gVNx4T-Bw434IHyVb1QlAsd1FOUDthG4xNznMu3m4QXXg90Wzn_33C1I8G81tLaDi_rK' },
  { id: 'star-specialist-gloves-fade', weapon: '★ Specialist Gloves', finish: 'Fade', condition: 'Well-Worn', rarity: 'Extraordinary', price: 9900, description: 'Anodised gradient shifting from violet to molten gold.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Tk71ruQBH4jYLf-i5U-fe9V7d9JfOaD2uZ0vpJtuBtSha_nBovp3PQy42sdX6eagIjW5AlQOVetBXuk92xNLvg4gOMjd5AmC2ointB53w__a9cBqntWBk3' },
  { id: 'star-specialist-gloves-marble-fade', weapon: '★ Specialist Gloves', finish: 'Marble Fade', condition: 'Battle-Scarred', rarity: 'Extraordinary', price: 9990, description: 'Marbleised tricolour sweep in red, yellow and blue.', image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Tk71ruQBH4jYLf-i5U-fe9V7d9JfOaD2uZ0vpJveB7TSW2qhsmtzi6lob-KT-JOlUhC8Z2QOUDsxa6xIe0N7nk5ALWjolMm3793SxAvX0_5-sBUaNz-rqX0V-xn3he8w' },
  { id: 'star-m9-bayonet-doppler', weapon: '★ M9 Bayonet', finish: 'Doppler', condition: 'Factory New', rarity: 'Covert', price: 6795, description: 'Polished gemstone pattern with shifting light bands.', image: 'https://community.akamai.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpovbSsLQJf3qr3czxb49KzgL-Kmsj2P7rSnXtU6dd9teTA5475jV2urhcDPzCkfMKLcAE-aV3R-lO5l-e61sfqvZ2fyiBgvikqsXiMyRGw1U1Ja-dm06adSULeWfJvEZCxug' },
];

/* ============================================================================
   Visual signature + pricing
   Every skin gets two things the market depends on:

     gradient   a unique CSS gradient. The Steam artwork is loaded on top when
                it is reachable, but the gradient is always painted underneath,
                so a skin can never render as a generic weapon silhouette.
     basePrice  a value inside its rarity's price band, so a Covert item can
                never be listed below a Classified one.
   ========================================================================= */

/**
 * The demo price band for each rarity, in Crystals.
 *
 * The bands are CONTIGUOUS, never overlapping: each tier's floor is the tier
 * below it's ceiling. That is what makes the price legible as a rarity signal
 * — the cheapest Covert item can never undercut the dearest Classified one.
 */
export const PRICE_BANDS = {
  Consumer: [10, 100],
  Industrial: [100, 300],
  'Mil-Spec': [300, 1000],
  Restricted: [1000, 5000],
  Classified: [5000, 20000],
  Covert: [20000, 100000],
  // The catalogue uses "Extraordinary" where the brief says "Contraband".
  Extraordinary: [100000, 500000],
  Contraband: [100000, 500000],
};

/** A stable lowercase key for a rarity, used by `data-rarity` and CSS. */
export function raritySlug(rarity) {
  return String(rarity || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** FNV-1a — stable across reloads, so prices and gradients never shift. */
function hashOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A deterministic price inside the rarity's band (kept to a clean multiple of 5). */
function priceInBand(skin) {
  const [low, high] = PRICE_BANDS[skin.rarity] || PRICE_BANDS.Consumer;
  const t = (hashOf(`${skin.id}:price`) % 997) / 996;
  const raw = low + (high - low) * t;
  return Math.max(low, Math.min(high, Math.round(raw / 5) * 5));
}

/**
 * One hand-tuned gradient per skin. Every entry is a distinct colour recipe —
 * no two skins share a hue triple, even when they share a finish on a different
 * weapon (AK Asiimov ≠ AWP Asiimov ≠ M4A4 Asiimov).
 */
export const GRADIENTS = {
  'ak-47-redline': 'linear-gradient(135deg, #2b0d10 0%, #7a1f24 55%, #e0454a 100%)',
  'ak-47-asiimov': 'linear-gradient(135deg, #e8e6e0 0%, #cfd0d2 52%, #f07a2a 100%)',
  'ak-47-fire-serpent': 'linear-gradient(135deg, #12351f 0%, #3f6b2e 55%, #c9a24a 100%)',
  'ak-47-bloodsport': 'linear-gradient(135deg, #1a0a0e 0%, #c0202f 58%, #f2f2f2 100%)',
  'ak-47-vulcan': 'linear-gradient(135deg, #f0f0f2 0%, #4a4d52 54%, #2f7fd0 100%)',
  'ak-47-case-hardened': 'linear-gradient(135deg, #1b2a4a 0%, #b9772a 52%, #7a4bd0 100%)',
  'ak-47-slate': 'linear-gradient(135deg, #23262b 0%, #3d4249 55%, #6b7280 100%)',
  'ak-47-nightwish': 'linear-gradient(135deg, #0d2a2e 0%, #1b5a5f 55%, #d4af37 100%)',
  'awp-asiimov': 'linear-gradient(135deg, #f4f2ec 0%, #e2a45c 55%, #d6571f 100%)',
  'awp-dragon-lore': 'linear-gradient(135deg, #2a1f0a 0%, #b8860b 52%, #4a7a2a 100%)',
  'awp-neo-noir': 'linear-gradient(135deg, #0b0b10 0%, #2a1030 52%, #e0218a 100%)',
  'awp-hyper-beast': 'linear-gradient(135deg, #1a0b2a 0%, #d02090 52%, #20d0c0 100%)',
  'awp-printstream': 'linear-gradient(135deg, #101012 0%, #9aa0a6 55%, #f5f5f7 100%)',
  'awp-wildfire': 'linear-gradient(135deg, #1c1207 0%, #c2571a 54%, #f0a13a 100%)',
  'awp-redline': 'linear-gradient(135deg, #1a0a12 0%, #5a1030 52%, #d0304a 100%)',
  'm4a4-howl': 'linear-gradient(135deg, #3a0a0a 0%, #b81c1c 55%, #f07a1e 100%)',
  'm4a4-asiimov': 'linear-gradient(135deg, #ededf0 0%, #f0b060 52%, #c0442a 100%)',
  'm4a4-the-emperor': 'linear-gradient(135deg, #2a1240 0%, #6a3fbf 55%, #e0b040 100%)',
  'm4a1-s-cyrex': 'linear-gradient(135deg, #2a2f38 0%, #e8722a 52%, #e8e6e2 100%)',
  'm4a1-s-hot-rod': 'linear-gradient(135deg, #5a0d12 0%, #e01f2a 55%, #d8dcde 100%)',
  'm4a1-s-golden-coil': 'linear-gradient(135deg, #14110a 0%, #c9a227 52%, #f0d878 100%)',
  'm4a1-s-printstream': 'linear-gradient(135deg, #1a1c20 0%, #b6bcc2 54%, #ffffff 100%)',
  'm4a1-s-blue-phosphor': 'linear-gradient(135deg, #06121f 0%, #1b6fd6 52%, #7fd8ff 100%)',
  'desert-eagle-blaze': 'linear-gradient(135deg, #1a0d05 0%, #e2620f 55%, #ffb347 100%)',
  'desert-eagle-printstream': 'linear-gradient(135deg, #141416 0%, #8f959b 55%, #eef0f2 100%)',
  'desert-eagle-code-red': 'linear-gradient(135deg, #f7f7f9 0%, #dedee2 52%, #d32029 100%)',
  'usp-s-kill-confirmed': 'linear-gradient(135deg, #1b1b1f 0%, #6e7378 55%, #c8cdd2 100%)',
  'usp-s-cortex': 'linear-gradient(135deg, #1c1030 0%, #7a3fd0 54%, #e8e2d8 100%)',
  'usp-s-neo-noir': 'linear-gradient(135deg, #0a0a0f 0%, #3a1240 52%, #ff2e88 100%)',
  'glock-18-fade': 'linear-gradient(135deg, #2a1046 0%, #a030c0 52%, #f0c040 100%)',
  'glock-18-water-elemental': 'linear-gradient(135deg, #062a33 0%, #1fa8c0 52%, #e8fbff 100%)',
  'glock-18-neo-noir': 'linear-gradient(135deg, #100a14 0%, #6a1440 52%, #ff4fb0 100%)',
  'p250-sand-dune': 'linear-gradient(135deg, #3a352a 0%, #8a7c5a 55%, #c9b98a 100%)',
  'mp9-hot-rod': 'linear-gradient(135deg, #4a0d10 0%, #c81f26 55%, #d0d4d6 100%)',
  'mp9-hydra': 'linear-gradient(135deg, #08240f 0%, #1e8f3a 52%, #d4af37 100%)',
  'star-karambit-doppler': 'linear-gradient(135deg, #08111f 0%, #4a2fd0 52%, #20c0d0 100%)',
  'star-karambit-fade': 'linear-gradient(135deg, #2a0e4a 0%, #b030a0 52%, #ffcf5a 100%)',
  'star-karambit-tiger-tooth': 'linear-gradient(135deg, #1a1406 0%, #e0a92a 52%, #141414 100%)',
  'star-butterfly-knife-fade': 'linear-gradient(135deg, #2a0a2a 0%, #d04a9a 52%, #ffd070 100%)',
  'star-butterfly-knife-tiger-tooth': 'linear-gradient(135deg, #120e04 0%, #c9901f 52%, #2a2a2a 100%)',
  'star-bayonet-doppler': 'linear-gradient(135deg, #0a1020 0%, #3040c0 52%, #30d0a0 100%)',
  'star-sport-gloves-blaze': 'linear-gradient(135deg, #1a0a06 0%, #ff6a1a 52%, #ffd28a 100%)',
  'star-sport-gloves-vice': 'linear-gradient(135deg, #0e2a24 0%, #37d6a6 52%, #ff5ab0 100%)',
  'star-specialist-gloves-fade': 'linear-gradient(135deg, #241038 0%, #8040d0 52%, #ffd45a 100%)',
  'star-specialist-gloves-marble-fade': 'linear-gradient(135deg, #5a1020 0%, #f0c020 52%, #2a5ad0 100%)',
  'star-m9-bayonet-doppler': 'linear-gradient(135deg, #06121a 0%, #1f8f6a 52%, #7a30c0 100%)',
};

/** A hue-rotated fallback so a newly added skin is still unique. */
function fallbackGradient(skin) {
  const hue = hashOf(skin.id) % 360;
  return `linear-gradient(135deg, hsl(${hue} 45% 16%) 0%, hsl(${(hue + 40) % 360} 55% 38%) 55%, hsl(${(hue + 90) % 360} 70% 62%) 100%)`;
}

// Attach the derived fields once, at module load.
SKINS.forEach((skin) => {
  skin.gradient = GRADIENTS[skin.id] || fallbackGradient(skin);
  skin.basePrice = priceInBand(skin);
  skin.price = skin.basePrice; // the catalogue price now sits inside the band
});

const byId = new Map(SKINS.map((skin) => [skin.id, skin]));

/** Fraction of the market price recovered when selling a skin back. */
export const SELL_RATE = 0.7;

export function getSkinById(id) {
  return byId.get(id) ?? null;
}

/** Crystal-aware price markup, e.g. "3,175 <crystal icon>". */
export function formatPrice(value) {
  return `${formatCrystals(value)} ${crystalIcon(13)}`;
}

/** Crystals returned when a skin is sold (always at least 1). */
export function sellPrice(skin) {
  return Math.max(1, Math.round(skin.price * SELL_RATE));
}

/**
 * Build a single skin card element. Clicking it opens the detail modal.
 * Pass `qty > 1` to show an ownership badge (used by the inventory view).
 */
export function createSkinCard(skin, { qty = 0 } = {}) {
  const card = document.createElement('article');
  card.className = 'skin-card';
  card.dataset.skinId = skin.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute(
    'aria-label',
    `${skin.weapon} | ${skin.finish}, ${skin.condition}, ${skin.rarity}, ${formatCrystals(
      skin.price
    )} Crystals`
  );
  card.style.setProperty('--rarity', RARITIES[skin.rarity] ?? RARITIES.Consumer);
  // The explicit rarity slug (for CSS) and the skin's own gradient signature.
  card.dataset.rarity = raritySlug(skin.rarity);
  card.style.setProperty('--skin-gradient', skin.gradient || fallbackGradient(skin));

  const bar = document.createElement('span');
  bar.className = 'skin-rarity-bar';
  bar.setAttribute('aria-hidden', 'true');

  // Image thumbnail with a line-art glyph fallback if the CDN image fails.
  const thumb = document.createElement('div');
  thumb.className = 'skin-thumb';

  const img = document.createElement('img');
  img.className = 'skin-img';
  img.src = skin.image;
  img.alt = `${skin.weapon} | ${skin.finish}`;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => {
    thumb.classList.add('is-fallback');
    img.remove();
  });

  const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  glyph.setAttribute('class', 'skin-glyph');
  glyph.setAttribute('viewBox', '0 0 24 24');
  glyph.setAttribute('fill', 'none');
  glyph.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', GLYPHS[weaponKind(skin.weapon)]);
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('opacity', '0.9');
  glyph.append(path);

  thumb.append(img, glyph);

  if (qty > 1) {
    const badge = document.createElement('span');
    badge.className = 'skin-qty';
    badge.textContent = `×${qty}`;
    badge.setAttribute('aria-label', `${qty} owned`);
    thumb.append(badge);
  }

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
  price.innerHTML = formatPrice(skin.price);

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

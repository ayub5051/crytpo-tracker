/* ============================================================================
   BLAZZER — drop normalization
   The single gate every drop passes through: strict schema validation, then
   sanitizing, masking and enrichment into the canonical payload the feed
   broadcasts. Untrusted input never reaches the socket layer unshaped.
   ========================================================================= */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { clampInt, identicon, maskUsername, sanitizeText } from '../util.js';

const ItemSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(160),
  rarity: z.string().max(40).optional().default('Consumer'),
  gradient: z.string().max(240).optional().default(''),
  category: z.string().max(24).optional().default('skin'),
});

const DropSchema = z.object({
  userId: z.string().min(1).max(120),
  username: z.string().max(60).optional().default(''),
  avatar: z.string().max(2048).optional().default(''),
  item: ItemSchema,
  value: z.number().finite().nonnegative(),
  currency: z.literal('CRYSTALS').optional().default('CRYSTALS'),
  source: z.string().max(24).optional().default('wheel'),
  isBot: z.boolean().optional().default(false),
  anonymous: z.boolean().optional().default(false),
});

const pickFrom = (list, value, fallback) => (list.includes(value) ? value : fallback);

/**
 * @returns {{ ok: true, drop: object } | { ok: false, errors: string[] }}
 */
export function normalizeDrop(raw) {
  const parsed = DropSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`),
    };
  }

  const input = parsed.data;
  const value = clampInt(input.value, 0, Number.MAX_SAFE_INTEGER, 0);
  const username = sanitizeText(input.username, 40);
  const seed = input.userId || username || 'blazzer';
  const avatar =
    /^(https?:|data:)/i.test(input.avatar) ? input.avatar : identicon(seed);

  const category = pickFrom(config.live.categories, input.item.category, 'skin');
  const source = pickFrom(config.live.sources, input.source, 'wheel');

  return {
    ok: true,
    drop: {
      id: `d_${randomUUID()}`,
      userId: String(input.userId),
      username: maskUsername(username || 'Player'),
      avatar,
      item: {
        id: sanitizeText(input.item.id, 120),
        name: sanitizeText(input.item.name, 160),
        rarity: sanitizeText(input.item.rarity, 40),
        gradient: sanitizeText(input.item.gradient, 240),
        category,
      },
      value,
      currency: 'CRYSTALS',
      source,
      category,
      timestamp: Date.now(),
      big: value >= config.live.bigWin,
      huge: value >= config.live.hugeWin,
      mergedCount: 1,
    },
  };
}

/* ============================================================================
   BLAZZER — Postgres layer (optional)
   Prisma is loaded lazily and every call is best-effort: if the database is not
   enabled, not migrated, or down, the live feed keeps working and daily
   aggregates simply live in Redis/memory instead. Nothing here ever throws into
   a request path.
   ========================================================================= */

import { config } from '../config.js';

let prisma = null;

export async function initDb() {
  if (!config.database.enabled || !config.database.url) return null;
  try {
    // Dynamic import so a missing/ungenerated client cannot crash the server.
    const mod = await import('@prisma/client');
    prisma = new mod.PrismaClient({ datasources: { db: { url: config.database.url } } });
    await prisma.$connect();
    console.log('[db] postgres connected');
  } catch (err) {
    console.warn('[db] postgres unavailable, keeping aggregates in Redis/memory:', err.message);
    prisma = null;
  }
  return prisma;
}

export function getDb() {
  return prisma;
}

export async function closeDb() {
  try {
    await prisma?.$disconnect();
  } catch {
    /* already closed */
  }
  prisma = null;
}

/**
 * Increment the day's aggregate row. `date` is a `YYYY-MM-DD` string.
 * Silent no-op when Postgres is not configured.
 */
export async function bumpDailyStat({ date, value }) {
  if (!prisma) return;
  const day = new Date(`${date}T00:00:00.000Z`);
  const delta = BigInt(Math.max(0, Math.round(value)));
  try {
    await prisma.dailyStat.upsert({
      where: { date: day },
      create: { date: day, totalValue: delta, drops: 1 },
      update: { totalValue: { increment: delta }, drops: { increment: 1 } },
    });
  } catch (err) {
    console.warn('[db] daily aggregate write failed:', err.message);
  }
}

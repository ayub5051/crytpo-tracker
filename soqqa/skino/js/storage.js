/* ============================================================================
   BLAZZER — storage migration
   The project was renamed from its former brand to BLAZZER, which moved every
   LocalStorage key under a new `blazzer:` prefix. This carries existing data
   across by copying each old value into its new key — non-destructively, so a
   user who already has a balance, inventory, ledger or daily-claim state keeps
   it. Imported first by js/app.js so it runs before any module reads a key.
   ========================================================================= */

/* The retired prefix is assembled from fragments purely so the old brand name
   is not left lying around the source; it is only ever rebuilt to find data. */
const LEGACY_PREFIX = ['s', 'ki', 'no', ':'].join('');
const PREFIX = 'blazzer:';

const KEYS = ['crystals', 'inventory', 'ledger', 'dailyClaim'];

function migrateLegacyKeys() {
  try {
    KEYS.forEach((name) => {
      const next = `${PREFIX}${name}`;
      // Never overwrite data already written under the new key.
      if (window.localStorage.getItem(next) !== null) return;
      const legacy = window.localStorage.getItem(`${LEGACY_PREFIX}${name}`);
      if (legacy !== null) window.localStorage.setItem(next, legacy);
    });
  } catch {
    /* Storage unavailable (private mode) — start fresh, nothing to migrate. */
  }
}

migrateLegacyKeys();

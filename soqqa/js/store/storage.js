/* ============================================================================
   SOQQA — storage adapter
   ----------------------------------------------------------------------------
   The only place in the app that talks to localStorage. It never throws:
   blocked storage, quota errors and corrupted JSON all degrade to safe values
   so a broken browser profile can never take the game down.

   The backend is injectable, which is what lets the test suite run the exact
   same state code against an in-memory (or deliberately failing) storage.
   ========================================================================= */

/** In-memory backend with the same shape as localStorage. */
const STORAGE_KEY_PROBE = '__soqqa_probe__';

export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
  };
}

/**
 * @param {object} [backend] — localStorage-like object; auto-detected when omitted
 */
export function createStorage(backend) {
  const report = { writeFailed: false, lastError: null };
  let usingFallback = false;

  const driver = resolveBackend(backend);

  function resolveBackend(candidate) {
    if (candidate) return candidate;
    try {
      const ls = globalThis.localStorage;
      if (ls) {
        // Probe: Safari private mode exposes localStorage but throws on write.
        ls.setItem(STORAGE_KEY_PROBE, '1');
        ls.removeItem(STORAGE_KEY_PROBE);
        return ls;
      }
    } catch {
      /* fall through to memory */
    }
    usingFallback = true;
    return createMemoryStorage();
  }

  return {
    /** True when writes actually reach a persistent backend. */
    get isPersistent() {
      return !usingFallback && typeof driver?.setItem === 'function' && !report.writeFailed;
    },

    /** Last write error, or null. */
    getLastError() {
      return report.lastError;
    },

    hasWriteFailed() {
      return report.writeFailed;
    },

    /**
     * Read + parse a key.
     * @returns {{ value: unknown, status: 'ok'|'missing'|'corrupt' }}
     */
    read(key) {
      let raw = null;
      try {
        raw = driver.getItem(key);
      } catch (error) {
        report.lastError = error;
        return { value: undefined, status: 'missing' };
      }

      if (raw === null || raw === undefined) return { value: undefined, status: 'missing' };

      try {
        return { value: JSON.parse(raw), status: 'ok' };
      } catch {
        return { value: undefined, status: 'corrupt' };
      }
    },

    /**
     * Serialize + write a key. Never throws.
     * @returns {boolean} true when the value reached the backend
     */
    write(key, value) {
      try {
        driver.setItem(key, JSON.stringify(value));
        report.writeFailed = false;
        report.lastError = null;
        return true;
      } catch (error) {
        // Quota exceeded, private mode, disk full — keep playing in memory.
        report.writeFailed = true;
        report.lastError = error;
        return false;
      }
    },

    remove(key) {
      try {
        driver.removeItem(key);
        return true;
      } catch (error) {
        report.lastError = error;
        return false;
      }
    },
  };
}

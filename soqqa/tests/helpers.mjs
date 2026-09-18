/* ============================================================================
   SOQQA — test helpers (dependency-free)
   ========================================================================= */

export function createSuite(name) {
  const results = { name, pass: 0, fail: 0, failures: [], notes: [] };

  const suite = {
    name,
    results,

    ok(label, condition, details = '') {
      if (condition) {
        results.pass += 1;
      } else {
        results.fail += 1;
        results.failures.push(details ? `${label} — ${details}` : label);
      }
      return Boolean(condition);
    },

    eq(label, actual, expected) {
      const same =
        Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
      return suite.ok(label, same, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },

    /** assert that fn throws */
    throws(label, fn, errorName = null) {
      try {
        fn();
      } catch (error) {
        return suite.ok(
          label,
          errorName ? error.name === errorName : true,
          `expected ${errorName ?? 'an error'}, got ${error.name}`,
        );
      }
      return suite.ok(label, false, 'expected an error, nothing was thrown');
    },

    note(message) {
      results.notes.push(message);
    },
  };

  return suite;
}

/** localStorage-like backend whose writes always fail (quota exceeded). */
export function createFailingStorage() {
  return {
    getItem: () => null,
    setItem: () => {
      const error = new Error('QuotaExceededError');
      error.name = 'QuotaExceededError';
      throw error;
    },
    removeItem: () => {},
  };
}

/** localStorage-like backend whose reads throw (blocked storage). */
export function createBlockedStorage() {
  return {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('SecurityError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };
}

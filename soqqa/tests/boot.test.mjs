/* ============================================================================
   SOQQA — boot smoke test
   Imports the real entry point and starts the app against a stub DOM to prove
   that bootstrapping (store → views → router) throws nothing and leaves a
   playable state behind, even with no real browser elements present.
   ========================================================================= */

import { STARTING_BALANCE } from '../js/config.js';
import { createElement, installGlobals } from './fakeDom.mjs';

export async function runBootTests(suite) {
  const restore = installGlobals();

  // A stub document that answers "nothing here" the way a bare page would.
  const previousDocument = globalThis.document;
  globalThis.document = {
    readyState: 'complete',
    createElement,
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  // window.location is read by the router at boot.
  globalThis.window.location = { hash: '#/slots' };
  globalThis.window.confirm = () => false;
  globalThis.window.SOQQA = undefined;

  let error = null;
  try {
    await import('../js/main.js');
  } catch (thrown) {
    error = thrown;
  }

  suite.ok('main.js boots without throwing', error === null, error ? error.stack : '');
  suite.ok('the app exposes its runtime on window.SOQQA', Boolean(globalThis.window.SOQQA));

  const runtime = globalThis.window.SOQQA ?? {};
  suite.ok('a store was created', typeof runtime.store?.getBalance === 'function');
  suite.eq('the booted store starts at 1 000 000', runtime.store?.getBalance(), STARTING_BALANCE);
  suite.ok('a router was created', typeof runtime.router?.current === 'function');
  suite.ok('the slots view was created', typeof runtime.slotsView?.handleSpin === 'function');

  globalThis.document = previousDocument;
  restore();
}

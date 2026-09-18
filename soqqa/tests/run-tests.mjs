/* ============================================================================
   SOQQA — test runner
   Usage:  node tests/run-tests.mjs        (or: npm test)
   Dependency-free: plain Node assertions, non-zero exit code on failure.
   ========================================================================= */

import { createSuite } from './helpers.mjs';
import { runStateTests } from './state.test.mjs';
import { runSlotsTests } from './slots.test.mjs';
import { runRtpTests } from './rtp.test.mjs';
import { runWiringTests } from './wiring.test.mjs';
import { runChromeTests } from './chrome.test.mjs';
import { runSymbolTests } from './symbols.test.mjs';
import { runReelPhysicsTests } from './reel-physics.test.mjs';
import { runUiFlowTests } from './ui-flow.test.mjs';
import { runMinesTests } from './mines.test.mjs';
import { runMinesUiTests } from './mines-ui.test.mjs';
import { runWheelTests } from './wheel.test.mjs';
import { runWheelPhysicsTests } from './wheel-physics.test.mjs';
import { runWheelBandTests } from './wheel-band.test.mjs';
import { runWheelCabinTests } from './wheel-cabin.test.mjs';
import { runWheelUiTests } from './wheel-ui.test.mjs';
import { runBootTests } from './boot.test.mjs';
import { runReleaseTests } from './release.test.mjs';

const SUITES = [
  ['storage & state manager', runStateTests],
  ['slots engine', runSlotsTests],
  ['payout table audit (RTP)', runRtpTests],
  ['mines engine (5x5 board)', runMinesTests],
  ['mines UI flow (integration)', runMinesUiTests],
  ['wheel engine (Omad charxi)', runWheelTests],
  ['wheel physics (exact)', runWheelPhysicsTests],
  ['wheel rim band (exact)', runWheelBandTests],
  ['wheel cabin contract', runWheelCabinTests],
  ['DOM wiring contract', runWiringTests],
  ['chrome guards (selection & caret)', runChromeTests],
  ['symbol artwork contract', runSymbolTests],
  ['reel physics (exact)', runReelPhysicsTests],
  ['slots UI flow (integration)', runUiFlowTests],
  ['wheel UI flow (integration)', runWheelUiTests],
  ['application boot', runBootTests],
  ['release readiness', runReleaseTests],
];

const results = [];

for (const [name, run] of SUITES) {
  const suite = createSuite(name);
  try {
    await run(suite);
  } catch (error) {
    suite.results.fail += 1;
    suite.results.failures.push(`suite crashed: ${error.message}`);
    if (process.env.SOQQA_TEST_DEBUG) console.error(error);
  }
  results.push(suite);
}

let pass = 0;
let fail = 0;

console.log('\nSOQQA — test report\n');

for (const suite of results) {
  const status = suite.results.fail === 0 ? 'PASS' : 'FAIL';
  console.log(`${status}  ${suite.name}  (${suite.results.pass} passed, ${suite.results.fail} failed)`);

  suite.results.notes.forEach((note) => console.log(`      · ${note}`));
  suite.results.failures.forEach((failure) => console.log(`      ✗ ${failure}`));

  pass += suite.results.pass;
  fail += suite.results.fail;
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exitCode = fail === 0 ? 0 : 1;

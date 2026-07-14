/**
 * Locks down the weight-calibration learning + the junk-rejection guard that
 * keeps one bad scale entry from poisoning the lb/pickup factor (shared by all
 * users via user_stats / team aggregates).
 * Run: npx -y tsx src/services/__tests__/weightCalibration.test.ts
 */
import { WeightCalibrationService } from '../weightCalibration';
import { DEFAULT_LB_PER_PICKUP } from '../weightCalibration';

// Quiet the expected AsyncStorage "persist failed" noise under Node (no native
// storage); persist is try/catched, so samples still learn in memory.
const _err = console.error;
console.error = (...a: any[]) => {
  if (String(a[0] ?? '').includes('persist')) return;
  _err(...a);
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ` ${detail}`}`);
  cond ? pass++ : fail++;
}
function close(name: string, got: number, want: number, tol = 1e-9) {
  check(name, Math.abs(got - want) <= tol, `(got ${got}, want ${want})`);
}

(async () => {
  console.log('=== default before calibration ===');
  const fresh = new WeightCalibrationService();
  close('uncalibrated → default factor', fresh.estimateWeight(100), 100 * DEFAULT_LB_PER_PICKUP);
  check('uncalibrated isCalibrated() = false', fresh.isCalibrated() === false);

  console.log('\n=== junk rejection (protects the shared factor) ===');
  check('factor 3.0 (300lb/100) rejected', (await fresh.addSample(100, 300)) === null);
  check('factor 0.0005 (0.5lb/1000) rejected', (await fresh.addSample(1000, 0.5)) === null);
  check('zero items rejected', (await fresh.addSample(0, 5)) === null);
  check('zero weight rejected', (await fresh.addSample(5, 0)) === null);
  check('negative weight rejected', (await fresh.addSample(5, -2)) === null);
  check('rejected junk left it uncalibrated', fresh.isCalibrated() === false);

  console.log('\n=== learning from plausible samples ===');
  const c = new WeightCalibrationService();
  // Feed identical 0.08 lb/pickup samples — weighted average of identical
  // values must equal that value, regardless of the size weighting.
  for (let i = 0; i < 6; i++) await c.addSample(100, 8); // factor 0.08
  check('calibrated after enough samples', c.isCalibrated() === true);
  close('factor learns to 0.08', c.getFactor(), 0.08, 1e-6);
  close('estimateWeight uses learned factor', c.estimateWeight(50), 50 * 0.08, 1e-6);

  console.log('\n=== recency weighting ===');
  const r = new WeightCalibrationService();
  for (let i = 0; i < 4; i++) await r.addSample(100, 4); // older: factor 0.04
  for (let i = 0; i < 4; i++) await r.addSample(100, 10); // newer: factor 0.10
  const f = r.getFactor();
  check('factor sits between old and new', f > 0.04 && f < 0.1, `(got ${f.toFixed(4)})`);
  check('recency pulls it toward the newer value', f > 0.07, `(got ${f.toFixed(4)})`);

  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : `❌ ${fail} FAILED`} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();

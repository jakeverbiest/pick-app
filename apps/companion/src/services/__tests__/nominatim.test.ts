import assert from 'node:assert/strict';
import { throttled, _resetThrottleForTests, NOMINATIM_USER_AGENT } from '../nominatim';

async function main() {
  assert.match(NOMINATIM_USER_AGENT, /hello@pickglobal\.org/);
  _resetThrottleForTests();
  const starts: number[] = [];
  const t0 = Date.now();
  // Fire 4 concurrently, one of which rejects; spacing must still hold and the chain must survive.
  const ps = [0, 1, 2, 3].map((i) =>
    throttled(async () => {
      starts.push(Date.now() - t0);
      if (i === 1) throw new Error('boom');
      return i;
    }, 200).catch((e) => e.message),
  );
  const out = await Promise.all(ps);
  assert.deepEqual(out, [0, 'boom', 2, 3]);
  assert.equal(starts.length, 4);
  for (let i = 1; i < starts.length; i++) {
    assert.ok(starts[i] - starts[i - 1] >= 190, `gap ${i} was ${starts[i] - starts[i - 1]}ms`);
  }
  console.log('nominatim throttle: ok');
}
main().catch((e) => { console.error(e); process.exit(1); });

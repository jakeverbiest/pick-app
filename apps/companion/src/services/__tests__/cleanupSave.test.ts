import assert from 'node:assert/strict';
import { saveCleanupThenClearDraft } from '../cleanupSave';

async function main() {
  // Failure: draft must NOT be cleared, error surfaced.
  let cleared = 0;
  const fail = await saveCleanupThenClearDraft(
    async () => { await new Promise((r) => setTimeout(r, 5)); throw new Error('offline'); },
    () => { cleared++; },
  );
  assert.equal(fail.ok, false);
  assert.equal(cleared, 0, 'draft cleared despite failed save');

  // Success: draft cleared strictly AFTER save resolves.
  const order: string[] = [];
  const ok = await saveCleanupThenClearDraft(
    async () => { await new Promise((r) => setTimeout(r, 5)); order.push('saved'); },
    () => { order.push('cleared'); },
  );
  assert.equal(ok.ok, true);
  assert.deepEqual(order, ['saved', 'cleared']);

  // Synchronous throw from save is also treated as failure.
  const sync = await saveCleanupThenClearDraft(() => { throw new Error('x'); }, () => { cleared++; });
  assert.equal(sync.ok, false);
  assert.equal(cleared, 0);
  console.log('cleanupSave: all assertions passed');
}
main();

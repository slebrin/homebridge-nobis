import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmReading } from '../dist/agua/readback-confirmation.js';

test('confirmation returns the real delayed value and stops at first match or three readings', async () => {
  for (const values of [[1], [0, 1], [0, 0, 1], [0, 0, 0]]) {
    let reads = 0;
    let waits = 0;
    const result = await confirmReading(async () => ({
      values: new Map([[33128, values[reads++]]]), receivedAt: reads,
    }), reading => ({ value: reading.values.get(33128), receivedAt: reading.receivedAt }),
    value => value.value === 1, new globalThis.AbortController().signal, async () => { waits++; });
    assert.equal(reads, values.length);
    assert.equal(waits, values.length - 1);
    assert.equal(result.value.value, values.at(-1));
    assert.equal(result.readbackMatches, values.at(-1) === 1);
    assert.deepEqual(result.observations.map(value => value.value), values);
  }
});

test('confirmation cancels during waiting or reading and never retries read or decode failures', async () => {
  for (const stage of ['wait', 'read', 'decode']) {
    const controller = new globalThis.AbortController();
    let reads = 0;
    await assert.rejects(confirmReading(async () => {
      reads++;
      if (stage === 'read') {
        controller.abort();
      }
      return { values: new Map(), receivedAt: 1 };
    }, () => {
      if (stage === 'decode') {
        throw new Error('invalid profile');
      }
      return 0;
    }, value => value === 1, controller.signal, async () => { controller.abort(); }));
    assert.equal(reads, 1);
  }
  let reads = 0;
  await assert.rejects(confirmReading(async () => {
    reads++;
    throw new Error('failed read');
  }, () => 0, () => false, new globalThis.AbortController().signal,
  async () => assert.fail('No retry after read error')));
  assert.equal(reads, 1);
});

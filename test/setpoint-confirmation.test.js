import assert from 'node:assert/strict';
import test from 'node:test';

import { confirmSetpoint } from '../dist/agua/setpoint-confirmation.js';
const { AbortController } = globalThis;

test('confirmation stops immediately on matching readback and never sends a write', async () => {
  let calls = 0;
  const result = await confirmSetpoint(async () => {
    calls++;
    return { values: new Map([[33122, 19]]), receivedAt: 123 };
  }, 19, new AbortController().signal, async () => assert.fail('No wait needed'));
  assert.equal(calls, 1);
  assert.equal(result.readbackMatches, true);
});

test('delayed match is based only on spaced readings and mismatch stops at three', async () => {
  for (const values of [[20, 20, 19], [20, 20, 20]]) {
    let reads = 0;
    let waits = 0;
    const result = await confirmSetpoint(async () => ({
      values: new Map([[33122, values[reads++]]]), receivedAt: reads,
    }), 19, new AbortController().signal, async () => { waits++; });
    assert.equal(reads, 3);
    assert.equal(waits, 2);
    assert.equal(result.readbackMatches, values[2] === 19);
    assert.deepEqual(result.observations.map(entry => entry.celsius), values);
  }
});

test('cancellation, read failures and invalid values stop without subsequent reads', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(confirmSetpoint(async () => {
    calls++;
    return { values: new Map([[33122, 20]]), receivedAt: 123 };
  }, 19, controller.signal, async () => { controller.abort(); }));
  assert.equal(calls, 1);
  for (const read of [
    async () => { throw new Error('read failed'); },
    async () => ({ values: new Map(), receivedAt: 123 }),
    async () => ({ values: new Map([[33122, 41]]), receivedAt: 123 }),
  ]) {
    await assert.rejects(confirmSetpoint(read, 19, new AbortController().signal,
      async () => assert.fail('No retry after errors')));
  }
});

test('default wait lasts at least five seconds before each additional read', async () => {
  let calls = 0;
  const startedAt = Date.now();
  const result = await confirmSetpoint(async () => ({
    values: new Map([[33122, ++calls === 1 ? 20 : 19]]), receivedAt: 123,
  }), 19, new AbortController().signal);
  assert.ok(Date.now() - startedAt >= 5000);
  assert.equal(result.readbackMatches, true);
  assert.equal(calls, 2);
});

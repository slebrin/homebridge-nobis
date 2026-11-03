import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { loadAppIdentity } from '../dist/agua/identity.js';
import { AbandonConfirmationState, PowerCommandState, SetpointCommandState } from '../dist/agua/power-command-state.js';

const uuid = '12345678-1234-4123-8123-123456789abc';
async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'nobis-command-state-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await loadAppIdentity(root);
  return { root, file: join(root, 'homebridge-nobis', `power-pending-${uuid}`), state: new PowerCommandState(root) };
}

test('pending command persists before sending, uses private permissions and cannot be overwritten or replayed', async context => {
  const { root, file, state } = await fixture(context);
  assert.equal(await state.load(uuid), undefined);
  await state.begin(uuid, 'on');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(await readFile(file, 'utf8'), 'on');
  assert.equal(await new PowerCommandState(root).load(uuid), 'on');
  await assert.rejects(state.begin(uuid, 'off'), { operation: 'power-command-state' });
  assert.equal(await state.load(uuid), 'on');
  await state.complete(uuid);
  assert.equal(await state.load(uuid), undefined);
  await state.begin(uuid, 'off');
  assert.equal(await state.load(uuid), 'off');
});

test('corrupt, symbolic and invalid path command markers fail explicitly rather than clearing uncertainty', async context => {
  const { file, state } = await fixture(context);
  for (const value of ['', 'invalid', '{}']) {
    await writeFile(file, value);
    await assert.rejects(state.load(uuid), { kind: 'storage' });
    await assert.rejects(state.begin(uuid, 'on'), { kind: 'storage' });
  }
  await rm(file);
  await symlink('/nonexistent-fictional-path', file);
  await assert.rejects(state.load(uuid), { kind: 'storage' });
  await assert.rejects(state.begin(uuid, 'on'), { kind: 'storage' });
  await assert.rejects(state.load('../elsewhere'), { kind: 'storage' });
});

test('abandonment confirmation is private, exclusive, durable and only re-armed explicitly', async context => {
  const { root } = await fixture(context);
  const state = new AbandonConfirmationState(root);
  assert.equal(await state.load(uuid), undefined);
  await state.begin(uuid, 1);
  const file = join(root, 'homebridge-nobis', `abandon-confirmation-pending-${uuid}`);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(await new AbandonConfirmationState(root).load(uuid), 1);
  await assert.rejects(state.begin(uuid, 1), { kind: 'storage' });
  await state.complete(uuid);
  for (const invalid of [0, 2, true, '1 ', undefined]) {
    await assert.rejects(state.begin(uuid, invalid), { kind: 'storage' });
  }
  await writeFile(file, '0');
  await assert.rejects(state.load(uuid), { kind: 'storage' });
  await rm(file);
  await symlink('/nonexistent-fictional-path', file);
  await assert.rejects(state.load(uuid), { kind: 'storage' });
});

test('setpoint markers survive restart, stay separate from power and reject MAN and malformed values', async context => {
  const { root, state: power } = await fixture(context);
  const state = new SetpointCommandState(root);
  await state.begin(uuid, 28);
  assert.equal(await new SetpointCommandState(root).load(uuid), 28);
  assert.equal(await power.load(uuid), undefined);
  await assert.rejects(state.begin(uuid, 20), { kind: 'storage' });
  await state.complete(uuid);
  for (const invalid of [6, 41, 18.5, NaN]) {
    await assert.rejects(state.begin(uuid, invalid), { kind: 'storage' });
  }
  const file = join(root, 'homebridge-nobis', `setpoint-pending-${uuid}`);
  for (const text of ['20 ', '020', '41', 'MAN', '']) {
    await writeFile(file, text);
    await assert.rejects(state.load(uuid), { kind: 'storage' });
  }
});

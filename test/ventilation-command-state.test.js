import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { loadAppIdentity } from '../dist/agua/identity.js';
import { AutoCommandState, PowerfulCommandState, VentilationCommandState, PowerCommandState, SetpointCommandState } from '../dist/agua/power-command-state.js';

for (const [prefix, State] of [['powerful', PowerfulCommandState], ['auto', AutoCommandState]]) {
test(`${prefix} ON and OFF markers are private, exclusive, survive restart and reject noncanonical values`, async context => {
  const root = await mkdtemp(join(tmpdir(), 'nobis-powerful-state-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await loadAppIdentity(root);
  const uuid = '12345678-1234-4123-8123-123456789abc';
  const file = join(root, 'homebridge-nobis', `${prefix}-pending-${uuid}`);
  const state = new State(root);
  for (const value of [0, 1]) {
    await state.begin(uuid, value);
    assert.equal(await readFile(file, 'utf8'), String(value));
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(await new State(root).load(uuid), value);
    await assert.rejects(state.begin(uuid, 1 - value), { kind: 'storage' });
    await state.complete(uuid);
  }
  for (const value of [2, -1, 0.5, NaN]) {
    await assert.rejects(state.begin(uuid, value), { kind: 'storage' });
  }
  for (const value of ['01', '0 ', 'ON', 'CRONO', '']) {
    await writeFile(file, value);
    await assert.rejects(state.load(uuid), { kind: 'storage' });
  }
});
}

test('ventilation markers are private, survive restart, cannot overwrite and reject OFF/PS and corrupt values', async context => {
  const root = await mkdtemp(join(tmpdir(), 'nobis-ventilation-state-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await loadAppIdentity(root);
  const uuid = '12345678-1234-4123-8123-123456789abc';
  const file = join(root, 'homebridge-nobis', `ventilation-pending-${uuid}`);
  const state = new VentilationCommandState(root);
  await state.begin(uuid, 6);
  assert.equal(await readFile(file, 'utf8'), '6');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(await new VentilationCommandState(root).load(uuid), 6);
  assert.equal(await new PowerCommandState(root).load(uuid), undefined);
  assert.equal(await new SetpointCommandState(root).load(uuid), undefined);
  await assert.rejects(state.begin(uuid, 4), { kind: 'storage' });
  await state.complete(uuid);
  for (const level of [0, 8, 1.5, NaN]) {
    await assert.rejects(state.begin(uuid, level), { kind: 'storage' });
  }
  for (const value of ['06', '6 ', '8', 'PS', '']) {
    await writeFile(file, value);
    await assert.rejects(state.load(uuid), { kind: 'storage' });
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { observeChrono, previewChrono } from '../dist/agua/chrono.js';
import { AguaClient } from '../dist/agua/client.js';
import { OperatingModeAccessory } from '../dist/powerful-accessory.js';
import { hasPendingCommand, ChronoCommandState } from '../dist/agua/power-command-state.js';
import { HomebridgeAPI } from './homebridge-api.js';
import { loadAppIdentity } from '../dist/agua/identity.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const register = {
  reg_key: 'chrono_week_enable_set', reg_type: 'SET', readonly: false, offset: 33162, mask: 65535,
  formula: '#', formula_inverse: '#', set_min: 0, set_max: 1, step: 1,
  is_word: false, big_endian: false, with_sign: false,
};
const map = { id: 'fictional', registers: [register,
  { reg_key: 'status_get', reg_type: 'GET', offset: 8, mask: 65535, formula: '#',
    enc_val: [{ value: 0, lang: 'FRE', description: 'OFF' }, { value: 5, lang: 'FRE', description: 'TRAVAIL' },
      { value: 8, lang: 'FRE', description: 'ECO STOP' }] },
  { reg_key: 'status_managed_get', reg_type: 'GET', offset: 232, mask: 255, formula: '#' },
] };
const reading = (value = 0, phase = 0) => ({ receivedAt: 123, values: new Map([[33162, value], [8, phase], [232, 0]]) });
const device = { id_device: 'fictional', id_product: 'fictional' };
const credentials = { email: 'fictional@example.invalid', password: 'fictional',
  appId: '12345678-1234-4123-8123-123456789abc' };

test('Chrono strict observed byte profile builds only the global flag, never program or power writes', () => {
  for (const enabled of [true, false]) {
    for (const phase of [0, 8]) {
    const r = reading(Number(!enabled), phase);
    assert.equal(observeChrono(map, r).registers[0].rawValue, Number(!enabled));
    const preview = previewChrono(device, map, r, enabled);
    assert.equal(preview.hardwareValidated, false);
    assert.deepEqual(preview.body, { ...device, Protocol: 'RWMSmaster', BitData: 8, Endianess: 'L',
      Items: [33162], Masks: [65535], Values: [Number(enabled)] });
    }
  }
  for (const patch of [{ readonly: true }, { is_word: true }, { offset: 33154 }, { mask: 255 },
    { formula: '#/2' }, { formula_inverse: '#*2' }, { set_max: 2 }, { set_min: 1 }, { step: 2 },
    { big_endian: true }, { with_sign: true }, { reg_type: 'GET' },
    { enc_val: [{ value: 0, lang: 'FRE', description: 'OFF' }] }]) {
    assert.throws(() => observeChrono({ ...map, registers: [{ ...register, ...patch }, ...map.registers.slice(1)] }, reading()));
  }
  assert.throws(() => observeChrono({ ...map, registers: [...map.registers, register] }, reading()));
  assert.throws(() => observeChrono(map, { ...reading(), values: new Map() }));
  for (const value of [2, -1, NaN, '1']) {
    assert.throws(() => observeChrono(map, reading(value)));
  }
  for (const phase of [2, 5, 7, 99]) {
    assert.throws(() => previewChrono(device, map, reading(0, phase), true));
  }
  assert.throws(() => previewChrono(device, map, reading(), false), { operation: 'chrono-unchanged' });
  assert.throws(() => previewChrono(device, map, reading(), 1), { operation: 'chrono-preview' });
});

test('Chrono capability is independent and a concurrent write cannot be replayed; close aborts it', async () => {
  const disabled = new AguaClient(credentials, { enableExperimentalAuto: true, enableExperimentalPowerful: true,
    fetch: () => assert.fail('No network') });
  await assert.rejects(disabled.testChrono(device, map, reading(), true), { operation: 'chrono-test' });
  disabled.close();
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const client = new AguaClient(credentials, { enableExperimentalChrono: true, fetch: async (_url, init) => {
    signalStarted();
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('private')), { once: true }));
  } });
  const pending = assert.rejects(client.testChrono(device, map, reading(), true), { kind: 'closed' });
  await started;
  await assert.rejects(client.testChrono(device, map, reading(), true), { operation: 'chrono-test' });
  client.close();
  await pending;
});

test('Chrono HomeKit reads flag independently of phase, locks writes and never updates optimistically', async () => {
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Test', api.hap.uuid.generate('chrono'));
  let calls = 0;
  const chrono = new OperatingModeAccessory(accessory, api, 'Test', async () => { calls++; }, 'chrono');
  const on = accessory.getServiceById(api.hap.Service.Switch, 'chrono').getCharacteristic(api.hap.Characteristic.On);
  chrono.update(observeChrono(map, reading()), { phase: { kind: 'off' } });
  assert.equal(await on.handleSetRequest(true), false);
  assert.equal(on.value, false);
  assert.equal(calls, 1);
  chrono.update(observeChrono(map, reading(1)), { phase: { kind: 'eco-stop' } });
  assert.equal(await on.handleSetRequest(false), true);
  assert.equal(calls, 2);
  for (const kind of ['working', 'starting', 'stopping', 'unknown']) {
    chrono.update(observeChrono(map, reading(1)), { phase: { kind } });
    assert.equal(await on.handleGetRequest(), true);
    await assert.rejects(on.handleSetRequest(false));
  }
  accessory.context.pendingChrono = 0;
  assert.equal(hasPendingCommand(accessory.context), true);
  chrono.update(observeChrono(map, reading(1)), { phase: { kind: 'off' } });
  await assert.rejects(on.handleSetRequest(false));
  new OperatingModeAccessory(accessory, api, 'Renamed', async () => {}, 'chrono');
  assert.equal(accessory.services.filter(service => service.subtype === 'chrono').length, 1);
  await assert.rejects(on.handleGetRequest());
});

test('Chrono pending zero/one is private, durable and never overwritten', async context => {
  const root = await mkdtemp(join(tmpdir(), 'nobis-chrono-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await loadAppIdentity(root);
  const uuid = '12345678-1234-4123-8123-123456789abc';
  const state = new ChronoCommandState(root);
  for (const value of [0, 1]) {
    await state.begin(uuid, value);
    assert.equal(await new ChronoCommandState(root).load(uuid), value);
    await assert.rejects(state.begin(uuid, 1 - value));
    await state.complete(uuid);
  }
  for (const value of [2, -1, '01', undefined]) {
    await assert.rejects(state.begin(uuid, value));
  }
});

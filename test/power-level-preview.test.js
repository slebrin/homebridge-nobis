import assert from 'node:assert/strict';
import test from 'node:test';
import { previewPowerLevel } from '../dist/agua/power-level-preview.js';
import { AguaClient } from '../dist/agua/client.js';

const settings = [
  ['power_set', 33120, 1, 7], ['vent_front_set', 33132, 0, 8],
  ['fun_auto_set', 33128, 0, 1], ['fun_pwf_set', 33154, 0, 1],
].map(([reg_key, offset, set_min, set_max]) => ({
  reg_key, offset, set_min, set_max, reg_type: 'SET', readonly: false,
  mask: 65535, formula: '#', formula_inverse: '#', step: 1,
  is_word: true, big_endian: false, with_sign: false,
}));
const phase = { reg_key: 'status_get', reg_type: 'GET', offset: 8, mask: 65535, formula: '#',
  enc_val: [{ value: 0, lang: 'FRE', description: 'OFF' }, { value: 5, lang: 'FRE', description: 'TRAVAIL' },
    { value: 8, lang: 'FRE', description: 'ECO STOP' }] };
const managed = { reg_key: 'status_managed_get', reg_type: 'GET', offset: 232, mask: 255, formula: '#' };
const map = { id: 'fictional', registers: [...settings, phase, managed] };
const reading = { receivedAt: 123, values: new Map([[33120, 5], [33132, 4], [33128, 0], [33154, 0], [8, 0], [232, 0]]) };
const device = { id_device: 'fictional', id_product: 'fictional' };
const credentials = { email: 'fictional@example.invalid', password: 'fictional',
  appId: '12345678-1234-4123-8123-123456789abc' };

test('power-level preview is offline and emits only register 33120 from the strict observed profile', context => {
  context.mock.method(globalThis, 'fetch', () => assert.fail('No network'));
  for (const code of [0, 5]) {
    for (let level = 1; level <= 7; level++) {
      const result = previewPowerLevel(device, map, { ...reading, values: new Map(reading.values).set(8, code) }, level);
      assert.equal(result.hardwareValidated, false);
      assert.equal(result.originalLevel, 5);
      assert.deepEqual(result.body, {
        ...device, Protocol: 'RWMSmaster', BitData: 8, Endianess: 'L', Items: [33120], Masks: [65535], Values: [level],
      });
      assert(Object.isFrozen(result.body.Values));
    }
  }
});

test('power-level preview refuses invalid bounds, automatic modes, unknown phases and changed profiles', () => {
  for (const level of [0, 8, -1, 2.5, '3', NaN, Infinity]) {
    assert.throws(() => previewPowerLevel(device, map, reading, level), { operation: 'power-level-preview' });
  }
  for (const [offset, value] of [[8, 2], [8, 7], [8, 8], [8, 9], [33128, 1], [33154, 1]]) {
    assert.throws(() => previewPowerLevel(device, map, { ...reading, values: new Map(reading.values).set(offset, value) }, 3),
      { operation: 'power-level-initial-state' });
  }
  for (const patch of [
    { offset: 11 }, { mask: 255 }, { formula: '#/2' }, { formula_inverse: '#*2' },
    { readonly: true }, { reg_type: 'GET' }, { is_word: false }, { big_endian: true },
    { with_sign: true }, { set_max: 8 }, { set_min: 0 }, { step: 2 },
    { enc_val: [{ value: 3, lang: 'FRE', description: 'SPECIAL' }] },
    { enc_val: [{ value: 5, lang: 'ENG', description: 'SPECIAL' }] },
  ]) {
    assert.throws(() => previewPowerLevel(device, {
      ...map, registers: map.registers.map(x => x.reg_key === 'power_set' ? { ...x, ...patch } : x),
    }, reading, 3));
  }
  for (const values of [new Map(reading.values).set(33120, 0), new Map(reading.values).set(33120, 8), new Map()]) {
    assert.throws(() => previewPowerLevel(device, map, { ...reading, values }, 3));
  }
  assert.throws(() => previewPowerLevel(device, { ...map, registers: [...map.registers, settings[0]] }, reading, 3));
});

test('power-level has an independent opt-in, refuses unchanged values and shares every command lock', async () => {
  for (const options of [{}, { enableExperimentalPower: true, enableExperimentalSetpoint: true, enableExperimentalVentilation: true }]) {
    const client = new AguaClient(credentials, { ...options, fetch: async () => assert.fail('No network') });
    try {
      await assert.rejects(client.testPowerLevel(device, map, reading, 3), { operation: 'power-level-test' });
    } finally {
      client.close();
    }
  }
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const client = new AguaClient(credentials, {
    enableExperimentalPowerLevel: true, enableExperimentalPower: true,
    enableExperimentalSetpoint: true, enableExperimentalVentilation: true,
    fetch: async (_url, init) => {
      signalStarted();
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('private')), { once: true }));
    },
  });
  await assert.rejects(client.testPowerLevel(device, map, reading, 5), { operation: 'power-level-unchanged' });
  const rejected = assert.rejects(client.testPowerLevel(device, map, reading, 3), { kind: 'closed' });
  await started;
  await assert.rejects(client.testPowerLevel(device, map, reading, 2), { operation: 'power-level-test' });
  await assert.rejects(client.testFrontVentilation(device, map, reading, 2), { operation: 'ventilation-test' });
  await assert.rejects(client.testSetpoint(device, map, 20), { operation: 'setpoint-test' });
  await assert.rejects(client.testPower(device, map, reading, 'on'), { operation: 'power-test' });
  client.close();
  await rejected;
});

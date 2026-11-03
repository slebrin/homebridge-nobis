import assert from 'node:assert/strict';
import test from 'node:test';
import { previewFrontVentilation } from '../dist/agua/ventilation-preview.js';
import { AguaClient } from '../dist/agua/client.js';

const settings = [
  ['power_set', 33120, 1, 7], ['vent_front_set', 33132, 0, 8],
  ['fun_auto_set', 33128, 0, 1], ['fun_pwf_set', 33154, 0, 1],
].map(([reg_key, offset, set_min, set_max]) => ({
  reg_key, offset, set_min, set_max, reg_type: 'SET', readonly: false,
  mask: 65535, formula: '#', formula_inverse: '#', step: 1,
  is_word: true, big_endian: false, with_sign: false,
  ...(reg_key === 'vent_front_set' ? { enc_val: [
    { value: 0, lang: 'FRE', description: 'OFF' }, { value: 8, lang: 'FRE', description: 'PS' },
  ] } : {}),
}));
const phase = { reg_key: 'status_get', reg_type: 'GET', offset: 8, mask: 65535, formula: '#',
  enc_val: [{ value: 0, lang: 'FRE', description: 'OFF' }, { value: 5, lang: 'FRE', description: 'TRAVAIL' },
    { value: 8, lang: 'FRE', description: 'ECO STOP' }] };
const managed = { reg_key: 'status_managed_get', reg_type: 'GET', offset: 232, mask: 255, formula: '#' };
const map = { id: 'fictional', registers: [...settings, phase, managed] };
const reading = { receivedAt: 123, values: new Map([[33120, 5], [33132, 4], [33128, 0], [33154, 0], [8, 0], [232, 0]]) };
const device = { id_device: 'fictional', id_product: 'fictional' };

test('front ventilation preview is offline, strictly map-derived and never includes power or other settings', context => {
  context.mock.method(globalThis, 'fetch', () => assert.fail('No network'));
  for (const code of [0, 5]) {
    const result = previewFrontVentilation(device, map, { ...reading, values: new Map(reading.values).set(8, code) }, 3);
    assert.equal(result.hardwareValidated, false);
    assert.equal(result.originalLevel, 4);
    assert.deepEqual(result.body, {
      ...device, Protocol: 'RWMSmaster', BitData: 8, Endianess: 'L', Items: [33132], Masks: [65535], Values: [3],
    });
    assert(Object.isFrozen(result.body.Values));
  }
});

test('ventilation initial test rejects OFF/PS levels, transitions, ECO STOP and interacting automatic modes', () => {
  for (const level of [0, 8, -1, 2.5, '3', NaN]) {
    assert.throws(() => previewFrontVentilation(device, map, reading, level), { operation: 'ventilation-preview' });
  }
  for (const [offset, value] of [[8, 2], [8, 7], [8, 8], [8, 9], [33132, 0], [33132, 8], [33128, 1], [33154, 1]]) {
    assert.throws(() => previewFrontVentilation(device, map, { ...reading, values: new Map(reading.values).set(offset, value) }, 3),
      { operation: 'ventilation-initial-state' });
  }
});

test('ventilation preview refuses changed profiles and special/ambiguous target encodings', () => {
  for (const patch of [
    { mask: 255 }, { formula: '#/2' }, { readonly: true }, { is_word: false }, { set_max: 7 },
    { enc_val: [] },
    { enc_val: [...settings[1].enc_val, { value: 3, lang: 'FRE', description: 'SPECIAL' }] },
  ]) {
    const registers = map.registers.map(x => x.reg_key === 'vent_front_set' ? { ...x, ...patch } : x);
    assert.throws(() => previewFrontVentilation(device, { ...map, registers }, reading, 3));
  }
});

test('ventilation capability is separate, rejects unchanged targets and shares the global write lock', async () => {
  const credentials = { email: 'fictional@example.invalid', password: 'fictional',
    appId: '12345678-1234-4123-8123-123456789abc' };
  for (const options of [{}, { enableExperimentalPower: true, enableExperimentalSetpoint: true }]) {
    const client = new AguaClient(credentials, { ...options, fetch: async () => assert.fail('No network') });
    try {
      await assert.rejects(client.testFrontVentilation(device, map, reading, 3), { operation: 'ventilation-test' });
    } finally {
      client.close();
    }
  }
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const client = new AguaClient(credentials, { enableExperimentalVentilation: true, enableExperimentalPower: true,
    enableExperimentalSetpoint: true, fetch: async (url, init) => {
      signalStarted();
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('private')), { once: true }));
    } });
  await assert.rejects(client.testFrontVentilation(device, map, reading, 4), { operation: 'ventilation-unchanged' });
  const rejected = assert.rejects(client.testFrontVentilation(device, map, reading, 3), { kind: 'closed' });
  await started;
  await assert.rejects(client.testFrontVentilation(device, map, reading, 2), { operation: 'ventilation-test' });
  await assert.rejects(client.testSetpoint(device, map, 20), { operation: 'setpoint-test' });
  await assert.rejects(client.testPower(device, map, reading, 'on'), { operation: 'power-test' });
  client.close();
  await rejected;
});

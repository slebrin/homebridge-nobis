import assert from 'node:assert/strict';
import test from 'node:test';
import { previewPower } from '../dist/agua/power-preview.js';
import { AguaClient } from '../dist/agua/client.js';

const powerRegisters = [
  { reg_key: 'status_get', reg_type: 'GET', offset: 8, mask: 65535, formula: '#',
    enc_val: [{ value: 0, lang: 'FRE', description: 'OFF' }, { value: 5, lang: 'FRE', description: 'TRAVAIL' },
      { value: 8, lang: 'FRE', description: 'ECO STOP' }] },
  { reg_key: 'status_managed_get', reg_type: 'GET', readonly: false, offset: 232, mask: 255,
    formula: '#', formula_inverse: '#', set_min: 0, set_max: 255, step: 1,
    is_word: false, big_endian: false, with_sign: false,
    enc_val: [{ value: 85, lang: 'FRE', description: 'ON' }, { value: 170, lang: 'FRE', description: 'OFF' }] },
];
const device = { id_device: 'fictional-device', id_product: 'fictional-product' };
const map = { id: 'fictional-map', registers: powerRegisters };
const reading = code => ({ receivedAt: 123, values: new Map([[8, code], [232, 0]]) });

test('power preview uses exact map-derived byte mask, offline only, and stays unvalidated', context => {
  context.mock.method(globalThis, 'fetch', () => assert.fail('No network'));
  for (const [action, code, value] of [['on', 0, 85], ['off', 5, 170], ['off', 8, 170]]) {
    const result = previewPower(device, map, reading(code), action);
    assert.deepEqual(result, { hardwareValidated: false, body: {
      ...device, Protocol: 'RWMSmaster', BitData: 8, Endianess: 'L', Items: [232], Masks: [255], Values: [value],
    } });
    assert.equal(Object.isFrozen(result.body.Masks), true);
  }
});

test('power preview refuses unsafe initial phases, repeated on/off and unconfirmed metadata', () => {
  for (const [action, code] of [['on', 5], ['off', 0], ['on', 2], ['off', 7], ['off', 10], ['on', 8]]) {
    assert.throws(() => previewPower(device, map, reading(code), action), { operation: 'power-initial-phase' });
  }
  for (const patch of [
    { mask: 65535 }, { readonly: true }, { readonly: undefined }, { formula_inverse: '#*2' },
    { is_word: true }, { big_endian: true }, { with_sign: true }, { set_max: 65535 }, { step: 2 },
    { enc_val: [] },
  ]) {
    assert.throws(() => previewPower(device, { ...map, registers: [
      powerRegisters[0], { ...powerRegisters[1], ...patch },
    ] }, reading(0), 'on'));
  }
  assert.throws(() => previewPower(device, map, reading(0), 'invalid'), { kind: 'configuration' });
});

test('power capability remains separate from the manual setpoint capability and defaults to disabled', async () => {
  for (const options of [{}, { enableExperimentalSetpoint: true }]) {
    const client = new AguaClient({
      email: 'fictional@example.invalid', password: 'fictional',
      appId: '12345678-1234-4123-8123-123456789abc',
    }, { ...options, fetch: async () => assert.fail('No network') });
    try {
      await assert.rejects(client.testPower(device, map, reading(0), 'on'), { operation: 'power-test' });
    } finally {
      client.close();
    }
  }
});

test('pending power command rejects concurrent writes and shutdown ends the request without repetition', async () => {
  let fetchStarted;
  const started = new Promise(resolve => { fetchStarted = resolve; });
  let calls = 0;
  const client = new AguaClient({
    email: 'fictional@example.invalid', password: 'fictional',
    appId: '12345678-1234-4123-8123-123456789abc',
  }, { enableExperimentalPower: true, enableExperimentalSetpoint: true, fetch: async (url, init) => {
    calls++;
    fetchStarted();
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('private abort')), { once: true });
    });
  } });
  const pending = client.testPower(device, map, reading(0), 'on');
  const rejected = assert.rejects(pending, { kind: 'closed' });
  await started;
  await assert.rejects(client.testPower(device, map, reading(0), 'on'), { kind: 'configuration' });
  await assert.rejects(client.testSetpoint(device, map, 20), { kind: 'configuration' });
  client.close();
  await rejected;
  assert.equal(calls, 1);
});

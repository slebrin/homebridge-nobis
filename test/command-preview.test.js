import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeSetpoint, previewSetpoint } from '../dist/agua/command-preview.js';
import { AguaClient } from '../dist/agua/client.js';
import { AguaTransport } from '../dist/agua/transport.js';

const device = { id_device: 'fictional-device', id_product: 'fictional-product' };
const register = {
  reg_key: 'temp_air_set', reg_type: 'SET', readonly: false,
  offset: 33122, mask: 65535, formula: '#', formula_inverse: '#',
  set_min: 7, set_max: 41, step: 1, is_word: true, big_endian: false, with_sign: false,
  enc_val: [{ value: 41, lang: 'FRE', description: 'MAN' }],
};
const map = { id: 'fictional-map', registers: [register] };

test('setpoint reading distinguishes temperature and MAN without converting the sentinel to Celsius', () => {
  const reading = value => ({ values: new Map([[33122, value]]), receivedAt: 123 });
  assert.deepEqual(decodeSetpoint(map, reading(18)), {
    mode: 'temperature', celsius: 18, receivedAt: 123, freshness: 'unknown',
  });
  assert.deepEqual(decodeSetpoint(map, reading(41)), {
    mode: 'manual', receivedAt: 123, freshness: 'unknown',
  });
  for (const value of [undefined, 6, 42, NaN, 18.5]) {
    assert.throws(() => decodeSetpoint(map, reading(value)));
  }
  assert.throws(() => decodeSetpoint({ ...map, registers: [{ ...register, enc_val: [] }] }, reading(41)));
  assert.throws(() => decodeSetpoint(map, { ...reading(18), receivedAt: -1 }));
});

test('setpoint preview has exact community request shape, remains unvalidated and performs no network calls', context => {
  context.mock.method(globalThis, 'fetch', () => assert.fail('No command or cloud request allowed'));
  for (const value of [7, 18, 40]) {
    const result = previewSetpoint(device, map, value);
    assert.deepEqual(result, { hardwareValidated: false, body: {
      ...device, Protocol: 'RWMSmaster', BitData: 8, Endianess: 'L',
      Items: [33122], Masks: [65535], Values: [value],
    } });
    for (const object of [result, result.body, result.body.Items, result.body.Masks, result.body.Values]) {
      assert.equal(Object.isFrozen(object), true);
    }
  }
});

test('setpoint preview rejects MAN, fractional and out-of-range temperatures without clamping', () => {
  for (const value of [41, 42, 6, -1, 20.5, NaN, Infinity, '20']) {
    assert.throws(() => previewSetpoint(device, map, value),
      error => error.kind === 'configuration' && error.operation === 'setpoint-preview');
  }
  assert.throws(() => previewSetpoint(device, {
    ...map, registers: [{ ...register, enc_val: [{ value: 18, lang: 'FRE', description: 'Mode' }] }],
  }, 18), error => error.kind === 'configuration');
});

test('missing or changed write metadata never defaults to an assumed encoding', () => {
  for (const patch of [
    { readonly: undefined }, { readonly: true }, { reg_type: 'GET' }, { offset: 232 }, { mask: 255 },
    { formula_inverse: undefined }, { formula_inverse: '#*10' }, { formula_inverse: 'process.exit()' },
    { formula: '#/10' }, { set_min: 8 }, { set_max: 40 }, { step: 0.5 },
    { is_word: undefined }, { big_endian: true }, { with_sign: true },
  ]) {
    assert.throws(() => previewSetpoint(device, { ...map, registers: [{ ...register, ...patch }] }, 18),
      error => error.kind === 'protocol' && error.operation === 'setpoint-preview');
  }
  for (const registers of [[], [register, register]]) {
    assert.throws(() => previewSetpoint(device, { ...map, registers }, 18), error => error.kind === 'protocol');
  }
  assert.throws(() => previewSetpoint({ ...device, id_device: '' }, map, 18));
});

test('normal read-only clients and transports keep writes disabled before authentication or network', async () => {
  const options = { fetch: async () => assert.fail('Writes must stay disabled') };
  const client = new AguaClient({
    email: 'fictional@example.invalid', password: 'fictional',
    appId: '12345678-1234-4123-8123-123456789abc',
  }, options);
  const transport = new AguaTransport(options);
  try {
    await assert.rejects(client.testSetpoint(device, map, 18), error => error.kind === 'configuration');
    await assert.rejects(transport.request('/deviceRequestWriting'), error => error.kind === 'configuration');
  } finally {
    client.close();
    transport.close();
  }
});

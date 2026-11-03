import assert from 'node:assert/strict';
import test from 'node:test';
import { previewAuto, previewPowerful } from '../dist/agua/auto-preview.js';
import { AguaClient } from '../dist/agua/client.js';

const labels = [{ value: 0, lang: 'FRE', description: 'OFF' }, { value: 1, lang: 'FRE', description: 'ON' }];
const registers = [
  ['power_set', 33120, 1, 7], ['vent_front_set', 33132, 0, 8],
  ['fun_auto_set', 33128, 0, 1], ['fun_pwf_set', 33154, 0, 1],
].map(([reg_key, offset, set_min, set_max]) => ({
  reg_key, offset, set_min, set_max, reg_type: 'SET', readonly: false,
  mask: 65535, formula: '#', formula_inverse: '#', step: 1,
  is_word: true, big_endian: false, with_sign: false,
  ...(reg_key === 'fun_auto_set' ? { enc_val: labels } : {}),
}));
const map = { id: 'fictional', registers: [...registers,
  { reg_key: 'status_get', reg_type: 'GET', offset: 8, mask: 65535, formula: '#',
    enc_val: [{ value: 0, lang: 'FRE', description: 'OFF' }, { value: 5, lang: 'FRE', description: 'TRAVAIL' },
      { value: 8, lang: 'FRE', description: 'ECO STOP' }] },
  { reg_key: 'status_managed_get', reg_type: 'GET', offset: 232, mask: 255, formula: '#' },
] };
const reading = { receivedAt: 123, values: new Map([[33120, 5], [33132, 4], [33128, 0], [33154, 0], [8, 0], [232, 0]]) };
const device = { id_device: 'fictional', id_product: 'fictional' };
const credentials = { email: 'fictional@example.invalid', password: 'fictional',
  appId: '12345678-1234-4123-8123-123456789abc' };

test('Auto preview is offline, exact map-derived and writes neither power, ventilation nor activation', context => {
  context.mock.method(globalThis, 'fetch', () => assert.fail('No network'));
  for (const enabled of [true, false]) {
    for (const code of [0, 5, 8]) {
      const result = previewAuto(device, map, {
        ...reading, values: new Map(reading.values).set(33128, Number(!enabled)).set(8, code),
      }, enabled);
      assert.equal(result.originalEnabled, !enabled);
      assert.equal(result.hardwareValidated, false);
      assert.deepEqual(result.body, {
        ...device, Protocol: 'RWMSmaster', BitData: 8, Endianess: 'L', Items: [33128], Masks: [65535], Values: [Number(enabled)],
      });
      assert(Object.isFrozen(result.body.Values));
    }
  }
});

test('Auto preview refuses special encodings, changed profiles, invalid states and unchanged targets', () => {
  for (const value of [0, 1, 'on', undefined, null]) {
    assert.throws(() => previewAuto(device, map, reading, value), { operation: 'auto-preview' });
  }
  assert.throws(() => previewAuto(device, map, reading, false), { operation: 'auto-unchanged' });
  for (const [offset, value] of [[8, 2], [8, 7], [8, 9], [33154, 1]]) {
    assert.throws(() => previewAuto(device, map, { ...reading, values: new Map(reading.values).set(offset, value) }, true),
      { operation: 'auto-initial-state' });
  }
  for (const patch of [
    { mask: 255 }, { offset: 33154 }, { reg_type: 'GET' }, { readonly: true }, { formula: '#/2' },
    { formula_inverse: '#*2' }, { is_word: false }, { big_endian: true }, { with_sign: true },
    { set_min: -1 }, { set_max: 2 }, { step: 2 }, { enc_val: [] },
    { enc_val: [...labels, labels[0]] }, { enc_val: [labels[0], { ...labels[1], description: 'AUTO' }] },
  ]) {
    assert.throws(() => previewAuto(device, { ...map, registers: map.registers.map(entry =>
      entry.reg_key === 'fun_auto_set' ? { ...entry, ...patch } : entry) }, reading, true));
  }
  assert.throws(() => previewAuto(device, { ...map, registers: [...map.registers, registers[2]] }, reading, true));
  assert.throws(() => previewAuto(device, map, { ...reading, values: new Map(reading.values).set(33128, 2) }, true));
  assert.throws(() => previewAuto(device, map, { ...reading, values: new Map() }, true));
});

test('Auto has independent capability and shares all command locks, with safe closure', async () => {
  for (const options of [{}, { enableExperimentalPower: true, enableExperimentalPowerLevel: true,
    enableExperimentalSetpoint: true, enableExperimentalVentilation: true }]) {
    const client = new AguaClient(credentials, { ...options, fetch: async () => assert.fail('No network') });
    try {
      await assert.rejects(client.testAuto(device, map, reading, true), { operation: 'auto-test' });
    } finally {
      client.close();
    }
  }
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const client = new AguaClient(credentials, {
    enableExperimentalAuto: true, enableExperimentalPower: true, enableExperimentalPowerLevel: true,
    enableExperimentalSetpoint: true, enableExperimentalVentilation: true,
    fetch: async (_url, init) => {
      signalStarted();
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('private')), { once: true }));
    },
  });

  const rejected = assert.rejects(client.testAuto(device, map, reading, true), { kind: 'closed' });
  await started;
  await assert.rejects(client.testAuto(device, map, reading, true), { operation: 'auto-test' });
  await assert.rejects(client.testPowerLevel(device, map, reading, 3), { operation: 'power-level-test' });
  await assert.rejects(client.testFrontVentilation(device, map, reading, 3), { operation: 'ventilation-test' });
  await assert.rejects(client.testSetpoint(device, map, 20), { operation: 'setpoint-test' });
  await assert.rejects(client.testPower(device, map, reading, 'on'), { operation: 'power-test' });
  client.close();
  await rejected;
});

test('Powerful candidate writes only 33154 and refuses Auto, transitions, CRONO and changed profiles', () => {
    const powerfulMap = { ...map, registers: map.registers.map(entry =>
      entry.reg_key === 'fun_pwf_set' ? { ...entry, enc_val: [...labels,
        { value: 2, lang: 'FRE', description: 'CRONO' }] } : entry) };
    for (const enabled of [true, false]) {
      for (const phase of [0, 5, 8]) {
      const initial = { ...reading, values: new Map(reading.values).set(33154, Number(!enabled)).set(8, phase) };
      const result = previewPowerful(device, powerfulMap, initial, enabled);
      assert.equal(result.hardwareValidated, false);
      assert.equal(result.originalEnabled, !enabled);
      assert.deepEqual(result.body, {
        ...device, Protocol: 'RWMSmaster', BitData: 8, Endianess: 'L',
        Items: [33154], Masks: [65535], Values: [Number(enabled)],
      });
      }
    }
    for (const [offset, value] of [[33128, 1], [8, 2], [8, 9], [8, 7], [33154, 2]]) {
      assert.throws(() => previewPowerful(device, powerfulMap, {
        ...reading, values: new Map(reading.values).set(offset, value),
      }, true));
    }
    assert.throws(() => previewPowerful(device, powerfulMap, reading, false), { operation: 'powerful-unchanged' });
    for (const enabled of [1, 0, 'true', null]) {
      assert.throws(() => previewPowerful(device, powerfulMap, reading, enabled), { operation: 'powerful-preview' });
    }
    for (const patch of [{ mask: 255 }, { set_max: 2 }, { readonly: true },
      { enc_val: [] }, { enc_val: [...labels, labels[1]] },
      { enc_val: [labels[0], { ...labels[1], description: 'FULL' }] }]) {
      assert.throws(() => previewPowerful(device, { ...powerfulMap, registers: powerfulMap.registers.map(entry =>
        entry.reg_key === 'fun_pwf_set' ? { ...entry, ...patch } : entry) }, reading, true));
    }
  });

test('Powerful capability is independent and locks Auto and every other write during a command', async () => {
    const powerfulMap = { ...map, registers: map.registers.map(entry =>
      entry.reg_key === 'fun_pwf_set' ? { ...entry, enc_val: labels } : entry) };
    const disabled = new AguaClient(credentials, { enableExperimentalAuto: true,
      fetch: async () => assert.fail('No network') });
    await assert.rejects(disabled.testPowerful(device, powerfulMap, reading, true), { operation: 'powerful-test' });
    disabled.close();
    let signalStarted;
    const started = new Promise(resolve => { signalStarted = resolve; });
    const client = new AguaClient(credentials, {
      enableExperimentalPowerful: true, enableExperimentalAuto: true, enableExperimentalPower: true,
      enableExperimentalPowerLevel: true, enableExperimentalSetpoint: true, enableExperimentalVentilation: true,
      fetch: async (_url, init) => {
        signalStarted();
        return new Promise((_resolve, reject) => init.signal.addEventListener('abort',
          () => reject(new Error('private')), { once: true }));
      },
    });
    const rejected = assert.rejects(client.testPowerful(device, powerfulMap, reading, true), { kind: 'closed' });
    await started;
    await assert.rejects(client.testPowerful(device, powerfulMap, reading, true), { operation: 'powerful-test' });
    await assert.rejects(client.testAuto(device, powerfulMap, reading, true), { operation: 'auto-test' });
    await assert.rejects(client.testPowerLevel(device, powerfulMap, reading, 3), { operation: 'power-level-test' });
    await assert.rejects(client.testFrontVentilation(device, powerfulMap, reading, 3), { operation: 'ventilation-test' });
    await assert.rejects(client.testSetpoint(device, powerfulMap, 20), { operation: 'setpoint-test' });
    await assert.rejects(client.testPower(device, powerfulMap, reading, 'on'), { operation: 'power-test' });
    client.close();
    await rejected;
  });

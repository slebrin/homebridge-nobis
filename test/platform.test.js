import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { HomebridgeAPI } from './homebridge-api.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as immediate } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { URL } from 'node:url';

import register from '../dist/index.js';
import { NobisPlatform, reconnectDelay } from '../dist/platform.js';
import { PLATFORM_NAME, PLUGIN_NAME } from '../dist/settings.js';
import { AbandonConfirmationState, AutoCommandState, ChronoCommandState, PowerCommandState, PowerfulCommandState, SetpointCommandState, VentilationCommandState } from '../dist/agua/power-command-state.js';
import { loadAppIdentity } from '../dist/agua/identity.js';
import { AguaError } from '../dist/agua/errors.js';

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

for (const scenario of ['normal', 'unsupported']) {
  test(`Eco Stop ${scenario} reuses polling without power opt-in, preserves identity and faults safely`, async context => {
    let phase = 8;
    const { api, platform, calls, logs } = await cloudHarness(context, path => {
      if (path === '/deviceGetRegistersMap') {
        return { Success: true, device_registers_map: { registers_map: [{
          id: 'mock-map', registers: [ambientRegister,
            { reg_key: 'status_get', reg_type: 'GET', offset: 8, mask: scenario === 'unsupported' ? 255 : 65535,
              formula: '#', enc_val: [
                { value: 0, lang: 'FRE', description: 'OFF' },
                { value: 8, lang: 'FRE', description: 'ECO STOP' },
              ] },
            { reg_key: 'status_managed_get', reg_type: 'GET', offset: 232, mask: 255, formula: '#' }],
        }] } };
      }
      if (path === '/deviceJobStatus/job') {
        return { Success: true, jobAnswerStatus: 'completed',
          jobAnswerData: { Items: [103, 8, 232], Values: [23, phase, 0] } };
      }
      assert.notEqual(path, '/deviceRequestWriting');
      return sensorResponse(path);
    }, { enableTemperatureSensor: true, enableEcoStopSensor: true });
    const uuid = api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature']));
    const accessory = new api.platformAccessory('Cached', uuid);
    accessory.addService(api.hap.Service.ContactSensor, 'Cached Eco Stop', 'eco-stop');
    platform.configureAccessory(accessory);
    const published = [];
    api.on('registerPlatformAccessories', entries => published.push(...entries));
    context.mock.timers.enable({ apis: ['setTimeout'] });
    api.emit('didFinishLaunching');
    const C = api.hap.Characteristic;
    const state = accessory.getServiceById(api.hap.Service.ContactSensor, 'eco-stop').getCharacteristic(C.ContactSensorState);
    for (const [index, next] of [[1, 8], [2, 0], [3, 99], [4, 8]]) {
      phase = next;
      if (index > 1) {
        context.mock.timers.tick(60_000);
      }
      await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === index);
      await immediate();
      context.mock.timers.tick(1000);
      await until(() => logs.filter(entry => entry[0].includes('discovery successful')).length === index);
      if (scenario === 'unsupported' || next === 99) {
        await assert.rejects(state.handleGetRequest());
      } else {
        assert.equal(await state.handleGetRequest(), next === 8 ? 1 : 0);
      }
      assert.equal(await accessory.getService(api.hap.Service.TemperatureSensor).getCharacteristic(C.CurrentTemperature).handleGetRequest(), 23);
    }
    assert.equal(published.length, 0);
    assert.equal(accessory.UUID, uuid);
    assert.equal(calls.filter(path => path === '/deviceGetBufferReading').length, 4);
    assert.equal(calls.includes('/deviceRequestWriting'), false);
    api.emit('shutdown');
    await assert.rejects(state.handleGetRequest());
  });
}

test('disabled Eco Stop option removes only its cached contact service', async context => {
  const { api, platform } = await cloudHarness(context, path => sensorResponse(path),
    { enableTemperatureSensor: true });
  const accessory = new api.platformAccessory('Cached', api.hap.uuid.generate('disabled-eco'));
  accessory.addService(api.hap.Service.ContactSensor, 'Eco Stop', 'eco-stop');
  platform.configureAccessory(accessory);
  api.emit('didFinishLaunching');
  assert.equal(accessory.getServiceById(api.hap.Service.ContactSensor, 'eco-stop'), undefined);
});

async function localResponse(request) {
  let timer;
  const started = performance.now();
  try {
    const result = await Promise.race([request, new Promise((_resolve, reject) => {
      timer = realSetTimeout(() => reject(new Error('HomeKit local response exceeded 1000ms')), 1000);
    })]);
    assert.ok(performance.now() - started < 1000, 'Local response must stay below 1000ms');
    return result;
  } finally {
    realClearTimeout(timer);
  }
}

function harness() {
  const api = new EventEmitter();
  api.hap = new HomebridgeAPI().hap;
  api.unregisterPlatformAccessories = () => {};
  const logs = [];
  const log = {
    info: (...args) => logs.push(args),
    warn: (...args) => logs.push(args),
    debug: (...args) => logs.push(args),
  };
  return { api, log, logs };
}

test('registers a Dynamic Platform with stable plugin and platform names', () => {
  const calls = [];
  register({ registerPlatform: (...args) => calls.push(args) });
  assert.deepEqual(calls, [[PLUGIN_NAME, PLATFORM_NAME, NobisPlatform]]);
});

async function cloudHarness(context, handler, settings = {}) {
  const root = await mkdtemp(join(tmpdir(), 'homebridge-nobis-platform-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  context.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(path);
    const body = init.body === undefined ? {} : JSON.parse(init.body);
    const response = path === '/appSignup'
      ? { Success: true, id_app: body.id_app }
      : path === '/userLogin'
        ? { Success: true, token: 'fictional-token', refresh_token: 'fictional-refresh' }
        : await handler(path, calls, body, init);
    return response instanceof globalThis.Response ? response
      : new globalThis.Response(JSON.stringify(response), { status: path === '/appSignup' ? 201 : 200 });
  });
  const { log, logs } = harness();
  const api = settings.enableTemperatureSensor ? new HomebridgeAPI() : new EventEmitter();
  api.user = { storagePath: () => root };
  const platform = new NobisPlatform(log, {
    platform: PLATFORM_NAME, email: 'reader@example.invalid', password: 'mock-password',
    enableCloud: true, diagnostic: true,
    ...settings,
  }, api);
  context.after(() => api.emit('shutdown'));
  return { api, platform, calls, log, logs, root };
}

const ambientRegister = {
  reg_key: 'temp_air2_get', reg_type: 'GET', offset: 103, mask: 65535,
  formula: '#', is_word: true, big_endian: false, with_sign: false,
};

function sensorResponse(path, value = 23) {
  if (path === '/deviceGetRegistersMap') {
    return { Success: true, device_registers_map: {
      registers_map: [{ id: 'mock-map', registers: [ambientRegister] }],
    } };
  }
  if (path === '/deviceGetBufferReading') {
    return { Success: true, idRequest: 'job' };
  }
  if (path === '/deviceJobStatus/job') {
    return { Success: true, jobAnswerStatus: 'completed', jobAnswerData: { Items: [103], Values: [value] } };
  }
  return discoveryResponse(path);
}

function statusSensorResponse(path, phase = 0, managed = 0) {
  if (path === '/deviceGetRegistersMap') {
    return { Success: true, device_registers_map: { registers_map: [{
      id: 'mock-map', registers: [
        ambientRegister,
        { reg_key: 'status_get', reg_type: 'GET', offset: 8, mask: 65535, formula: '#',
          enc_val: [
            { value: 0, lang: 'FRE', description: 'OFF private-map-label' },
            { value: 5, lang: 'FRE', description: 'TRAVAIL private-map-label' },
          ] },
        { reg_key: 'status_managed_get', reg_type: 'GET', offset: 232, mask: 255, formula: '#',
          enc_val: [{ value: 85, lang: 'FRE', description: 'ON private-map-label' }] },
      ],
    }] } };
  }
  if (path === '/deviceJobStatus/job') {
    return { Success: true, jobAnswerStatus: 'completed',
      jobAnswerData: { Items: [103, 8, 232], Values: [23, phase, managed] } };
  }
  return sensorResponse(path);
}

const controlRegisters = [
  ambientRegister,
  { reg_key: 'status_get', reg_type: 'GET', offset: 8, mask: 65535, formula: '#',
    enc_val: [{ value: 0, lang: 'FRE', description: 'OFF' }, { value: 2, lang: 'FRE', description: 'D\u00c9BUT' },
      { value: 5, lang: 'FRE', description: 'TRAVAIL' }, { value: 7, lang: 'FRE', description: 'ARR\u00caT' }] },
  { reg_key: 'status_managed_get', reg_type: 'GET', readonly: false, offset: 232, mask: 255,
    formula: '#', formula_inverse: '#', set_min: 0, set_max: 255, step: 1,
    is_word: false, big_endian: false, with_sign: false,
    enc_val: [{ value: 85, lang: 'FRE', description: 'ON' }, { value: 170, lang: 'FRE', description: 'OFF' }] },
];

const ventilationRegisters = [
  ['power_set', 33120, 1, 7], ['vent_front_set', 33132, 0, 8],
  ['fun_auto_set', 33128, 0, 1], ['fun_pwf_set', 33154, 0, 1],
].map(([reg_key, offset, set_min, set_max]) => ({
  reg_key, offset, set_min, set_max, reg_type: 'SET', readonly: false, mask: 65535,
  formula: '#', formula_inverse: '#', step: 1, is_word: true, big_endian: false, with_sign: false,
  ...(reg_key === 'vent_front_set' ? { enc_val: [
    { value: 0, lang: 'FRE', description: 'OFF' }, { value: 8, lang: 'FRE', description: 'PS' },
  ] } : {}),
}));

const setpointRegister = {
  reg_key: 'temp_air_set', reg_type: 'SET', readonly: false, offset: 33122,
  mask: 65535, formula: '#', formula_inverse: '#', set_min: 7, set_max: 41, step: 1,
  is_word: true, big_endian: false, with_sign: false,
  enc_val: [{ value: 41, lang: 'FRE', description: 'MAN' }],
};

const powerfulRegisters = ventilationRegisters.map(entry => ['fun_pwf_set', 'fun_auto_set'].includes(entry.reg_key) ? {
  ...entry, enc_val: [{ value: 0, lang: 'FRE', description: 'OFF' }, { value: 1, lang: 'FRE', description: 'ON' },
    { value: 2, lang: 'FRE', description: 'CRONO' }],
} : entry);

const chronoRegister = {
  reg_key: 'chrono_week_enable_set', reg_type: 'SET', readonly: false, offset: 33162,
  mask: 65535, formula: '#', formula_inverse: '#', set_min: 0, set_max: 1, step: 1,
  is_word: false, big_endian: false, with_sign: false,
};

for (const control of ['power', 'heating', 'setpoint', 'ventilation', 'powerful', 'auto', 'chrono']) {
  test(`${control} returns the last observed value within 1000ms while cloud is stalled beyond HAP timeout, with one global lock`, async context => {
    let stalled = false;
    let release;
    let updated;
    const values = new Map([[103, 23], [8, 0], [232, 0], [33122, 20],
      [33120, 5], [33132, 4], [33128, 0], [33154, 0], [33162, 0]]);
    const { api, calls, logs, root } = await cloudHarness(context, async (path, _calls, body, init) => {
      if (path === '/deviceList' && stalled) {
        await new Promise((resolve, reject) => {
          release = resolve;
          init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      if (path === '/deviceGetRegistersMap') {
        return { Success: true, device_registers_map: { registers_map: [{
          id: 'mock-map', registers: [...controlRegisters, setpointRegister, ...powerfulRegisters, chronoRegister],
        }] } };
      }
      if (path === '/deviceJobStatus/job') {
        return { Success: true, jobAnswerStatus: 'completed', jobAnswerData: {
          Items: [...values.keys()], Values: [...values.values()],
        } };
      }
      if (path === '/deviceRequestWriting') {
        const isPower = ['power', 'heating'].includes(control);
        assert.equal(body.Items[0], isPower ? 232 : {
          setpoint: 33122, ventilation: 33132, powerful: 33154, auto: 33128, chrono: 33162,
        }[control]);
        assert.equal(body.Values[0], isPower ? 85 : { setpoint: 28, ventilation: 6 }[control] ?? 1);
        updated = [isPower ? 8 : body.Items[0], isPower ? 5 : body.Values[0]];
        return { Success: true, idRequest: 'write' };
      }
      if (path === '/deviceJobStatus/write') {
        values.set(...updated);
        return { Success: true, jobAnswerStatus: 'completed', jobAnswerData: {} };
      }
      return sensorResponse(path);
    }, { enableTemperatureSensor: true, enablePowerSwitch: true, enableSetpointControl: true,
      enableVentilationControl: true, enablePowerfulControl: true, enableAutoControl: true, enableChronoControl: true,
      enableEcoStopSensor: true });
    const published = [];
    api.on('registerPlatformAccessories', accessories => published.push(...accessories));
    context.mock.timers.enable({ apis: ['setTimeout'] });
    api.emit('didFinishLaunching');
    await until(() => calls.includes('/deviceGetBufferReading'));
    await immediate();
    context.mock.timers.tick(1000);
    await until(() => logs.some(entry => entry[0].includes('Cloud refresh successful')));
    const accessory = published[0];
    const C = api.hap.Characteristic;
    const heater = accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating');
    const targets = {
      power: [accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(C.On), true, false],
      heating: [heater.getCharacteristic(C.Active), 1, 0],
      setpoint: [heater.getCharacteristic(C.HeatingThresholdTemperature), 28, 20],
      ventilation: [heater.getCharacteristic(C.RotationSpeed), 86, 57],
      ...Object.fromEntries(['powerful', 'auto', 'chrono'].map(mode => [mode,
        [accessory.getServiceById(api.hap.Service.Switch, mode).getCharacteristic(C.On), true, false]])),
    };
    const [characteristic, target, previous] = targets[control];
    stalled = true;
    assert.equal(await localResponse(characteristic.handleSetRequest(target)), previous);
    await until(() => release !== undefined);
    assert.equal(calls.includes('/deviceRequestWriting'), false);
    assert.equal(characteristic.value, previous);
    for (const [other, requested, observed] of Object.values(targets)) {
      assert.equal(await other.handleGetRequest(), observed);
      await assert.rejects(other.handleSetRequest(requested), error => error === api.hap.HAPStatus.RESOURCE_BUSY);
    }
    context.mock.timers.tick(9500);
    await immediate();
    assert.equal(await characteristic.handleGetRequest(), previous);
    assert.equal(characteristic.value, previous);
    assert.equal(calls.includes('/deviceRequestWriting'), false);
    assert.ok(logs.some(entry => entry[0].includes('accepted locally')));
    stalled = false;
    release();
    await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
    await immediate();
    context.mock.timers.tick(1000);
    await until(() => calls.includes('/deviceRequestWriting'));
    await immediate();
    context.mock.timers.tick(1000);
    await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 3);
    await immediate();
    context.mock.timers.tick(1000);
    const label = ['power', 'heating'].includes(control) ? 'Power' : control[0].toUpperCase() + control.slice(1);
    await until(() => logs.some(entry => entry[0].includes(`HomeKit ${label} processing finished`)));
    assert.equal(await accessory.getServiceById(api.hap.Service.ContactSensor, 'eco-stop')
      .getCharacteristic(C.ContactSensorState).handleGetRequest(), 0);
    assert.equal(await characteristic.handleGetRequest(), target);
    assert.equal(characteristic.value, target);
    assert.equal(calls.filter(path => path === '/deviceRequestWriting').length, 1);
    const State = { power: PowerCommandState, heating: PowerCommandState, setpoint: SetpointCommandState,
      ventilation: VentilationCommandState, powerful: PowerfulCommandState, auto: AutoCommandState, chrono: ChronoCommandState }[control];
    assert.equal(await new State(root).load(accessory.UUID), undefined);
  });
}

for (const scenario of ['timeout-before-post', 'shutdown-before-post', 'shutdown-after-post']) {
  test(`locally accepted command ${scenario} is bounded or cancelled, never retried and never reports the target`, async context => {
    let stalled = false;
    let aborted = false;
    let waiting = false;
    const { api, calls, logs, root } = await cloudHarness(context, async (path, _calls, _body, init) => {
      if (stalled && path === (scenario === 'shutdown-after-post' ? '/deviceRequestWriting' : '/deviceList')) {
        return new Promise((_resolve, reject) => {
          waiting = true;
          init.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('private abort detail'));
          }, { once: true });
        });
      }
      if (path === '/deviceGetRegistersMap') {
        return { Success: true, device_registers_map: { registers_map: [{ id: 'mock-map', registers: controlRegisters }] } };
      }
      if (path === '/deviceJobStatus/job') {
        return { Success: true, jobAnswerStatus: 'completed', jobAnswerData: { Items: [103, 8, 232], Values: [23, 0, 0] } };
      }
      return sensorResponse(path);
    }, { enableTemperatureSensor: true, enablePowerSwitch: true });
    const published = [];
    api.on('registerPlatformAccessories', accessories => published.push(...accessories));
    context.mock.timers.enable({ apis: ['setTimeout'] });
    api.emit('didFinishLaunching');
    await until(() => calls.includes('/deviceGetBufferReading'));
    await immediate();
    context.mock.timers.tick(1000);
    await until(() => logs.some(entry => entry[0].includes('Cloud refresh successful')));
    const accessory = published[0];
    const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(api.hap.Characteristic.On);
    stalled = true;
    assert.equal(await localResponse(on.handleSetRequest(true)), false);
    if (scenario === 'shutdown-after-post') {
      await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
      await immediate();
      context.mock.timers.tick(1000);
    }
    await until(() => waiting);
    if (scenario === 'timeout-before-post') {
      context.mock.timers.tick(10_000);
      await until(() => logs.some(entry => entry[0].includes('HomeKit Power processing failed')));
      assert.ok(logs.some(entry => entry[0].includes('timeout')));
      assert.equal(logs.some(entry => entry[0].includes('private abort detail')), false);
      stalled = false;
      context.mock.timers.tick(60_000);
      await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
      await immediate();
      context.mock.timers.tick(1000);
      await until(() => logs.filter(entry => entry[0].includes('Cloud refresh successful')).length === 2);
      assert.equal(await on.handleGetRequest(), false);
    } else {
      const count = calls.length;
      api.emit('shutdown');
      await until(() => aborted);
      context.mock.timers.tick(600_000);
      await immediate();
      assert.equal(calls.length, count);
      await assert.rejects(on.handleGetRequest());
    }
    assert.equal(aborted, true);
    assert.equal(calls.filter(path => path === '/deviceRequestWriting').length, scenario === 'shutdown-after-post' ? 1 : 0);
    assert.notEqual(on.value, true);
    assert.equal(await new PowerCommandState(root).load(accessory.UUID), scenario === 'shutdown-after-post' ? 'on' : undefined);
  });
}

for (const control of ['powerful', 'auto', 'chrono']) {
const label = control === 'chrono' ? 'Chrono' : control === 'auto' ? 'Auto' : 'Powerful';
const State = control === 'chrono' ? ChronoCommandState : control === 'auto' ? AutoCommandState : PowerfulCommandState;
const contextKey = control === 'chrono' ? 'pendingChrono' : control === 'auto' ? 'pendingAuto' : 'pendingPowerful';
for (const [enabled, failure, phase = 0] of [[true, 'different'], [false, 'matched'], [true, '401'],
  [true, 'network'], [true, 'nack'], [true, 'storage'], [true, 'different', 8], [false, 'matched', 8]]) {
  test(`${label} HomeKit ${enabled ? 'ON' : 'OFF'} ${failure} phase=${phase} persists before POST and never replays`, async context => {
    let mode = Number(!enabled);
    const published = [];
    const { api, calls, logs, root } = await cloudHarness(context, async (path, _calls, body) => {
      if (path === '/deviceGetRegistersMap') {
        return { Success: true, device_registers_map: { registers_map: [{
          id: 'mock-map', registers: [...controlRegisters.map(entry => entry.reg_key === 'status_get'
            ? { ...entry, enc_val: [...entry.enc_val, { value: 8, lang: 'FRE', description: 'ECO STOP' }] } : entry),
          setpointRegister, ...powerfulRegisters, chronoRegister],
        }] } };
      }
      if (path === '/deviceJobStatus/job') {
        return { Success: true, jobAnswerStatus: 'completed',
          jobAnswerData: { Items: [103, 8, 232, 33122, 33120, 33132, 33128, 33154, 33162],
            Values: [23, phase, 0, 20, 5, 4, control === 'auto' ? mode : 0, control === 'powerful' ? mode : 0,
              control === 'chrono' ? mode : 0] } };
      }
      if (path === '/deviceRequestWriting') {
        assert.deepEqual(body, {
          id_product: 'mock-product', id_device: 'mock-device', Protocol: 'RWMSmaster',
          BitData: 8, Endianess: 'L', Items: [control === 'chrono' ? 33162 : control === 'auto' ? 33128 : 33154], Masks: [65535], Values: [Number(enabled)],
        });
        assert.equal(await new State(root).load(published[0].UUID), Number(enabled));
        if (failure === '401') {
          return new globalThis.Response('{}', { status: 401 });
        }
        if (failure === 'network') {
          throw new Error('private');
        }
        if (failure === 'matched') {
          mode = Number(enabled);
        }
        return { Success: true, idRequest: 'write' };
      }
      if (path === '/deviceJobStatus/write') {
        return { Success: true, jobAnswerStatus: 'completed',
          jobAnswerData: failure === 'nack' ? { NackErrCode: 0 } : {} };
      }
      return sensorResponse(path);
    }, { enableTemperatureSensor: true, enablePowerSwitch: true, enableSetpointControl: true,
      enableVentilationControl: true, enablePowerfulControl: true, enableAutoControl: true, enableChronoControl: true });
    api.on('registerPlatformAccessories', accessories => published.push(...accessories));
    context.mock.timers.enable({ apis: ['setTimeout'] });
    api.emit('didFinishLaunching');
    await until(() => calls.includes('/deviceGetBufferReading'));
    await immediate();
    context.mock.timers.tick(1000);
    await until(() => logs.some(entry => entry[0].includes('Cloud refresh successful')));
    const accessory = published[0];
    const C = api.hap.Characteristic;
    const on = accessory.getServiceById(api.hap.Service.Switch, control).getCharacteristic(C.On);
    const other = accessory.getServiceById(api.hap.Service.Switch, control === 'auto' ? 'powerful' : 'auto').getCharacteristic(C.On);
    assert.equal(await on.handleGetRequest(), !enabled);
    if (failure === 'storage') {
      await new State(root).begin(accessory.UUID, Number(!enabled));
    }
    assert.equal(await on.handleSetRequest(enabled), !enabled);
    await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
    await immediate();
    context.mock.timers.tick(1000);
    if (failure !== 'storage') {
      await until(() => calls.includes('/deviceRequestWriting'));
      await immediate();
      context.mock.timers.tick(1000);
      if (failure === 'matched' || failure === 'different') {
        await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 3);
        await immediate();
        context.mock.timers.tick(1000);
      }
    }
    await until(() => logs.some(entry => entry[0].includes(
      `HomeKit ${label} processing ${['matched', 'different'].includes(failure) ? 'finished' : 'failed'}`)));
    assert.equal(calls.filter(path => path === '/deviceRequestWriting').length, failure === 'storage' ? 0 : 1);
    if (failure === 'matched') {
      assert.equal(await on.handleGetRequest(), enabled);
      assert.equal(await new State(root).load(accessory.UUID), undefined);
    } else {
      if (failure === 'different') {
        assert.equal(await on.handleGetRequest(), !enabled);
        assert.equal(await on.handleGetRequest(), on.value);
      } else {
        await assert.rejects(on.handleGetRequest());
      }
      assert.notEqual(on.value, enabled);
      assert.equal(accessory.context[contextKey], Number(enabled));
      if (failure === 'different') {
        assert.equal(await other.handleGetRequest(), false);
      }
      await assert.rejects(other.handleSetRequest(true));
      const heater = accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating');
      await assert.rejects(accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(C.On).handleSetRequest(true));
      await assert.rejects(heater.getCharacteristic(C.Active).handleSetRequest(1));
      await assert.rejects(heater.getCharacteristic(C.HeatingThresholdTemperature).handleSetRequest(28));
      await assert.rejects(heater.getCharacteristic(C.RotationSpeed).handleSetRequest(86));
      await assert.rejects(on.handleSetRequest(!enabled));
      if (failure === 'different') {
        for (const count of [4, 5, 6]) {
          const before = calls.length;
          context.mock.timers.tick(4999);
          await immediate();
          assert.equal(calls.length, before);
          context.mock.timers.tick(1);
          await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === count);
          await immediate();
          context.mock.timers.tick(1000);
          await until(() => logs.filter(entry => entry[0].includes('Cloud refresh successful')).length === count - 2);
          assert.equal(await on.handleGetRequest(), !enabled);
          assert.equal(await heater.getCharacteristic(C.CurrentTemperature).handleGetRequest(), 23);
          assert.equal(await heater.getCharacteristic(C.HeatingThresholdTemperature).handleGetRequest(), 20);
        }
        mode = Number(enabled);
        context.mock.timers.tick(5000);
        await immediate();
        assert.equal(calls.filter(path => path === '/deviceGetBufferReading').length, 6);
        context.mock.timers.tick(55_000);
        await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 7);
        await immediate();
        context.mock.timers.tick(1000);
        await until(() => logs.some(entry => entry[0].includes(`Pending ${label} resolved`)));
        await until(() => on.statusCode === 0);
        assert.equal(await on.handleGetRequest(), enabled);
        assert.equal(await new State(root).load(accessory.UUID), undefined);
      }
    }
    assert.equal(calls.filter(path => path === '/deviceRequestWriting').length, failure === 'storage' ? 0 : 1);
    assert.equal(calls.filter(path => path === '/userLogin').length, 1);
    api.emit('shutdown');
    await assert.rejects(on.handleGetRequest());
    const stoppedCalls = calls.length;
    context.mock.timers.tick(600_000);
    await immediate();
    assert.equal(calls.length, stoppedCalls);
  });
}
}

test('explicit abandonment clears every persisted/cache target without writes, is one-shot across restart and re-arms only after disabled restart', async context => {
  const options = { enableTemperatureSensor: true, enablePowerSwitch: true,
    enableSetpointControl: true, enableVentilationControl: true, enableAutoControl: true, enablePowerfulControl: true,
    confirmAbandonPendingCommands: true, enableChronoControl: true };
  const { api, platform, calls, log, logs, root } = await cloudHarness(context, path => {
    if (path === '/deviceGetRegistersMap') {
      return { Success: true, device_registers_map: { registers_map: [{
        id: 'mock-map', registers: [...controlRegisters, setpointRegister, ...powerfulRegisters, chronoRegister],
      }] } };
    }
    if (path === '/deviceJobStatus/job') {
      return { Success: true, jobAnswerStatus: 'completed', jobAnswerData: {
        Items: [103, 8, 232, 33122, 33120, 33132, 33128, 33154, 33162], Values: [23, 0, 0, 20, 5, 4, 0, 0, 0],
      } };
    }
    assert.notEqual(path, '/deviceRequestWriting');
    return sensorResponse(path);
  }, options);
  await loadAppIdentity(root);
  const uuid = api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature']));
  const entries = [
    ['pendingPowerAction', new PowerCommandState(root), 'on'],
    ['pendingSetpoint', new SetpointCommandState(root), 28],
    ['pendingVentilation', new VentilationCommandState(root), 5],
    ['pendingPowerful', new PowerfulCommandState(root), 1],
    ['pendingAuto', new AutoCommandState(root), 1],
    ['pendingChrono', new ChronoCommandState(root), 1],
  ];
  const accessory = new api.platformAccessory('Cached', uuid);
  accessory.addService(api.hap.Service.TemperatureSensor, 'Cached');
  for (const [key, state, target] of entries) {
    await state.begin(uuid, target);
    accessory.context[key] = target;
  }
  platform.configureAccessory(accessory);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let reads = 1;
  api.emit('didFinishLaunching');
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === reads);
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('abandonment complete: 6')));
  for (const [key, state] of entries) {
    assert.equal(await state.load(uuid), undefined);
    assert.equal(accessory.context[key], undefined);
  }
  const receipt = new AbandonConfirmationState(root);
  assert.equal(await receipt.load(uuid), 1);
  const C = api.hap.Characteristic;
  const heater = accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating');
  assert.equal(await heater.getCharacteristic(C.RotationSpeed).handleGetRequest(), 57);
  assert.equal(await heater.getCharacteristic(C.HeatingThresholdTemperature).handleGetRequest(), 20);
  assert.equal(await accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(C.On).handleGetRequest(), false);
  await entries[2][1].begin(uuid, 5);
  accessory.context.pendingVentilation = 5;
  async function restart(confirm) {
    api.emit('shutdown');
    const restarted = new NobisPlatform(log, { platform: PLATFORM_NAME, email: 'reader@example.invalid',
      password: 'mock-password', enableCloud: true, diagnostic: true, ...options,
      confirmAbandonPendingCommands: confirm }, api);
    restarted.configureAccessory(accessory);
    reads++;
    api.emit('didFinishLaunching');
    await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === reads);
    await immediate();
    context.mock.timers.tick(1000);
    await until(() => logs.filter(entry => entry[0].includes('Cloud refresh successful')).length === reads);
  }
  await restart(true);
  assert.equal(await entries[2][1].load(uuid), 5);
  assert.equal(accessory.context.pendingVentilation, 5);
  assert.ok(logs.some(entry => entry[0].includes('confirmation already consumed')));
  await restart(false);
  assert.equal(await receipt.load(uuid), undefined);
  assert.equal(await entries[2][1].load(uuid), 5);
  await restart(true);
  assert.equal(await receipt.load(uuid), 1);
  assert.equal(await entries[2][1].load(uuid), undefined);
  assert.equal(accessory.context.pendingVentilation, undefined);
  assert.equal(calls.includes('/deviceRequestWriting'), false);
  assert.equal(accessory.UUID, uuid);
});

for (const scenario of ['disabled-options', 'cache-only', 'no-target', 'working', 'starting', 'unknown', 'offline', 'invalid-settings',
  'invalid-setpoint', 'invalid-mode-label', 'corrupt-target', 'corrupt-confirmation', 'clear-failure', 'shutdown-after-consume', 'invalid-json']) {
  test(`one-time abandonment ${scenario} never sends commands or silently bypasses failed validation/storage`, async context => {
    const { api, platform, calls, logs, root } = await cloudHarness(context, path => {
      if (path === '/deviceGetRegistersMap') {
        return { Success: true, device_registers_map: { registers_map: [{
          id: 'mock-map', registers: [...controlRegisters, setpointRegister,
            ...powerfulRegisters.map(register => scenario === 'invalid-settings' && register.reg_key === 'vent_front_set'
              ? { ...register, mask: 255 } : scenario === 'invalid-mode-label' && register.reg_key === 'fun_auto_set'
                ? { ...register, enc_val: [{ value: 0, lang: 'FRE', description: 'UNSUPPORTED' }] } : register)],
        }] } };
      }
      if (path === '/deviceJobStatus/job') {
        if (scenario === 'invalid-json') {
          return new globalThis.Response('{invalid');
        }
        return { Success: true, jobAnswerStatus: 'completed', jobAnswerData: {
          Items: [103, 8, 232, 33122, 33120, 33132, 33128, 33154],
          Values: [23, scenario === 'working' ? 5 : scenario === 'starting' ? 2 : scenario === 'unknown' ? 99 : 0,
            0, scenario === 'invalid-setpoint' ? 42 : 20, 5, 4, 0, 0],
        } };
      }
      if (path === '/deviceList' && scenario === 'offline') {
        const response = discoveryResponse(path);
        response.device[0].is_online = false;
        return response;
      }
      assert.notEqual(path, '/deviceRequestWriting');
      return sensorResponse(path);
    }, { enableTemperatureSensor: true, enablePowerSwitch: true, confirmAbandonPendingCommands: true });
    await loadAppIdentity(root);
    const uuid = api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature']));
    const state = new VentilationCommandState(root);
    const receipt = new AbandonConfirmationState(root);
    let aborted = false;
    if (scenario !== 'no-target' && scenario !== 'cache-only') {
      await state.begin(uuid, 5);
    }
    if (scenario === 'corrupt-target') {
      await writeFile(join(root, 'homebridge-nobis', `ventilation-pending-${uuid}`), 'bad');
    }
    if (scenario === 'corrupt-confirmation') {
      await writeFile(join(root, 'homebridge-nobis', `abandon-confirmation-pending-${uuid}`), 'bad');
    }
    if (scenario === 'clear-failure') {
      context.mock.method(VentilationCommandState.prototype, 'complete', async () => {
        throw new AguaError('storage', 'power-command-state');
      });
    }
    if (scenario === 'shutdown-after-consume') {
      const begin = AbandonConfirmationState.prototype.begin;
      context.mock.method(AbandonConfirmationState.prototype, 'begin', async function (...args) {
        await begin.apply(this, args);
        api.emit('shutdown');
        aborted = true;
      });
    }
    const accessory = new api.platformAccessory('Cached', uuid);
    accessory.addService(api.hap.Service.TemperatureSensor, 'Cached');
    if (scenario === 'disabled-options' || scenario === 'cache-only') {
      accessory.context.pendingVentilation = 5;
      accessory.addService(api.hap.Service.HeaterCooler, 'Cached', 'heating');
    }
    platform.configureAccessory(accessory);
    context.mock.timers.enable({ apis: ['setTimeout'] });
    api.emit('didFinishLaunching');
    if (scenario !== 'offline') {
      await until(() => calls.includes('/deviceGetBufferReading'));
      await immediate();
      context.mock.timers.tick(1000);
    }
    const success = ['disabled-options', 'cache-only', 'no-target'].includes(scenario);
    await until(() => scenario === 'shutdown-after-consume' ? aborted : logs.some(entry => entry[0].includes(success ? 'abandonment complete' :
      ['working', 'starting', 'unknown'].includes(scenario) ? 'API must report OFF' :
      scenario.startsWith('corrupt') || scenario === 'clear-failure' ? 'power-command-state' :
      scenario === 'invalid-settings' ? 'operating-settings' :
      scenario === 'invalid-setpoint' ? 'setpoint-readback' :
      scenario === 'invalid-mode-label' ? 'pending-command-abandon' :
      scenario === 'offline' ? 'device-offline' : 'deviceJobStatus: protocol')));
    if (scenario === 'corrupt-target') {
      await assert.rejects(state.load(uuid));
    } else {
      assert.equal(await state.load(uuid), success ? undefined : 5);
    }
    if (scenario === 'corrupt-confirmation') {
      await assert.rejects(receipt.load(uuid));
    } else {
      assert.equal(await receipt.load(uuid), success || scenario === 'clear-failure' || aborted ? 1 : undefined);
    }
    if (success) {
      assert.equal(accessory.context.pendingVentilation, undefined);
      assert.equal(accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating'), undefined);
      assert.equal(await accessory.getService(api.hap.Service.TemperatureSensor)
        .getCharacteristic(api.hap.Characteristic.CurrentTemperature).handleGetRequest(), 23);
    }
    if (scenario === 'no-target') {
      await state.begin(uuid, 5);
      context.mock.timers.tick(60_000);
      await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
      await immediate();
      context.mock.timers.tick(1000);
      await until(() => logs.filter(entry => entry[0].includes('Cloud refresh successful')).length === 2);
      assert.equal(await state.load(uuid), 5);
      assert.equal(accessory.context.pendingVentilation, 5);
      assert.equal(logs.filter(entry => entry[0].includes('abandonment complete')).length, 1);
    }
    if (scenario === 'clear-failure') {
      const completedCount = logs.filter(entry => entry[0].includes('abandonment complete')).length;
      context.mock.timers.tick(60_000);
      await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
      await immediate();
      context.mock.timers.tick(1000);
      await until(() => logs.filter(entry => entry[0].includes('Cloud refresh successful')).length === 2);
      assert.equal(await state.load(uuid), 5);
      assert.equal(logs.filter(entry => entry[0].includes('abandonment complete')).length, completedCount);
    }
    assert.equal(calls.includes('/deviceRequestWriting'), false);
  });
}

test('HomeKit ventilation writes once, blocks all controls and resolves only from actual level readback', async context => {
  let level = 4;
  let incompatible = false;
  const { api, calls, logs, root } = await cloudHarness(context, async (path, _calls, body) => {
    if (path === '/deviceGetRegistersMap') {
      return { Success: true, device_registers_map: { registers_map: [{
        id: 'mock-map', registers: [...controlRegisters, setpointRegister, ...ventilationRegisters.map(register =>
          incompatible && register.reg_key === 'vent_front_set' ? { ...register, mask: 255 } : register)],
      }] } };
    }
    if (path === '/deviceRequestWriting') {
      assert.deepEqual(body, {
        id_product: 'mock-product', id_device: 'mock-device', Protocol: 'RWMSmaster',
        BitData: 8, Endianess: 'L', Items: [33132], Masks: [65535], Values: [6],
      });
      assert.equal(await new VentilationCommandState(root).load(published[0].UUID), 6);
      return { Success: true, idRequest: 'write' };
    }
    if (path === '/deviceJobStatus/write') {
      return { Success: true, jobAnswerStatus: 'completed', jobAnswerData: {} };
    }
    if (path === '/deviceJobStatus/job') {
      return { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [103, 8, 232, 33122, 33120, 33132, 33128, 33154], Values: [23, 0, 0, 20, 5, level, 0, 0] } };
    }
    return sensorResponse(path);
  }, { enableTemperatureSensor: true, enablePowerSwitch: true, enableSetpointControl: true, enableVentilationControl: true });
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => calls.includes('/deviceGetBufferReading'));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('Cloud refresh successful')));
  const accessory = published[0];
  const C = api.hap.Characteristic;
  const heater = accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating');
  assert.equal(accessory.getServiceById(api.hap.Service.Thermostat, 'heating'), undefined);
  const rotation = heater.getCharacteristic(C.RotationSpeed);
  const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(C.On);
  assert.equal(await rotation.handleGetRequest(), 57);
  const pending = rotation.handleSetRequest(86);
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => calls.includes('/deviceRequestWriting'));
  assert.equal(await new VentilationCommandState(root).load(accessory.UUID), 6);
  await assert.rejects(on.handleSetRequest(true));
  await assert.rejects(heater.getCharacteristic(C.Active).handleSetRequest(1));
  await assert.rejects(heater.getCharacteristic(C.HeatingThresholdTemperature).handleSetRequest(28));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 3);
  await immediate();
  context.mock.timers.tick(1000);
  await pending;
  await until(() => logs.some(entry => entry[0].includes('HomeKit Ventilation processing finished')));
  assert.equal(await rotation.handleGetRequest(), 57);
  assert.notEqual(rotation.value, 86);
  assert.equal(calls.filter(path => path === '/deviceRequestWriting').length, 1);
  level = 6;
  context.mock.timers.tick(5000);
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 4);
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('Pending ventilation resolved')));
  await until(() => rotation.statusCode === 0);
  assert.equal(await rotation.handleGetRequest(), 86);
  assert.equal(await on.handleGetRequest(), false);
  assert.equal(await heater.getCharacteristic(C.Active).handleGetRequest(), C.Active.INACTIVE);
  assert.equal(await new VentilationCommandState(root).load(accessory.UUID), undefined);
  assert.equal(published.length, 1);
  incompatible = true;
  context.mock.timers.tick(60_000);
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 5);
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('operating-settings')));
  await assert.rejects(rotation.handleGetRequest());
  assert.equal(await on.handleGetRequest(), false);
  assert.equal(await heater.getCharacteristic(C.HeatingThresholdTemperature).handleGetRequest(), 20);
  assert.equal(await heater.getCharacteristic(C.CurrentTemperature).handleGetRequest(), 23);
  api.emit('shutdown');
  await assert.rejects(rotation.handleGetRequest());
});

for (const prefix of ['power', 'setpoint', 'ventilation', 'powerful', 'auto', 'chrono']) {
  test(`corrupt ${prefix} marker on restart blocks every control without sending a command`, async context => {
    const { api, calls, logs, root } = await cloudHarness(context, path => {
      if (path === '/deviceGetRegistersMap') {
        return { Success: true, device_registers_map: { registers_map: [{
          id: 'mock-map', registers: [...controlRegisters, setpointRegister, ...ventilationRegisters],
        }] } };
      }
      if (path === '/deviceJobStatus/job') {
        return { Success: true, jobAnswerStatus: 'completed',
          jobAnswerData: { Items: [103, 8, 232, 33122, 33120, 33132, 33128, 33154], Values: [23, 0, 0, 20, 5, 4, 0, 0] } };
      }
      assert.notEqual(path, '/deviceRequestWriting');
      return sensorResponse(path);
    }, { enableTemperatureSensor: true, enablePowerSwitch: true, enableSetpointControl: true, enableVentilationControl: true });
    await loadAppIdentity(root);
    const uuid = api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature']));
    const marker = join(root, 'homebridge-nobis', `${prefix}-pending-${uuid}`);
    await writeFile(marker, 'corrupt', { mode: 0o600 });
    const published = [];
    api.on('registerPlatformAccessories', accessories => published.push(...accessories));
    context.mock.timers.enable({ apis: ['setTimeout'] });
    api.emit('didFinishLaunching');
    await until(() => calls.includes('/deviceGetBufferReading'));
    await immediate();
    context.mock.timers.tick(1000);
    await until(() => logs.some(entry => entry[0].includes('power-command-state')));
    const accessory = published[0];
    const C = api.hap.Characteristic;
    const heater = accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating');
    const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(C.On);
    assert.equal(accessory.getService(api.hap.Service.TemperatureSensor), undefined);
    await assert.rejects(on.handleGetRequest());
    await assert.rejects(on.handleSetRequest(true));
    await assert.rejects(heater.getCharacteristic(C.Active).handleSetRequest(1));
    await assert.rejects(heater.getCharacteristic(C.HeatingThresholdTemperature).handleSetRequest(28));
    await assert.rejects(heater.getCharacteristic(C.RotationSpeed).handleSetRequest(86));
    assert.equal(await readFile(marker, 'utf8'), 'corrupt');
    assert.equal(calls.includes('/deviceRequestWriting'), false);
    assert.equal(published.length, 1);
  });
}

test('ventilation storage failure before POST preserves the existing marker and blocks inverse commands', async context => {
  const { api, calls, logs, root } = await cloudHarness(context, path => {
    if (path === '/deviceGetRegistersMap') {
      return { Success: true, device_registers_map: { registers_map: [{
        id: 'mock-map', registers: [...controlRegisters, setpointRegister, ...ventilationRegisters],
      }] } };
    }
    if (path === '/deviceJobStatus/job') {
      return { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [103, 8, 232, 33122, 33120, 33132, 33128, 33154], Values: [23, 0, 0, 20, 5, 4, 0, 0] } };
    }
    assert.notEqual(path, '/deviceRequestWriting');
    return sensorResponse(path);
  }, { enableTemperatureSensor: true, enablePowerSwitch: true, enableSetpointControl: true, enableVentilationControl: true });
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => calls.includes('/deviceGetBufferReading'));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('Cloud refresh successful')));
  const accessory = published[0];
  const marker = join(root, 'homebridge-nobis', `ventilation-pending-${accessory.UUID}`);
  await new VentilationCommandState(root).begin(accessory.UUID, 7);
  const C = api.hap.Characteristic;
  const heater = accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating');
  const rotation = heater.getCharacteristic(C.RotationSpeed);
  assert.equal(await rotation.handleSetRequest(86), 57);
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('HomeKit Ventilation processing failed')));
  assert.equal(await readFile(marker, 'utf8'), '7');
  assert.equal(calls.includes('/deviceRequestWriting'), false);
  assert(logs.some(entry => entry[0].includes('power-command-state')));
  await assert.rejects(rotation.handleSetRequest(57));
  await assert.rejects(heater.getCharacteristic(C.Active).handleSetRequest(1));
  await assert.rejects(heater.getCharacteristic(C.HeatingThresholdTemperature).handleSetRequest(28));
  await assert.rejects(accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(C.On).handleSetRequest(true));
  assert.equal(calls.includes('/deviceRequestWriting'), false);
});

for (const failure of ['401', 'network', 'Nack']) {
  test(`HomeKit ventilation ${failure} never retries or releases the persistent uncertainty lock`, async context => {
    const { api, calls, logs, root } = await cloudHarness(context, path => {
      if (path === '/deviceGetRegistersMap') {
        return { Success: true, device_registers_map: { registers_map: [{
          id: 'mock-map', registers: [...controlRegisters, setpointRegister, ...ventilationRegisters],
        }] } };
      }
      if (path === '/deviceRequestWriting') {
        if (failure === 'network') {
          throw new TypeError('fictional-network-error');
        }
        return failure === '401' ? new globalThis.Response('{}', { status: 401 }) : { Success: true, idRequest: 'write' };
      }
      if (path === '/deviceJobStatus/write') {
        return { Success: true, jobAnswerStatus: 'completed', jobAnswerData: { NackErrCode: 0 } };
      }
      if (path === '/deviceJobStatus/job') {
        return { Success: true, jobAnswerStatus: 'completed',
          jobAnswerData: { Items: [103, 8, 232, 33122, 33120, 33132, 33128, 33154], Values: [23, 0, 0, 20, 5, 4, 0, 0] } };
      }
      return sensorResponse(path);
    }, { enableTemperatureSensor: true, enablePowerSwitch: true, enableSetpointControl: true, enableVentilationControl: true });
    const published = [];
    api.on('registerPlatformAccessories', accessories => published.push(...accessories));
    context.mock.timers.enable({ apis: ['setTimeout'] });
    api.emit('didFinishLaunching');
    await until(() => calls.includes('/deviceGetBufferReading'));
    await immediate();
    context.mock.timers.tick(1000);
    await until(() => logs.some(entry => entry[0].includes('Cloud refresh successful')));
    const accessory = published[0];
    const heater = accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating');
    const rotation = heater.getCharacteristic(api.hap.Characteristic.RotationSpeed);
    assert.equal(await rotation.handleSetRequest(86), 57);
    await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
    await immediate();
    context.mock.timers.tick(1000);
    await until(() => calls.includes('/deviceRequestWriting'));
    if (failure === 'Nack') {
      await immediate();
      context.mock.timers.tick(1000);
    }
    await until(() => logs.some(entry => entry[0].includes('HomeKit Ventilation processing failed')));
    assert.equal(await new VentilationCommandState(root).load(accessory.UUID), 6);
    await assert.rejects(rotation.handleSetRequest(100));
    await assert.rejects(heater.getCharacteristic(api.hap.Characteristic.Active).handleSetRequest(1));
    assert.equal(calls.filter(path => path === '/deviceRequestWriting').length, 1);
    assert.equal(calls.filter(path => path === '/userLogin').length, 1);
    assert.equal(calls.filter(path => path === '/deviceGetBufferReading').length, 2);
  });
}

for (const control of ['powerful', 'auto', 'chrono']) {
const label = control === 'chrono' ? 'Chrono' : control === 'auto' ? 'Auto' : 'Powerful';
const State = control === 'chrono' ? ChronoCommandState : control === 'auto' ? AutoCommandState : PowerfulCommandState;
for (const target of [0, 1]) {
  test(`${label} pending ${target} survives disabling its option, keeps UUID and resolves without replay`, async context => {
    let mode = 1 - target;
    const { api, platform, calls, logs, root } = await cloudHarness(context, path => {
      if (path === '/deviceGetRegistersMap') {
        return { Success: true, device_registers_map: { registers_map: [{
          id: 'mock-map', registers: [...controlRegisters, ...powerfulRegisters, chronoRegister],
        }] } };
      }
      if (path === '/deviceJobStatus/job') {
        return { Success: true, jobAnswerStatus: 'completed',
          jobAnswerData: { Items: [103, 8, 232, 33120, 33132, 33128, 33154, 33162],
            Values: [23, 0, 0, 5, 4, control === 'auto' ? mode : 0, control === 'powerful' ? mode : 0,
              control === 'chrono' ? mode : 0] } };
      }
      assert.notEqual(path, '/deviceRequestWriting');
      return sensorResponse(path);
    }, { enableTemperatureSensor: true, enablePowerSwitch: true });
    await loadAppIdentity(root);
    const uuid = api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature']));
    await new State(root).begin(uuid, target);
    const accessory = new api.platformAccessory('Cached', uuid);
    accessory.addService(api.hap.Service.TemperatureSensor, 'Cached');
    accessory.addService(api.hap.Service.Switch, `Cached ${label}`, control);
    platform.configureAccessory(accessory);
    const registered = [];
    api.on('registerPlatformAccessories', accessories => registered.push(...accessories));
    context.mock.timers.enable({ apis: ['setTimeout'] });
    api.emit('didFinishLaunching');
    await until(() => calls.includes('/deviceGetBufferReading'));
    await immediate();
    context.mock.timers.tick(1000);
    await until(() => logs.some(entry => entry[0].includes('Cloud refresh successful')));
    assert.equal(accessory.getServiceById(api.hap.Service.Switch, control), undefined);
    const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(api.hap.Characteristic.On);
    assert.equal(await on.handleGetRequest(), false);
    await assert.rejects(on.handleSetRequest(true));
    assert.equal(await new State(root).load(uuid), target);
    mode = target;
    context.mock.timers.tick(60_000);
    await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
    await immediate();
    context.mock.timers.tick(1000);
    await until(() => logs.some(entry => entry[0].includes(`Pending ${label} resolved`)));
    assert.equal(await on.handleGetRequest(), false);
    assert.equal(await new State(root).load(uuid), undefined);
    assert.equal(accessory.UUID, uuid);
    assert.equal(registered.length, 0);
    assert.equal(calls.includes('/deviceRequestWriting'), false);
  });
}
}

for (const mode of ['powerful', 'chrono']) {
test(`incompatible ${mode} settings fault only that switch, not actual temperature or stove power`, async context => {
  const { api, calls, logs } = await cloudHarness(context, path => {
    if (path === '/deviceGetRegistersMap') {
      return { Success: true, device_registers_map: { registers_map: [{
        id: 'mock-map', registers: [...controlRegisters, ...powerfulRegisters.map(entry =>
          mode === 'powerful' && entry.reg_key === 'fun_pwf_set' ? { ...entry, mask: 255 } : entry),
        { ...chronoRegister, ...(mode === 'chrono' ? { is_word: true } : {}) }],
      }] } };
    }
    if (path === '/deviceJobStatus/job') {
      return { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [103, 8, 232, 33120, 33132, 33128, 33154], Values: [23, 0, 0, 5, 4, 0, 0] } };
    }
    assert.notEqual(path, '/deviceRequestWriting');
    return sensorResponse(path);
  }, { enableTemperatureSensor: true, enablePowerSwitch: true, enablePowerfulControl: mode === 'powerful',
    enableChronoControl: mode === 'chrono' });
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => calls.includes('/deviceGetBufferReading'));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes(mode === 'chrono' ? 'chrono-observation' : 'operating-settings')));
  const accessory = published[0];
  const C = api.hap.Characteristic;
  assert.equal(await accessory.getService(api.hap.Service.TemperatureSensor).getCharacteristic(C.CurrentTemperature).handleGetRequest(), 23);
  assert.equal(await accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(C.On).handleGetRequest(), false);
  await assert.rejects(accessory.getServiceById(api.hap.Service.Switch, mode).getCharacteristic(C.On).handleGetRequest());
  await assert.rejects(accessory.getServiceById(api.hap.Service.Switch, mode).getCharacteristic(C.On).handleSetRequest(true));
});
}

test('restored ventilation lock blocks power even with ventilation disabled and never replays a write', async context => {
  let level = 4;
  const { api, platform, calls, logs, root } = await cloudHarness(context, path => {
    if (path === '/deviceGetRegistersMap') {
      return { Success: true, device_registers_map: { registers_map: [{
        id: 'mock-map', registers: [...controlRegisters, ...ventilationRegisters],
      }] } };
    }
    if (path === '/deviceJobStatus/job') {
      return { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [103, 8, 232, 33120, 33132, 33128, 33154], Values: [23, 0, 0, 5, level, 0, 0] } };
    }
    assert.notEqual(path, '/deviceRequestWriting');
    return sensorResponse(path);
  }, { enableTemperatureSensor: true, enablePowerSwitch: true });
  await loadAppIdentity(root);
  const uuid = api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature']));
  await new VentilationCommandState(root).begin(uuid, 6);
  const accessory = new api.platformAccessory('Cached', uuid);
  accessory.addService(api.hap.Service.TemperatureSensor, 'Cached');
  accessory.addService(api.hap.Service.HeaterCooler, 'Cached heating', 'heating').addCharacteristic(api.hap.Characteristic.RotationSpeed);
  platform.configureAccessory(accessory);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => calls.includes('/deviceGetBufferReading'));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('Cloud refresh successful')));
  const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(api.hap.Characteristic.On);
  assert.equal(accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating'), undefined);
  assert.equal(await on.handleGetRequest(), false);
  await assert.rejects(on.handleSetRequest(true));
  assert.equal(await new VentilationCommandState(root).load(uuid), 6);
  level = 6;
  context.mock.timers.tick(60_000);
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('Pending ventilation resolved')));
  await until(() => on.statusCode === 0);
  assert.equal(await on.handleGetRequest(), false);
  assert.equal(await new VentilationCommandState(root).load(uuid), undefined);
  assert.equal(calls.includes('/deviceRequestWriting'), false);
});

test('ECO STOP confirms a persisted ON target without commands because the stove is activated but idle', async context => {
  const { api, platform, calls, logs, root } = await cloudHarness(context, path => {
    if (path === '/deviceGetRegistersMap') {
      return { Success: true, device_registers_map: { registers_map: [{ id: 'mock-map', registers: [
        controlRegisters[0],
        { ...controlRegisters[1], enc_val: [{ value: 8, lang: 'FRE', description: 'ECO STOP' }] },
        controlRegisters[2], setpointRegister,
      ] }] } };
    }
    if (path === '/deviceJobStatus/job') {
      return { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [103, 8, 232, 33122], Values: [23, 8, 0, 20] } };
    }
    assert.notEqual(path, '/deviceRequestWriting');
    return sensorResponse(path);
  }, { enableTemperatureSensor: true, enablePowerSwitch: true, enableSetpointControl: true });
  const uuid = api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature']));
  const accessory = new api.platformAccessory('Cached', uuid);
  accessory.addService(api.hap.Service.TemperatureSensor, 'Cached');
  accessory.addService(api.hap.Service.Switch, 'Cached power', 'power');
  accessory.addService(api.hap.Service.Thermostat, 'Cached heating', 'heating');
  platform.configureAccessory(accessory);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => calls.includes('/deviceGetBufferReading'));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('Cloud refresh successful')));
  const C = api.hap.Characteristic;
  const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(C.On);
  const thermostat = accessory.getServiceById(api.hap.Service.Thermostat, 'heating');
  assert.equal(accessory.getService(api.hap.Service.TemperatureSensor), undefined);
  assert.equal(await on.handleGetRequest(), true);
  assert.equal(await thermostat.getCharacteristic(C.TargetHeatingCoolingState).handleGetRequest(), C.TargetHeatingCoolingState.HEAT);
  assert.equal(await thermostat.getCharacteristic(C.CurrentHeatingCoolingState).handleGetRequest(), C.CurrentHeatingCoolingState.OFF);
  assert.equal(await thermostat.getCharacteristic(C.TargetTemperature).handleGetRequest(), 20);
  const count = calls.length;
  await on.handleSetRequest(true);
  await assert.rejects(thermostat.getCharacteristic(C.TargetTemperature).handleSetRequest(28));
  assert.equal(calls.length, count);
  await new PowerCommandState(root).begin(uuid, 'on');
  context.mock.timers.tick(60_000);
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.filter(entry => entry[0].includes('Cloud refresh successful')).length === 2);
  assert.equal(await on.handleGetRequest(), true);
  assert.equal(await thermostat.getCharacteristic(C.TargetHeatingCoolingState).handleGetRequest(), C.TargetHeatingCoolingState.HEAT);
  assert.equal(await new PowerCommandState(root).load(uuid), undefined);
  assert.equal(accessory.context.pendingPowerAction, undefined);
  assert.ok(logs.some(entry => entry[0].includes('Pending power command resolved')));
  assert.equal(calls.includes('/deviceRequestWriting'), false);
});

test('HomeKit setpoint writes once, blocks both tiles until target readback and preserves temperature and accessory identity', async context => {
  let setpoint = 20;
  const { api, calls, logs, root } = await cloudHarness(context, path => {
    if (path === '/deviceGetRegistersMap') {
      return { Success: true, device_registers_map: { registers_map: [{
        id: 'mock-map', registers: [...controlRegisters, setpointRegister],
      }] } };
    }
    if (path === '/deviceRequestWriting') {
      return { Success: true, idRequest: 'write' };
    }
    if (path === '/deviceJobStatus/write') {
      return { Success: true, jobAnswerStatus: 'completed', jobAnswerData: {} };
    }
    if (path === '/deviceJobStatus/job') {
      return { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [103, 8, 232, 33122], Values: [23, 0, 0, setpoint] } };
    }
    return sensorResponse(path);
  }, { enableTemperatureSensor: true, enablePowerSwitch: true, enableSetpointControl: true });
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => calls.includes('/deviceGetBufferReading'));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('Cloud refresh successful')));
  const accessory = published[0];
  const C = api.hap.Characteristic;
  const thermostat = accessory.getServiceById(api.hap.Service.Thermostat, 'heating');
  const target = thermostat.getCharacteristic(C.TargetTemperature);
  const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(C.On);
  assert.equal(await target.handleGetRequest(), 20);
  const pending = target.handleSetRequest(28);
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => calls.includes('/deviceRequestWriting'));
  assert.equal(accessory.context.pendingSetpoint, 28);
  await assert.rejects(on.handleSetRequest(true));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 3);
  await immediate();
  context.mock.timers.tick(1000);
  await pending;
  await until(() => logs.some(entry => entry[0].includes('HomeKit Setpoint processing finished')));
  assert.equal(await target.handleGetRequest(), 20);
  assert.notEqual(target.value, 28);
  assert.equal(await new SetpointCommandState(root).load(accessory.UUID), 28);
  assert.equal(calls.filter(path => path === '/deviceRequestWriting').length, 1);
  setpoint = 28;
  context.mock.timers.tick(5000);
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 4);
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('Pending setpoint resolved')));
  await until(() => target.statusCode === 0);
  assert.equal(await target.handleGetRequest(), 28);
  assert.equal(await thermostat.getCharacteristic(C.TargetHeatingCoolingState).handleGetRequest(), C.TargetHeatingCoolingState.OFF);
  assert.equal(await thermostat.getCharacteristic(C.CurrentHeatingCoolingState).handleGetRequest(), C.CurrentHeatingCoolingState.OFF);
  assert.equal(await on.handleGetRequest(), false);
  assert.equal(await new SetpointCommandState(root).load(accessory.UUID), undefined);
  assert.equal(accessory.getService(api.hap.Service.TemperatureSensor), undefined);
  assert.equal(await thermostat.getCharacteristic(C.CurrentTemperature).handleGetRequest(), 23);
  assert.equal(published.length, 1);
  assert.equal(accessory.UUID, api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature'])));
  api.emit('shutdown');
  await assert.rejects(target.handleGetRequest());
});

for (const [action, initialPhase, thermostatControl, indicator = false, ventilation = false] of [
  ['on', 0, false], ['off', 5, false], ['off', 8, false], ['off', 8, true],
  ['on', 0, true, true], ['off', 8, true, true],
  ['on', 0, true, true, true], ['off', 8, true, true, true],
]) {
test(`opt-in HomeKit ${action} from ${initialPhase} via ${thermostatControl ? 'heating' : 'switch'} indicator=${indicator} ventilation=${ventilation} sends once, stays readable while pending and resolves only from API phases`, async context => {
  const target = action === 'on';
  let phase = initialPhase;
  const { api, calls, logs } = await cloudHarness(context, path => {
    if (path === '/deviceGetRegistersMap') {
      return { Success: true, device_registers_map: { registers_map: [{ id: 'mock-map', registers: [
        controlRegisters[0], { ...controlRegisters[1], enc_val: [...controlRegisters[1].enc_val,
          { value: 8, lang: 'FRE', description: 'ECO STOP' }] }, controlRegisters[2], setpointRegister,
        ...(ventilation ? powerfulRegisters : []),
      ] }] } };
    }
    if (path === '/deviceRequestWriting') {
      return { Success: true, idRequest: 'write' };
    }
    if (path === '/deviceJobStatus/write') {
      return { Success: true, jobAnswerStatus: 'completed', jobAnswerData: {} };
    }
    if (path === '/deviceJobStatus/job') {
      return { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [103, 8, 232, 33122, 33120, 33132, 33128, 33154], Values: [23, phase, 0, 20, 5, 4, 0, 0] } };
    }
    return sensorResponse(path);
  }, { enableTemperatureSensor: true, enablePowerSwitch: true, enableSetpointControl: true,
    useHeatingActivityIndicator: indicator, enableVentilationControl: ventilation });
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => calls.includes('/deviceGetBufferReading'));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('Cloud refresh successful')));
  const accessory = published[0];
  const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(api.hap.Characteristic.On);
  assert.equal(await on.handleGetRequest(), indicator ? initialPhase === 5 : !target);
  const C = api.hap.Characteristic;
  const heatingService = accessory.getServiceById(ventilation ? api.hap.Service.HeaterCooler : api.hap.Service.Thermostat, 'heating');
  const heatingMode = heatingService.getCharacteristic(ventilation ? C.Active : C.TargetHeatingCoolingState);
  if (indicator) {
    const count = calls.length;
    await assert.rejects(on.handleSetRequest(target));
    assert.equal(calls.length, count);
  }
  const pending = thermostatControl ? heatingMode.handleSetRequest(Number(target))
    : on.handleSetRequest(target);
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => calls.includes('/deviceRequestWriting'));
  assert.equal(accessory.context.pendingPowerAction, action);
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 3);
  await immediate();
  context.mock.timers.tick(1000);
  await pending;
  await until(() => logs.some(entry => entry[0].includes('HomeKit Power processing finished')));
  assert.equal(await on.handleGetRequest(), indicator ? initialPhase === 5 : !target);
  assert.equal(await heatingMode.handleGetRequest(), target ? C.TargetHeatingCoolingState.OFF : C.TargetHeatingCoolingState.HEAT);
  if (!indicator) {
    assert.notEqual(on.value, target);
  }
  await assert.rejects(on.handleSetRequest(target));
  assert.equal(calls.filter(path => path === '/deviceRequestWriting').length, 1);
  for (const [index, next] of [[4, target ? 2 : 7], [5, target ? 5 : 0]]) {
    phase = next;
    await immediate();
    context.mock.timers.tick(5000);
    await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === index);
    await immediate();
    context.mock.timers.tick(1000);
    await until(() => logs.filter(entry => entry[0].includes('Cloud refresh successful')).length === index - 2);
    if (phase === 2 || phase === 7) {
      assert.equal(await on.handleGetRequest(), indicator ? false : !target);
    }
  }
  assert.equal(await on.handleGetRequest(), target);
  assert.equal(await heatingMode.handleGetRequest(), target ? C.TargetHeatingCoolingState.HEAT : C.TargetHeatingCoolingState.OFF);
  assert.equal(accessory.context.pendingPowerAction, undefined);
  assert.equal(calls.filter(path => path === '/deviceRequestWriting').length, 1);
  assert.equal(published.length, 1);
  assert.equal(accessory.getService(api.hap.Service.TemperatureSensor), undefined);
  assert.equal(await heatingService.getCharacteristic(C.CurrentTemperature).handleGetRequest(), 23);
});
}

test('disabled power option removes a cached switch without erasing a pending command marker or replaying it', async context => {
  const { api, platform } = await cloudHarness(context, path => sensorResponse(path), { enableTemperatureSensor: true });
  const uuid = api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature']));
  const accessory = new api.platformAccessory('Old', uuid);
  accessory.addService(api.hap.Service.TemperatureSensor, 'Old');
  accessory.addService(api.hap.Service.Switch, 'Old power', 'power');
  accessory.addService(api.hap.Service.HeaterCooler, 'Old heating', 'heating');
  accessory.addService(api.hap.Service.Thermostat, 'Restored heating', 'heating');
  accessory.context.pendingPowerAction = 'on';
  platform.configureAccessory(accessory);
  const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(api.hap.Characteristic.On);
  await assert.rejects(on.handleGetRequest());
  api.emit('didFinishLaunching');
  assert.equal(accessory.getServiceById(api.hap.Service.Switch, 'power'), undefined);
  assert.equal(accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating'), undefined);
  assert.equal(accessory.getServiceById(api.hap.Service.Thermostat, 'heating'), undefined);
  assert.equal(accessory.context.pendingPowerAction, 'on');
});

test('power restart loads private pending state even when accessory context is absent and never replays it', async context => {
  const { api, calls, logs, root } = await cloudHarness(context, path => {
    if (path === '/deviceGetRegistersMap') {
      return { Success: true, device_registers_map: { registers_map: [{ id: 'mock-map', registers: controlRegisters }] } };
    }
    if (path === '/deviceJobStatus/job') {
      return { Success: true, jobAnswerStatus: 'completed', jobAnswerData: { Items: [103, 8, 232], Values: [23, 0, 0] } };
    }
    assert.notEqual(path, '/deviceRequestWriting');
    return sensorResponse(path);
  }, { enableTemperatureSensor: true, enablePowerSwitch: true });
  await loadAppIdentity(root);
  const uuid = api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature']));
  await new PowerCommandState(root).begin(uuid, 'on');
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => calls.includes('/deviceGetBufferReading'));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('Cloud refresh successful')));
  const accessory = published[0];
  assert.equal(accessory.context.pendingPowerAction, 'on');
  const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(api.hap.Characteristic.On);
  assert.equal(await on.handleGetRequest(), false);
  await assert.rejects(on.handleSetRequest(true));
  assert.equal(calls.includes('/deviceRequestWriting'), false);
  assert.equal(await new PowerCommandState(root).load(uuid), 'on');
});

test('restored pending setpoint blocks the switch even when the heating tile is disabled', async context => {
  const { api, calls, logs, root } = await cloudHarness(context, path => {
    if (path === '/deviceGetRegistersMap') {
      return { Success: true, device_registers_map: { registers_map: [{
        id: 'mock-map', registers: [...controlRegisters, setpointRegister],
      }] } };
    }
    if (path === '/deviceJobStatus/job') {
      return { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [103, 8, 232, 33122], Values: [23, 0, 0, 20] } };
    }
    assert.notEqual(path, '/deviceRequestWriting');
    return sensorResponse(path);
  }, { enableTemperatureSensor: true, enablePowerSwitch: true });
  await loadAppIdentity(root);
  const uuid = api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature']));
  await new SetpointCommandState(root).begin(uuid, 28);
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => calls.includes('/deviceGetBufferReading'));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('Cloud refresh successful')));
  const accessory = published[0];
  assert.equal(accessory.context.pendingSetpoint, 28);
  const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(api.hap.Characteristic.On);
  assert.equal(await on.handleGetRequest(), false);
  await assert.rejects(on.handleSetRequest(true));
  assert.equal(accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating'), undefined);
  assert.equal(accessory.getServiceById(api.hap.Service.Thermostat, 'heating'), undefined);
  assert.equal(calls.includes('/deviceRequestWriting'), false);
});

test('Homebridge status diagnostics share the sensor read, log changes only and never expose map labels or heating services', async context => {
  let phase = 0;
  let managed = 0;
  const { api, calls, logs } = await cloudHarness(context,
    path => statusSensorResponse(path, phase, managed), { enableTemperatureSensor: true });
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  for (let cycle = 1; cycle <= 3; cycle++) {
    if (cycle > 1) {
      if (cycle === 3) {
        phase = 5;
        managed = 85;
      }
      context.mock.timers.tick(60_000);
    }
    await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === cycle);
    await immediate();
    context.mock.timers.tick(1000);
    await until(() => logs.filter(entry => entry[0].includes('discovery successful')).length === cycle);
    await immediate();
    assert.equal(logs.filter(entry => entry[0].includes('Read-only status codes')).length, cycle === 3 ? 2 : 1);
  }
  const statusLogs = logs.filter(entry => entry[0].includes('Read-only status codes'));
  assert.match(statusLogs[0][0], /status_get=0 \(FRE label available\); status_managed_get=0 \(no FRE label\)/);
  assert.match(statusLogs[1][0], /status_get=5 .*status_managed_get=85/);
  assert.match(statusLogs[0][0], /Observed phase: unknown \(label-mismatch\)/);
  assert.equal(calls.filter(path => path === '/deviceGetBufferReading').length, 3);
  assert.equal(calls.includes('/deviceRequestWriting'), false);
  for (const privateText of ['private-map-label', 'mock-device', 'mock-product', 'mock-password', 'fictional-token']) {
    assert.equal(JSON.stringify(logs).includes(privateText), false);
  }
  assert.equal(published.length, 1);
  const accessory = published[0];
  assert.equal(await accessory.getService(api.hap.Service.TemperatureSensor)
    .getCharacteristic(api.hap.Characteristic.CurrentTemperature).handleGetRequest(), 23);
  assert.equal(accessory.getService(api.hap.Service.Thermostat), undefined);
  assert.equal(accessory.getService(api.hap.Service.HeaterCooler), undefined);
  api.emit('shutdown');
  const count = calls.length;
  context.mock.timers.tick(3_600_000);
  await immediate();
  assert.equal(calls.length, count);
});

test('unsupported status diagnostics warn once without faulting valid temperature and recover on a supported reading', async context => {
  let supported = false;
  const { api, calls, logs } = await cloudHarness(context,
    path => supported ? statusSensorResponse(path) : sensorResponse(path), { enableTemperatureSensor: true });
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  for (let cycle = 1; cycle <= 3; cycle++) {
    if (cycle > 1) {
      supported = cycle === 3;
      context.mock.timers.tick(60_000);
    }
    await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === cycle);
    await immediate();
    context.mock.timers.tick(1000);
    await until(() => logs.filter(entry => entry[0].includes('discovery successful')).length === cycle);
    await immediate();
    const service = published[0].getService(api.hap.Service.TemperatureSensor);
    assert.equal(await service.getCharacteristic(api.hap.Characteristic.CurrentTemperature).handleGetRequest(), 23);
    assert.equal(service.getCharacteristic(api.hap.Characteristic.StatusFault).value, 0);
  }
  assert.equal(logs.filter(entry => entry[0].includes('Status diagnostic unavailable')).length, 1);
  assert.equal(logs.filter(entry => entry[0].includes('Read-only status codes')).length, 1);
  assert.equal(logs.some(entry => entry[0].includes('Automatic discovery stopped')), false);
  assert.equal(published.length, 1);
});

test('disabled diagnostics neither inspect nor log status codes even with the temperature sensor enabled', async context => {
  const { api, calls, logs } = await cloudHarness(context, path => statusSensorResponse(path),
    { enableTemperatureSensor: true, diagnostic: false });
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => calls.includes('/deviceGetBufferReading'));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => published.length === 1);
  await immediate();
  assert.equal(logs.some(entry => /status_get|status_managed_get|status-observation/.test(entry[0])), false);
  assert.equal(calls.filter(path => path === '/deviceGetBufferReading').length, 1);
});

test('enabled sensor publishes real HAP temperature only and marks failures without stale successful GETs', async context => {
  let failing = false;
  const { api, calls, logs } = await cloudHarness(context, path => {
    if (failing) {
      throw new Error('private detail');
    }
    return statusSensorResponse(path);
  }, { enableTemperatureSensor: true, stoveName: 'Test temperature' });
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => calls.includes('/deviceGetBufferReading'));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('discovery successful')));
  assert.equal(published.length, 1);
  const accessory = published[0];
  const service = accessory.getService(api.hap.Service.TemperatureSensor);
  const current = service.getCharacteristic(api.hap.Characteristic.CurrentTemperature);
  assert.equal(await current.handleGetRequest(), 23);
  assert.equal(service.getCharacteristic(api.hap.Characteristic.StatusFault).value, 0);
  assert.equal(logs.filter(entry => entry[0].includes('Read-only status codes')).length, 1);
  assert.equal(accessory.getService(api.hap.Service.Thermostat), undefined);
  assert.equal(accessory.getService(api.hap.Service.HeaterCooler), undefined);
  assert.equal(current.setter, undefined);
  failing = true;
  context.mock.timers.tick(60_000);
  await until(() => logs.some(entry => entry[0].includes('network')));
  assert.ok(logs.some(entry => entry[0].includes('Temperature sensor remains unavailable')));
  await assert.rejects(current.handleGetRequest());
  assert.equal(service.getCharacteristic(api.hap.Characteristic.StatusFault).value, 1);
  failing = false;
  await immediate();
  context.mock.timers.tick(180_000);
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length >= 2);
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => service.getCharacteristic(api.hap.Characteristic.StatusFault).value === 0);
  assert.ok(logs.some(entry => entry[0].includes('Temperature sensor updated; measurement freshness unknown')));
  assert.equal(await current.handleGetRequest(), 23);
  assert.equal(published.length, 1);
  assert.equal(logs.filter(entry => entry[0].includes('Read-only status codes')).length, 2);
  api.emit('shutdown');
  await assert.rejects(current.handleGetRequest());
});

test('cached sensor keeps the same UUID and services across restart without publishing duplicates', async context => {
  const { api, platform, calls, logs } = await cloudHarness(context, path => sensorResponse(path), { enableTemperatureSensor: true });
  const uuid = api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature']));
  const cached = new api.platformAccessory('Old name', uuid);
  cached.addService(api.hap.Service.TemperatureSensor, 'Old name');
  platform.configureAccessory(cached);
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  const current = cached.getService(api.hap.Service.TemperatureSensor).getCharacteristic(api.hap.Characteristic.CurrentTemperature);
  await assert.rejects(current.handleGetRequest());
  await until(() => calls.includes('/deviceGetBufferReading'));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('discovery successful')));
  assert.equal(await current.handleGetRequest(), 23);
  assert.deepEqual(published, []);
  assert.equal(cached.UUID, uuid);
  assert.equal(cached.services.filter(service => service.UUID === api.hap.Service.TemperatureSensor.UUID).length, 1);
});

test('out-of-range temperature faults the cached sensor and retries until a valid reading without clamping', async context => {
  let readings = 0;
  const { api, platform, calls, logs } = await cloudHarness(context, path => {
    if (path === '/deviceGetRegistersMap') {
      return { Success: true, device_registers_map: { registers_map: [{
        id: 'mock-map', registers: [ambientRegister],
      }] } };
    }
    if (path === '/deviceJobStatus/job') {
      readings++;
      return { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [103], Values: [readings === 1 ? 65535 : 23] } };
    }
    return sensorResponse(path);
  }, { enableTemperatureSensor: true, pollIntervalSeconds: 30 });
  const uuid = api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature']));
  const cached = new api.platformAccessory('Cached', uuid);
  cached.addService(api.hap.Service.TemperatureSensor, 'Cached');
  platform.configureAccessory(cached);
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => calls.includes('/deviceGetBufferReading'));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('Cloud refresh retry scheduled')
    && entry[0].includes('outside the HomeKit range')));
  assert.ok(logs.some(entry => entry[0].includes('homekit-temperature-range')));
  const service = cached.getService(api.hap.Service.TemperatureSensor);
  const current = service.getCharacteristic(api.hap.Characteristic.CurrentTemperature);
  assert.equal(service.getCharacteristic(api.hap.Characteristic.StatusFault).value, 1);
  await assert.rejects(current.handleGetRequest());
  assert.equal(logs.some(entry => entry[0].includes('Automatic discovery stopped')), false);
  context.mock.timers.tick(120_000);
  await immediate();
  assert.ok(calls.filter(path => path === '/deviceGetBufferReading').length >= 2,
    JSON.stringify({ calls, logs }));
  await until(() => calls.filter(path => path === '/deviceJobStatus/job').length >= 2);
  await immediate();
  context.mock.timers.tick(1000);
  await immediate();
  assert.ok(logs.some(entry => entry[0].includes('Read-only discovery successful')));
  assert.equal(await current.handleGetRequest(), 23);
  assert.equal(service.getCharacteristic(api.hap.Characteristic.StatusFault).value, 0);
  assert.deepEqual(published, []);
  assert.equal(calls.filter(path => path === '/deviceRequestWriting').length, 0);
});

test('incompatible register profile faults a cached sensor and stops polling without publishing a replacement', async context => {
  const { api, platform, calls, logs } = await cloudHarness(context, path => path === '/deviceGetRegistersMap'
    ? { Success: true, device_registers_map: { registers_map: [{
      id: 'mock-map', registers: [{ ...ambientRegister, formula: '#/10' }],
    }] } }
    : sensorResponse(path), { enableTemperatureSensor: true });
  const cached = new api.platformAccessory('Cached',
    api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature'])));
  platform.configureAccessory(cached);
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  api.emit('didFinishLaunching');
  await until(() => logs.some(entry => entry[0].includes('Automatic discovery stopped')));
  assert.deepEqual(published, []);
  const service = cached.getService(api.hap.Service.TemperatureSensor);
  await assert.rejects(service.getCharacteristic(api.hap.Characteristic.CurrentTemperature).handleGetRequest());
  assert.equal(service.getCharacteristic(api.hap.Characteristic.StatusFault).value, 1);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const count = calls.length;
  context.mock.timers.tick(3_600_000);
  await immediate();
  assert.equal(calls.length, count);
});

test('shutdown during buffer polling prevents sensor publication and later requests', async context => {
  const { api, calls } = await cloudHarness(context, path => sensorResponse(path), { enableTemperatureSensor: true });
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  api.emit('didFinishLaunching');
  await until(() => calls.includes('/deviceGetBufferReading'));
  api.emit('shutdown');
  await immediate();
  const count = calls.length;
  context.mock.timers.enable({ apis: ['setTimeout'] });
  context.mock.timers.tick(3_600_000);
  await immediate();
  assert.equal(calls.length, count);
  assert.deepEqual(published, []);
});

test('successful selection removes obsolete cached sensors and keeps the selected stable accessory', async context => {
  const { api, platform, logs } = await cloudHarness(context, path => sensorResponse(path), { enableTemperatureSensor: true });
  const stale = new api.platformAccessory('Old stove', api.hap.uuid.generate('old-stove'));
  platform.configureAccessory(stale);
  const removed = [];
  const published = [];
  api.on('unregisterPlatformAccessories', accessories => removed.push(...accessories));
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  api.emit('didFinishLaunching');
  await until(() => logs.some(entry => entry[0].includes('discovery successful')));
  assert.deepEqual(removed, [stale]);
  assert.equal(published.length, 1);
  assert.notEqual(published[0].UUID, stale.UUID);
});

test('disabling the sensor removes cached accessories without cloud access', () => {
  const api = new HomebridgeAPI();
  const { log } = harness();
  const platform = new NobisPlatform(log, {
    platform: PLATFORM_NAME, email: 'reader@example.invalid', password: 'fictitious',
  }, api);
  const cached = new api.platformAccessory('Cached', api.hap.uuid.generate('fictitious'));
  platform.configureAccessory(cached);
  const removed = [];
  api.on('unregisterPlatformAccessories', accessories => removed.push(...accessories));
  api.emit('didFinishLaunching');
  assert.deepEqual(removed, [cached]);
  api.emit('shutdown');
});

test('offline stove faults the cached sensor without buffer requests or an invented OFF state', async context => {
  const { api, platform, calls, logs } = await cloudHarness(context, path => {
    assert.equal(path, '/deviceList');
    return { Success: true, device: [{
      id_device: 'mock-device', id_product: 'mock-product', name: 'Mock', is_online: false,
    }] };
  }, { enableTemperatureSensor: true });
  const cached = new api.platformAccessory('Cached',
    api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, 'mock-product', 'mock-device', 'temperature'])));
  platform.configureAccessory(cached);
  api.emit('didFinishLaunching');
  await until(() => logs.some(entry => entry[0].includes('Cloud refresh retry scheduled')));
  assert.deepEqual(calls, ['/appSignup', '/userLogin', '/deviceList']);
  const service = cached.getService(api.hap.Service.TemperatureSensor);
  await assert.rejects(service.getCharacteristic(api.hap.Characteristic.CurrentTemperature).handleGetRequest());
  assert.equal(service.getCharacteristic(api.hap.Characteristic.StatusFault).value, 1);
  assert.equal(cached.getService(api.hap.Service.HeaterCooler), undefined);
});

test('invalid configuration never serves a cached temperature as a successful current measurement', async () => {
  const api = new HomebridgeAPI();
  const { log } = harness();
  const platform = new NobisPlatform(log, { platform: PLATFORM_NAME }, api);
  const cached = new api.platformAccessory('Cached', api.hap.uuid.generate('fictitious-cache'));
  const service = cached.addService(api.hap.Service.TemperatureSensor, 'Cached');
  service.updateCharacteristic(api.hap.Characteristic.CurrentTemperature, 24);
  platform.configureAccessory(cached);
  await assert.rejects(service.getCharacteristic(api.hap.Characteristic.CurrentTemperature).handleGetRequest());
  assert.equal(service.getCharacteristic(api.hap.Characteristic.StatusFault).value, 1);
  assert.equal(api.listenerCount('didFinishLaunching'), 0);
});

async function until(predicate) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => realSetTimeout(resolve, 5));
  }
  assert.fail('Expected asynchronous platform progress');
}

function discoveryResponse(path) {
  if (path === '/deviceList') {
    return { Success: true, device: [{ id_device: 'mock-device', id_product: 'mock-product', name: 'Mock', is_online: true }] };
  }
  if (path === '/deviceGetInfo') {
    return { Success: true, Value: true, device_info: [{ id_registers_map: 'mock-map' }] };
  }
  assert.equal(path, '/deviceGetRegistersMap');
  return { Success: true, device_registers_map: { registers_map: [{ id: 'mock-map', registers: [] }] } };
}

test('explicitly enabled discovery reads definitions only, without buffers, commands or concurrent launch loops', async (context) => {
  const { api, calls, logs } = await cloudHarness(context, discoveryResponse);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  api.emit('didFinishLaunching');
  await until(() => logs.some((entry) => entry[0].includes('discovery successful')));
  assert.deepEqual(calls, ['/appSignup', '/userLogin', '/deviceList', '/deviceGetInfo', '/deviceGetRegistersMap']);
  assert.equal(JSON.stringify(logs).includes('mock-password'), false);
  context.mock.timers.tick(60_000);
  await until(() => calls.length === 8);
  await immediate();
  api.emit('shutdown');
  const count = calls.length;
  context.mock.timers.tick(3_600_000);
  await immediate();
  assert.equal(calls.length, count);
});

test('network failure schedules backoff rather than an immediate reconnect loop', async (context) => {
  const { api, calls, logs } = await cloudHarness(context, () => { throw new Error('private backend detail'); });
  context.mock.method(Math, 'random', () => 0);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => logs.some((entry) => entry[0].includes('network')));
  await immediate();
  context.mock.timers.tick(89_999);
  await immediate();
  assert.equal(calls.filter((path) => path === '/deviceList').length, 1);
  context.mock.timers.tick(1);
  await until(() => calls.filter((path) => path === '/deviceList').length === 2);
  assert.equal(JSON.stringify(logs).includes('private backend detail'), false);
  api.emit('shutdown');
});

test('protocol errors stop automatic discovery instead of being retried forever', async (context) => {
  const { api, calls, logs } = await cloudHarness(context, () => ({ Success: true, device: 'invalid' }));
  api.emit('didFinishLaunching');
  await until(() => logs.some((entry) => entry[0].includes('Automatic discovery stopped')));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  context.mock.timers.tick(3_600_000);
  await immediate();
  assert.equal(calls.filter((path) => path === '/deviceList').length, 1);
});

test('server Retry-After is honored before reconnecting', async (context) => {
  const { api, calls, logs } = await cloudHarness(context, () => new globalThis.Response(
    JSON.stringify({ Success: false }), { status: 429, headers: { 'retry-after': '300' } },
  ));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => logs.some((entry) => entry[0].includes('HTTP 429')));
  await immediate();
  context.mock.timers.tick(299_999);
  await immediate();
  assert.equal(calls.filter((path) => path === '/deviceList').length, 1);
  context.mock.timers.tick(1);
  await until(() => calls.filter((path) => path === '/deviceList').length === 2);
});

test('refused credentials or permissions stop discovery without an automatic retry', async (context) => {
  const { api, calls, logs } = await cloudHarness(context, () => new globalThis.Response(
    JSON.stringify({ Success: false, Error: '1104', Text: 'private-value' }), { status: 403 },
  ));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => logs.some((entry) => entry[0].includes('Automatic discovery stopped')));
  context.mock.timers.tick(3_600_000);
  await immediate();
  assert.equal(calls.filter((path) => path === '/deviceList').length, 1);
  assert.equal(JSON.stringify(logs).includes('private-value'), false);
});

test('shutdown before asynchronous storage completes prevents all network calls', async (context) => {
  const { api, calls } = await cloudHarness(context, discoveryResponse);
  api.emit('didFinishLaunching');
  api.emit('shutdown');
  for (let attempt = 0; attempt < 20; attempt++) {
    await immediate();
  }
  assert.deepEqual(calls, []);
});

test('reconnection delay is progressive, bounded and never shorter than the configured interval', () => {
  assert.equal(reconnectDelay(60_000, 1, 1), 120_000);
  assert.equal(reconnectDelay(60_000, 2, 1), 240_000);
  assert.equal(reconnectDelay(60_000, 100, 1), 900_000);
  assert.equal(reconnectDelay(3_600_000, 1, 0), 3_600_000);
});

test('registers and launches with the actual Homebridge API without publishing accessories', () => {
  const api = new HomebridgeAPI();
  const registration = [];
  api.on('registerPlatform', (...args) => registration.push(args));
  const publish = [];
  api.on('registerPlatformAccessories', (...args) => publish.push(args));
  register(api);
  assert.deepEqual(registration, [[PLATFORM_NAME, NobisPlatform, PLUGIN_NAME]]);

  const { log } = harness();
  const platform = new NobisPlatform(log, {
    platform: PLATFORM_NAME, email: 'reader@example.invalid', password: 'fictitious-test-secret',
  }, api);
  assert.equal(HomebridgeAPI.isDynamicPlatformPlugin(platform), true);
  api.signalFinished();
  api.signalShutdown();
  assert.deepEqual(publish, []);
});

test('unconfigured platform reports errors without installing launch tasks', () => {
  const { api, log, logs } = harness();
  new NobisPlatform(log, { platform: PLATFORM_NAME }, api);
  assert.equal(api.listenerCount('didFinishLaunching'), 0);
  assert.equal(api.listenerCount('shutdown'), 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0][0], /email, password/);
});

test('configured scaffold launches and shuts down without exposing fake devices or secrets', (context) => {
  const fetch = context.mock.method(globalThis, 'fetch', () => {
    assert.fail('The scaffold must not contact the cloud');
  });
  const { api, log, logs } = harness();
  const email = 'reader@example.invalid';
  const password = 'fictitious-test-secret';
  const platform = new NobisPlatform(log, { platform: PLATFORM_NAME, email, password }, api);
  const realApi = new HomebridgeAPI();
  const cached = new realApi.platformAccessory('Cached', api.hap.uuid.generate('fictional-stable-uuid'));
  platform.configureAccessory(cached);
  platform.configureAccessory(cached);
  api.emit('didFinishLaunching');
  api.emit('shutdown');
  assert.equal(logs.length, 1);
  assert.match(logs[0][0], /disabled/);
  assert.equal(JSON.stringify(logs).includes(email), false);
  assert.equal(JSON.stringify(logs).includes(password), false);
  assert.equal(fetch.mock.callCount(), 0);
});

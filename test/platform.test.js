import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as immediate } from 'node:timers/promises';
import test from 'node:test';
import { URL } from 'node:url';

import register from '../dist/index.js';
import { NobisPlatform, reconnectDelay } from '../dist/platform.js';
import { PLATFORM_NAME, PLUGIN_NAME } from '../dist/settings.js';

const require = createRequire(import.meta.url);
const { HomebridgeAPI } = require('homebridge/lib/api.js');
const realSetTimeout = globalThis.setTimeout;

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
        : await handler(path, calls);
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
  return { api, platform, calls, logs };
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

test('enabled sensor publishes real HAP temperature only and marks failures without stale successful GETs', async context => {
  let failing = false;
  const { api, calls, logs } = await cloudHarness(context, path => {
    if (failing) {
      throw new Error('private detail');
    }
    return sensorResponse(path);
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
  assert.equal(accessory.getService(api.hap.Service.Thermostat), undefined);
  assert.equal(accessory.getService(api.hap.Service.HeaterCooler), undefined);
  assert.equal(current.setter, undefined);
  failing = true;
  context.mock.timers.tick(60_000);
  await until(() => logs.some(entry => entry[0].includes('network')));
  await assert.rejects(current.handleGetRequest());
  assert.equal(service.getCharacteristic(api.hap.Characteristic.StatusFault).value, 1);
  failing = false;
  await immediate();
  context.mock.timers.tick(120_000);
  await until(() => calls.filter(path => path === '/deviceGetBufferReading').length === 2);
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => service.getCharacteristic(api.hap.Characteristic.StatusFault).value === 0);
  assert.equal(await current.handleGetRequest(), 23);
  assert.equal(published.length, 1);
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

test('temperature outside HomeKit range is rejected without clamping or accessory publication', async context => {
  const { api, calls, logs } = await cloudHarness(context, path => sensorResponse(path, 65535), { enableTemperatureSensor: true });
  const published = [];
  api.on('registerPlatformAccessories', accessories => published.push(...accessories));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  api.emit('didFinishLaunching');
  await until(() => calls.includes('/deviceGetBufferReading'));
  await immediate();
  context.mock.timers.tick(1000);
  await until(() => logs.some(entry => entry[0].includes('Automatic discovery stopped')));
  assert.ok(logs.some(entry => entry[0].includes('homekit-temperature-range')));
  assert.deepEqual(published, []);
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

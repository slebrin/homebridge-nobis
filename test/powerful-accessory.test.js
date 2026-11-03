import assert from 'node:assert/strict';
import test from 'node:test';
import { OperatingModeAccessory, PowerfulAccessory } from '../dist/powerful-accessory.js';
import { PowerAccessory } from '../dist/power-accessory.js';
import { HeatingAccessory } from '../dist/heating-accessory.js';
import { HomebridgeAPI } from './homebridge-api.js';

const settings = (powerful = 0, auto = 0, label = powerful === 1 ? 'ON' : 'OFF') => ({
  receivedAt: 123, freshness: 'unknown', controlValidated: false,
  registers: [
    { key: 'power_set', offset: 33120, rawValue: 5, label: null },
    { key: 'vent_front_set', offset: 33132, rawValue: 4, label: null },
    { key: 'fun_auto_set', offset: 33128, rawValue: auto, label: auto ? 'ON' : 'OFF' },
    { key: 'fun_pwf_set', offset: 33154, rawValue: powerful, label },
  ],
});
const status = kind => ({ phase: { kind } });

test('Auto switch coexists with Powerful, reports its own register and refuses interacting mode without implicit writes', async () => {
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Test', api.hap.uuid.generate('auto'));
  let commands = 0;
  let confirm = false;
  const auto = new OperatingModeAccessory(accessory, api, 'Test', async enabled => {
    commands++;
    if (confirm) {
      auto.update(settings(0, Number(enabled)), status('off'));
    }
  }, 'auto');
  const powerful = new PowerfulAccessory(accessory, api, 'Test', async () => assert.fail('No implicit Powerful write'));
  const on = accessory.getServiceById(api.hap.Service.Switch, 'auto').getCharacteristic(api.hap.Characteristic.On);
  const other = accessory.getServiceById(api.hap.Service.Switch, 'powerful').getCharacteristic(api.hap.Characteristic.On);
  auto.update(settings(0, 1), status('off'));
  powerful.update(settings(0, 1), status('off'));
  assert.equal(await on.handleGetRequest(), true);
  assert.equal(await other.handleGetRequest(), false);
  await assert.rejects(other.handleSetRequest(true));
  auto.update(settings(0, 0), status('off'));
  assert.equal(await on.handleSetRequest(true), false);
  assert.equal(await on.handleGetRequest(), false);
  assert.notEqual(on.value, true);
  confirm = true;
  await on.handleSetRequest(true);
  assert.equal(await on.handleGetRequest(), true);
  await on.handleSetRequest(false);
  assert.equal(await on.handleGetRequest(), false);
  assert.equal(commands, 3);
  auto.update(settings(1, 0), status('working'));
  assert.equal(await on.handleGetRequest(), false);
  await assert.rejects(on.handleSetRequest(true));
  for (const kind of ['starting', 'stopping', 'unknown']) {
    auto.update(settings(0, 0), status(kind));
    await assert.rejects(on.handleSetRequest(true));
  }
  for (const key of ['pendingPowerAction', 'pendingSetpoint', 'pendingVentilation', 'pendingPowerful', 'pendingAuto', 'pendingChrono']) {
    accessory.context[key] = 0;
    auto.update(settings(0, 0), status('off'));
    assert.equal(await on.handleGetRequest(), false);
    await assert.rejects(on.handleSetRequest(true));
    delete accessory.context[key];
  }
  auto.update({ ...settings(), registers: settings().registers.map(entry =>
    entry.key === 'fun_auto_set' ? { ...entry, label: 'UNKNOWN' } : entry) }, status('off'));
  await assert.rejects(on.handleGetRequest());
  const uuid = accessory.UUID;
  new OperatingModeAccessory(accessory, api, 'Renamed', async () => {}, 'auto');
  assert.equal(accessory.UUID, uuid);
  assert.equal(accessory.services.filter(service => service.subtype === 'auto').length, 1);
  assert.equal(accessory.services.filter(service => service.subtype === 'powerful').length, 1);
  await assert.rejects(on.handleGetRequest());
});

test('Auto and Powerful allow both ECO STOP targets without optimistic state or implicit changes', async () => {
  for (const mode of ['auto', 'powerful']) {
    const api = new HomebridgeAPI();
    const accessory = new api.platformAccessory('Test', api.hap.uuid.generate(`eco-${mode}`));
    const commands = [];
    const control = new OperatingModeAccessory(accessory, api, 'Test', async value => { commands.push(value); }, mode);
    const on = accessory.getServiceById(api.hap.Service.Switch, mode).getCharacteristic(api.hap.Characteristic.On);
    for (const enabled of [true, false]) {
      control.update(settings(mode === 'powerful' ? Number(!enabled) : 0,
        mode === 'auto' ? Number(!enabled) : 0), status('eco-stop'));
      assert.equal(await on.handleSetRequest(enabled), !enabled);
      assert.equal(await on.handleGetRequest(), !enabled);
      control.update(settings(mode === 'auto' ? 1 : 0, mode === 'powerful' ? 1 : 0), status('eco-stop'));
      await assert.rejects(on.handleSetRequest(true));
    }
    assert.deepEqual(commands, [true, false]);
  }
});

test('mode switches explain transition and pending refusals without attempting a cloud command', async () => {
  for (const mode of ['auto', 'powerful']) {
    const api = new HomebridgeAPI();
    const accessory = new api.platformAccessory('Test', api.hap.uuid.generate(`mode-log-${mode}`));
    const logs = [];
    const control = new OperatingModeAccessory(accessory, api, 'Test',
      async () => assert.fail('No command'), mode, message => logs.push(message));
    const on = accessory.getServiceById(api.hap.Service.Switch, mode).getCharacteristic(api.hap.Characteristic.On);
    control.update(settings(), status('starting'));
    await assert.rejects(on.handleSetRequest(true));
    assert.match(logs.pop(), /phase starting.*OFF\/TRAVAIL\/ECO STOP/);
    accessory.context.pendingAuto = 0;
    await assert.rejects(on.handleSetRequest(true));
    assert.match(logs.pop(), /pendingAuto.*no command sent/i);
    delete accessory.context.pendingAuto;
    control.markUnavailable();
    await assert.rejects(on.handleSetRequest(true));
    assert.match(logs.pop(), /mode unavailable/);
  }
});

function fixture(callback = async () => assert.fail('No command expected')) {
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Test', api.hap.uuid.generate('powerful'));
  const powerful = new PowerfulAccessory(accessory, api, 'Test', callback);
  const on = accessory.getServiceById(api.hap.Service.Switch, 'powerful').getCharacteristic(api.hap.Characteristic.On);
  return { api, accessory, powerful, on };
}

test('Powerful switch reads actual mode even when stove OFF, rejects CRONO and never duplicates on restart', async () => {
  const { api, accessory, powerful, on } = fixture();
  await assert.rejects(on.handleGetRequest());
  powerful.update(settings(1), status('off'));
  assert.equal(await on.handleGetRequest(), true);
  powerful.update(settings(0), status('working'));
  assert.equal(await on.handleGetRequest(), false);
  for (const [value, label] of [[2, 'CRONO'], [1, 'FULL'], [0, null]]) {
    powerful.update(settings(value, 0, label), status('off'));
    await assert.rejects(on.handleGetRequest());
  }
  const uuid = accessory.UUID;
  new PowerfulAccessory(accessory, api, 'Renamed', async () => {});
  assert.equal(accessory.UUID, uuid);
  assert.equal(accessory.services.filter(service => service.subtype === 'powerful').length, 1);
  await assert.rejects(on.handleGetRequest());
});

test('Powerful setter never assigns requested state without real readback and refuses unsafe modes', async () => {
  let f;
  let commands = 0;
  let confirm = false;
  f = fixture(async enabled => {
    commands++;
    if (confirm) {
      f.powerful.update(settings(Number(enabled)), status('off'));
    }
  });
  f.powerful.update(settings(0), status('off'));
  await f.on.handleSetRequest(false);
  assert.equal(commands, 0);
  assert.equal(await f.on.handleSetRequest(true), false);
  assert.equal(await f.on.handleGetRequest(), false);
  assert.notEqual(f.on.value, true);
  confirm = true;
  await f.on.handleSetRequest(true);
  assert.equal(await f.on.handleGetRequest(), true);
  await f.on.handleSetRequest(false);
  assert.equal(await f.on.handleGetRequest(), false);
  for (const kind of ['starting', 'stopping', 'unknown']) {
    f.powerful.update(settings(0), status(kind));
    await assert.rejects(f.on.handleSetRequest(true));
  }
  f.powerful.update(settings(0, 1), status('working'));
  await assert.rejects(f.on.handleSetRequest(true));
  assert.equal(commands, 3);
  f.powerful.markUnavailable();
  await assert.rejects(f.on.handleGetRequest());
});

test('every pending type blocks Powerful and pending OFF=0 blocks every other control', async () => {
  const { api, accessory, powerful, on } = fixture();
  for (const key of ['pendingPowerAction', 'pendingSetpoint', 'pendingVentilation', 'pendingPowerful', 'pendingAuto', 'pendingChrono']) {
    accessory.context[key] = 0;
    powerful.update(settings(), status('off'));
    assert.equal(await on.handleGetRequest(), false);
    await assert.rejects(on.handleSetRequest(true));
    delete accessory.context[key];
  }
  const power = new PowerAccessory(accessory, api, 'Test', async () => assert.fail('No stove activation'));
  const heater = new HeatingAccessory(accessory, api, 'Test', async () => assert.fail('No activation'),
    async () => assert.fail('No setpoint'), async () => assert.fail('No ventilation'));
  accessory.context.pendingAuto = 0;
  power.update(status('off'));
  heater.update({ celsius: 23, receivedAt: 123, freshness: 'unknown' },
    { mode: 'temperature', celsius: 20, receivedAt: 123, freshness: 'unknown' }, status('off'));
  heater.updateVentilation(settings(), status('off'));
  const C = api.hap.Characteristic;
  const heating = accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating');
  await assert.rejects(accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(C.On).handleSetRequest(true));
  for (const [type, value] of [[C.Active, 1], [C.HeatingThresholdTemperature, 22], [C.RotationSpeed, 86]]) {
    await assert.rejects(heating.getCharacteristic(type).handleSetRequest(value));
  }
});

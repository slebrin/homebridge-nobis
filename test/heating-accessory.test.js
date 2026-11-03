import assert from 'node:assert/strict';
import { HomebridgeAPI } from './homebridge-api.js';
import test from 'node:test';
import { HeatingAccessory } from '../dist/heating-accessory.js';

const ambient = { celsius: 21, receivedAt: 123, freshness: 'unknown' };
const target = celsius => ({ mode: 'temperature', celsius, receivedAt: 123, freshness: 'unknown' });
const status = kind => ({ phase: { kind, code: { off: 0, working: 5, starting: 2, stopping: 7, 'eco-stop': 8, unknown: 10 }[kind] },
  receivedAt: 123, freshness: 'unknown' });
function fixture(command = async () => assert.fail('No real commands')) {
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Test', api.hap.uuid.generate('heating'));
  const heater = new HeatingAccessory(accessory, api, 'Test', command, command);
  const service = accessory.getServiceById(api.hap.Service.Thermostat, 'heating');
  const get = type => service.getCharacteristic(type);
  return { api, accessory, heater, service, get, C: api.hap.Characteristic };
}

test('heating-only HAP tile displays actual temperature and target with integer bounds, not cooling or automatic modes', async () => {
  const { heater, service, get, C } = fixture();
  heater.update(ambient, target(20), status('off'));
  assert.equal(await get(C.CurrentTemperature).handleGetRequest(), 21);
  assert.equal(await get(C.TargetTemperature).handleGetRequest(), 20);
  assert.equal(await get(C.TargetHeatingCoolingState).handleGetRequest(), C.TargetHeatingCoolingState.OFF);
  assert.equal(await get(C.CurrentHeatingCoolingState).handleGetRequest(), C.CurrentHeatingCoolingState.OFF);
  assert.deepEqual(get(C.TargetHeatingCoolingState).props.validValues, [C.TargetHeatingCoolingState.OFF, C.TargetHeatingCoolingState.HEAT]);
  assert.equal(get(C.TargetTemperature).props.minValue, 7);
  assert.equal(get(C.TargetTemperature).props.maxValue, 40);
  assert.equal(get(C.TargetTemperature).props.minStep, 1);
  assert.equal(await get(C.TemperatureDisplayUnits).handleGetRequest(), C.TemperatureDisplayUnits.CELSIUS);
  assert.equal(service.testCharacteristic(C.CoolingThresholdTemperature), false);
  heater.update(ambient, target(20), status('working'));
  assert.equal(await get(C.CurrentHeatingCoolingState).handleGetRequest(), C.CurrentHeatingCoolingState.HEAT);
  await assert.rejects(get(C.TargetHeatingCoolingState).handleSetRequest(C.TargetHeatingCoolingState.AUTO));
  await assert.rejects(get(C.TargetHeatingCoolingState).handleSetRequest(C.TargetHeatingCoolingState.COOL));
});

test('eco-stop reads idle HEAT, allows only power OFF and retains observations until confirmation', async () => {
  let calls = 0;
  const { heater, get, C, accessory } = fixture(async value => {
    assert.equal(value, false);
    calls++;
  });
  heater.update(ambient, target(20), status('eco-stop'));
  assert.equal(await get(C.TargetHeatingCoolingState).handleGetRequest(), C.TargetHeatingCoolingState.HEAT);
  assert.equal(await get(C.CurrentHeatingCoolingState).handleGetRequest(), C.CurrentHeatingCoolingState.OFF);
  assert.equal(await get(C.TargetTemperature).handleGetRequest(), 20);
  await get(C.TargetHeatingCoolingState).handleSetRequest(C.TargetHeatingCoolingState.HEAT);
  await get(C.TargetTemperature).handleSetRequest(20);
  assert.equal(await get(C.TargetHeatingCoolingState).handleSetRequest(C.TargetHeatingCoolingState.OFF), C.TargetHeatingCoolingState.HEAT);
  assert.equal(calls, 1);
  assert.equal(await get(C.TargetHeatingCoolingState).handleGetRequest(), C.TargetHeatingCoolingState.HEAT);
  await assert.rejects(get(C.TargetTemperature).handleSetRequest(28));
  assert.equal(calls, 1);
  assert.equal(await get(C.TargetTemperature).handleGetRequest(), 20);
  accessory.context.pendingPowerAction = 'on';
  heater.update(ambient, target(20), status('eco-stop'));
  assert.equal(await get(C.TargetHeatingCoolingState).handleGetRequest(), C.TargetHeatingCoolingState.HEAT);
  delete accessory.context.pendingPowerAction;
  heater.update(ambient, target(20), status('working'));
  assert.equal(await get(C.CurrentHeatingCoolingState).handleGetRequest(), C.CurrentHeatingCoolingState.HEAT);
  heater.update(ambient, target(20), status('off'));
  assert.equal(await get(C.TargetHeatingCoolingState).handleGetRequest(), C.TargetHeatingCoolingState.OFF);
});

test('transitions, unknown phases and MAN never invent heating state or 41 Celsius', async () => {
  const { heater, get, C } = fixture();
  for (const kind of ['starting', 'stopping', 'unknown']) {
    heater.update(ambient, target(20), status(kind));
    await assert.rejects(get(C.TargetHeatingCoolingState).handleGetRequest());
    await assert.rejects(get(C.CurrentHeatingCoolingState).handleGetRequest());
    await assert.rejects(get(C.TargetTemperature).handleSetRequest(28));
    assert.equal(await get(C.CurrentTemperature).handleGetRequest(), 21);
  }
  heater.update(ambient, { mode: 'manual', receivedAt: 123, freshness: 'unknown' }, status('working'));
  await assert.rejects(get(C.TargetTemperature).handleGetRequest());
  await assert.rejects(get(C.TargetTemperature).handleSetRequest(28));
  assert.notEqual(get(C.TargetTemperature).value, 41);
});

test('pending setpoint acknowledgement does not update target and blocks inverse/power writes until actual readback', async () => {
  let count = 0;
  let f;
  f = fixture(async value => {
    count++;
    f.accessory.context.pendingSetpoint = value;
  });

  const { heater, get, C, accessory } = f;
  heater.update(ambient, target(20), status('off'));
  await get(C.TargetTemperature).handleSetRequest(20);
  assert.equal(count, 0);
  assert.equal(await get(C.TargetTemperature).handleSetRequest(28), 20);
  assert.notEqual(get(C.TargetTemperature).value, 28);
  await assert.rejects(get(C.TargetHeatingCoolingState).handleSetRequest(1));
  await assert.rejects(get(C.TargetTemperature).handleSetRequest(20));
  assert.equal(count, 1);
  heater.update(ambient, target(20), status('off'));
  assert.equal(await get(C.TargetTemperature).handleGetRequest(), 20);
  delete accessory.context.pendingSetpoint;
  heater.update(ambient, target(28), status('off'));
  assert.equal(await get(C.TargetTemperature).handleGetRequest(), 28);
});

test('known transitions retain confirmed activation, keep ambient and target distinct, and refuse writes before callbacks', async () => {
  for (const initial of ['off', 'working']) {
    const { heater, get, C, api } = fixture();
    heater.update(ambient, target(20), status(initial));
    const active = await get(C.TargetHeatingCoolingState).handleGetRequest();
    const current = await get(C.CurrentHeatingCoolingState).handleGetRequest();
    for (const kind of ['starting', 'stopping']) {
      heater.update({ ...ambient, celsius: 22 }, target(28), status(kind));
      assert.equal(await get(C.TargetHeatingCoolingState).handleGetRequest(), active);
      assert.equal(await get(C.CurrentHeatingCoolingState).handleGetRequest(), current);
      assert.equal(await get(C.CurrentTemperature).handleGetRequest(), 22);
      assert.equal(await get(C.TargetTemperature).handleGetRequest(), 28);
      for (const [type, value] of [[C.TargetHeatingCoolingState, 1 - active], [C.TargetTemperature, 25]]) {
        await assert.rejects(get(type).handleSetRequest(value),
          error => error === api.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
      }
    }
  }
});

for (const ventilation of [false, true]) {
  test(`heating ${ventilation ? 'HeaterCooler' : 'Thermostat'} controls real power independently of MAN and explains pending refusal`, async () => {
    const api = new HomebridgeAPI();
    const accessory = new api.platformAccessory('Test', api.hap.uuid.generate(`heating-control-${ventilation}`));
    const calls = [];
    const logs = [];
    let heater;
    heater = new HeatingAccessory(accessory, api, 'Test', async enabled => {
      calls.push(enabled);
      heater.update(ambient, { mode: 'manual' }, status(enabled ? 'working' : 'off'));
    }, async () => assert.fail('No setpoint command'), ventilation ? async () => assert.fail('No ventilation command') : undefined,
    message => logs.push(message));
    const C = api.hap.Characteristic;
    const service = accessory.getServiceById(ventilation ? api.hap.Service.HeaterCooler : api.hap.Service.Thermostat, 'heating');
    const mode = service.getCharacteristic(ventilation ? C.Active : C.TargetHeatingCoolingState);
    heater.update(ambient, { mode: 'manual' }, status('eco-stop'));
    await mode.handleSetRequest(0);
    assert.equal(await mode.handleGetRequest(), 0);
    await mode.handleSetRequest(1);
    assert.equal(await mode.handleGetRequest(), 1);
    assert.deepEqual(calls, [false, true]);
    assert.ok(logs.some(message => message.includes('real stove OFF')));
    accessory.context.pendingVentilation = 5;
    await assert.rejects(mode.handleSetRequest(0));
    assert.match(logs.at(-1), /pendingVentilation/);
    assert.deepEqual(calls, [false, true]);
  });
}

test('confirmed callbacks update HAP values, restart has no duplicates and failures clear cached state', async () => {
  let f;
  f = fixture(async value => {
    if (typeof value === 'boolean') {
      f.heater.update(ambient, target(20), status(value ? 'working' : 'off'));
    } else {
      f.heater.update(ambient, target(value), status('off'));
    }
  });

  f.heater.update(ambient, target(20), status('off'));
  await f.get(f.C.TargetTemperature).handleSetRequest(28);
  assert.equal(await f.get(f.C.TargetTemperature).handleGetRequest(), 28);
  await f.get(f.C.TargetHeatingCoolingState).handleSetRequest(1);
  assert.equal(await f.get(f.C.TargetHeatingCoolingState).handleGetRequest(), 1);
  const restored = new HeatingAccessory(f.accessory, f.api, 'New', async () => {}, async () => {});
  await assert.rejects(f.get(f.C.CurrentTemperature).handleGetRequest());
  assert.equal(f.accessory.services.filter(service => service.UUID === f.api.hap.Service.Thermostat.UUID).length, 1);
  restored.markUnavailable();
});

test('beta.2 HeaterCooler migrates to Thermostat without changing the accessory UUID or existing services and locks', async () => {
  const api = new HomebridgeAPI();
  const uuid = api.hap.uuid.generate('beta2-migration');
  const accessory = new api.platformAccessory('Test', uuid);
  accessory.addService(api.hap.Service.HeaterCooler, 'Old heating', 'heating');
  const sensor = accessory.addService(api.hap.Service.TemperatureSensor, 'Temperature');
  const power = accessory.addService(api.hap.Service.Switch, 'Power', 'power');
  accessory.context.pendingSetpoint = 28;
  accessory.context.pendingPowerAction = 'on';
  new HeatingAccessory(accessory, api, 'New', async () => assert.fail('No replay'), async () => assert.fail('No replay'));
  assert.equal(accessory.UUID, uuid);
  assert.equal(accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating'), undefined);
  assert.equal(accessory.getService(api.hap.Service.TemperatureSensor), sensor);
  assert.equal(accessory.getServiceById(api.hap.Service.Switch, 'power'), power);
  assert.equal(accessory.context.pendingSetpoint, 28);
  assert.equal(accessory.context.pendingPowerAction, 'on');
  const thermostat = accessory.getServiceById(api.hap.Service.Thermostat, 'heating');
  await assert.rejects(thermostat.getCharacteristic(api.hap.Characteristic.TargetTemperature).handleGetRequest());
  await assert.rejects(thermostat.getCharacteristic(api.hap.Characteristic.TargetTemperature).handleSetRequest(20));
});

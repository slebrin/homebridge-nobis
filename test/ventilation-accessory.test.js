import assert from 'node:assert/strict';
import { HomebridgeAPI } from './homebridge-api.js';
import test from 'node:test';
import { HeatingAccessory } from '../dist/heating-accessory.js';
import { ventilationLevel, ventilationPercentage, VENTILATION_PERCENTAGES } from '../dist/agua/ventilation-scale.js';

const ambient = { celsius: 21, receivedAt: 123, freshness: 'unknown' };
const target = { mode: 'temperature', celsius: 20, receivedAt: 123, freshness: 'unknown' };
const observation = kind => ({ phase: { kind, code: { off: 0, working: 5, 'eco-stop': 8, starting: 2 }[kind] } });
const settings = (level = 4, auto = 0, powerful = 0) => ({
  receivedAt: 123, freshness: 'unknown', controlValidated: false,
  registers: [
    { key: 'power_set', offset: 33120, rawValue: 5, label: null },
    { key: 'vent_front_set', offset: 33132, rawValue: level, label: null },
    { key: 'fun_auto_set', offset: 33128, rawValue: auto, label: null },
    { key: 'fun_pwf_set', offset: 33154, rawValue: powerful, label: null },
  ],
});
function fixture(callback = async () => assert.fail('No command')) {
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Test', api.hap.uuid.generate('integrated'));
  accessory.addService(api.hap.Service.Thermostat, 'Old', 'heating');
  const heater = new HeatingAccessory(accessory, api, 'Test', async () => assert.fail('No power'),
    async () => assert.fail('No setpoint'), callback);
  const service = accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating');
  const get = type => service.getCharacteristic(type);
  return { api, accessory, heater, service, get, C: api.hap.Characteristic };
}

test('seven levels normalize consistently without PS, OFF or false precision', () => {
  assert.deepEqual(VENTILATION_PERCENTAGES, [14, 29, 43, 57, 71, 86, 100]);
  for (let level = 1; level <= 7; level++) {
    assert.equal(ventilationLevel(ventilationPercentage(level)), level);
  }
  for (let percent = 1; percent <= 100; percent++) {
    assert.equal(ventilationLevel(percent), Math.max(1, Math.round(percent * 7 / 100)));
  }
  for (const invalid of [0, -1, 101, NaN, Infinity]) {
    assert.throws(() => ventilationLevel(invalid), { operation: 'ventilation-scale' });
  }
  for (const invalid of [0, 8, 1.5, NaN]) {
    assert.throws(() => ventilationPercentage(invalid), { operation: 'ventilation-scale' });
  }
});

test('opt-in migrates Thermostat to HeaterCooler without duplicate identity and reads requested ventilation even when OFF', async () => {
  const { api, accessory, heater, get, C, service } = fixture();
  assert.equal(accessory.getServiceById(api.hap.Service.Thermostat, 'heating'), undefined);
  heater.update(ambient, target, observation('off'));
  heater.updateVentilation(settings(4), observation('off'));
  assert.equal(await get(C.Active).handleGetRequest(), C.Active.INACTIVE);
  assert.equal(await get(C.CurrentHeaterCoolerState).handleGetRequest(), C.CurrentHeaterCoolerState.INACTIVE);
  assert.equal(await get(C.RotationSpeed).handleGetRequest(), 57);
  assert.equal(await get(C.HeatingThresholdTemperature).handleGetRequest(), 20);
  assert.equal(await get(C.TargetHeaterCoolerState).handleGetRequest(), C.TargetHeaterCoolerState.HEAT);
  heater.update(ambient, target, observation('eco-stop'));
  assert.equal(await get(C.Active).handleGetRequest(), C.Active.ACTIVE);
  assert.equal(await get(C.CurrentHeaterCoolerState).handleGetRequest(), C.CurrentHeaterCoolerState.IDLE);
  await assert.rejects(get(C.TargetHeaterCoolerState).handleSetRequest(C.TargetHeaterCoolerState.AUTO));
  assert.equal(service.testCharacteristic(C.CurrentFanState), false);
  new HeatingAccessory(accessory, api, 'Restart', async () => {}, async () => {}, async () => {});
  assert.equal(accessory.services.filter(x => x.UUID === api.hap.Service.HeaterCooler.UUID).length, 1);
  await assert.rejects(get(C.RotationSpeed).handleGetRequest());
  new HeatingAccessory(accessory, api, 'Disabled', async () => {}, async () => {});
  assert.equal(accessory.getServiceById(api.hap.Service.HeaterCooler, 'heating'), undefined);
  assert(accessory.getServiceById(api.hap.Service.Thermostat, 'heating'));
});

test('rotation writes once without power control, preserves canonical readback and refuses unknown or special states', async () => {
  const levels = [];
  let f;
  f = fixture(async level => {
    levels.push(level);
    f.heater.updateVentilation(settings(level), observation('working'));
  });
  const { heater, get, C, accessory } = f;
  heater.update(ambient, target, observation('working'));
  heater.updateVentilation(settings(), observation('working'));
  await get(C.RotationSpeed).handleSetRequest(86);
  assert.deepEqual(levels, [6]);
  assert.equal(await get(C.RotationSpeed).handleGetRequest(), 86);
  // 60% maps to 4; the true API-derived value is 57%, not 60%.
  assert.equal(await get(C.RotationSpeed).handleSetRequest(60), 57);
  assert.deepEqual(levels, [6, 4]);
  assert.equal(await get(C.RotationSpeed).handleGetRequest(), 57);
  assert.equal(get(C.RotationSpeed).value, 57);
  await get(C.RotationSpeed).handleSetRequest(60);
  assert.deepEqual(levels, [6, 4]);
  for (const [level, auto, powerful, phase] of [
    [0, 0, 0, 'working'], [8, 0, 0, 'working'], [4, 1, 0, 'working'],
    [4, 0, 1, 'working'], [4, 0, 0, 'eco-stop'], [4, 0, 0, 'starting'],
  ]) {
    heater.updateVentilation(settings(level, auto, powerful), observation(phase));
    await assert.rejects(get(C.RotationSpeed).handleSetRequest(100));
  }
  assert.deepEqual(levels, [6, 4]);
  heater.updateVentilation(settings(), observation('working'));
  await assert.rejects(get(C.RotationSpeed).handleSetRequest(0));
  accessory.context.pendingVentilation = 6;
  heater.update(ambient, target, observation('working'));
  heater.updateVentilation(settings(), observation('working'));
  assert.equal(await get(C.RotationSpeed).handleGetRequest(), 57);
  await assert.rejects(get(C.Active).handleSetRequest(0));
  await assert.rejects(get(C.HeatingThresholdTemperature).handleSetRequest(28));
  assert.deepEqual(levels, [6, 4]);
});

test('special labelled values cannot masquerade as a numeric ventilation level', async () => {
  const { heater, get, C } = fixture();
  const special = settings();
  special.registers[1].label = 'UNVALIDATED';
  heater.update(ambient, target, observation('working'));
  heater.updateVentilation(special, observation('working'));
  await assert.rejects(get(C.RotationSpeed).handleGetRequest());
  await assert.rejects(get(C.RotationSpeed).handleSetRequest(86));
});

test('actual requested OFF is readable as zero, never inferred from stove phase or converted to a writable level', async () => {
  const { heater, get, C } = fixture();
  const off = settings(0);
  off.registers[1].label = 'OFF';
  heater.update(ambient, target, observation('off'));
  heater.updateVentilation(off, observation('off'));
  assert.equal(await get(C.RotationSpeed).handleGetRequest(), 0);
  assert.equal(await get(C.HeatingThresholdTemperature).handleGetRequest(), 20);
  await assert.rejects(get(C.RotationSpeed).handleSetRequest(57));
  await assert.rejects(get(C.RotationSpeed).handleSetRequest(0));
  off.registers[1] = { ...off.registers[1], rawValue: 8, label: 'PS' };
  heater.updateVentilation(off, observation('off'));
  await assert.rejects(get(C.RotationSpeed).handleGetRequest());
  assert.notEqual(get(C.RotationSpeed).value, 100);
});

test('job acknowledgement alone cannot assign requested percentage or clear pending lock', async () => {
  let f;
  f = fixture(async level => {
    f.accessory.context.pendingVentilation = level;
  });
  f.heater.update(ambient, target, observation('working'));
  f.heater.updateVentilation(settings(), observation('working'));
  assert.equal(await f.get(f.C.RotationSpeed).handleSetRequest(86), 57);
  assert.notEqual(f.get(f.C.RotationSpeed).value, 86);
  assert.equal(f.accessory.context.pendingVentilation, 6);
  await assert.rejects(f.get(f.C.RotationSpeed).handleSetRequest(100));
});

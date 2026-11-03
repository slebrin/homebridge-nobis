import assert from 'node:assert/strict';
import test from 'node:test';
import { EcoStopAccessory } from '../dist/eco-stop-accessory.js';
import { HomebridgeAPI } from './homebridge-api.js';

test('Eco Stop contact is read-only, uses actual known phases, faults on unknown and restores without duplicates', async () => {
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Calcifer', api.hap.uuid.generate('eco-stop'));
  const sensor = new EcoStopAccessory(accessory, api, 'Calcifer');
  const C = api.hap.Characteristic;
  const service = accessory.getServiceById(api.hap.Service.ContactSensor, 'eco-stop');
  const state = service.getCharacteristic(C.ContactSensorState);
  assert.equal(state.props.perms.includes(api.hap.Perms.PAIRED_WRITE), false);
  await assert.rejects(state.handleGetRequest());
  for (const kind of ['eco-stop', 'off', 'starting', 'working', 'stopping']) {
    sensor.update({ phase: { kind } });
    assert.equal(await state.handleGetRequest(), kind === 'eco-stop' ? 1 : 0);
    assert.equal(service.getCharacteristic(C.StatusFault).value, 0);
  }
  sensor.update({ phase: { kind: 'unknown' } });
  await assert.rejects(state.handleGetRequest());
  assert.equal(service.getCharacteristic(C.StatusFault).value, 1);
  sensor.update({ phase: { kind: 'eco-stop' } });
  assert.equal(await state.handleGetRequest(), 1);
  sensor.markUnavailable();
  await assert.rejects(state.handleGetRequest());
  new EcoStopAccessory(accessory, api, 'Renamed');
  assert.equal(accessory.services.filter(entry => entry.subtype === 'eco-stop').length, 1);
  await assert.rejects(state.handleGetRequest());
});

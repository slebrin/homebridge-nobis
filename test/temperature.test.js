import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeNobisAmbientTemperature } from '../dist/agua/temperature.js';
import { TemperatureAccessory } from '../dist/temperature-accessory.js';
import { HomebridgeAPI } from './homebridge-api.js';

const register = {
  reg_key: 'temp_air2_get', reg_type: 'GET', offset: 103, mask: 65535,
  formula: '#', is_word: true, big_endian: false, with_sign: false,
};
const map = { id: 'fictitious-map', registers: [register] };
const reading = value => ({ values: new Map([[103, value], [104, 255]]), receivedAt: 123456 });
const failure = kind => error => error.kind === kind && error.operation === 'ambient-temperature';

test('ambient tile can be removed and restored without changing stove identity or other services', async () => {
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Test', api.hap.uuid.generate('ambient-migration'));
  const uuid = accessory.UUID;
  const heating = accessory.addService(api.hap.Service.Thermostat, 'Heating', 'heating');
  const power = accessory.addService(api.hap.Service.Switch, 'Power', 'power');
  const temperature = { celsius: 23, receivedAt: 123, freshness: 'unknown' };
  for (const separate of [true, false, false, true, true]) {
    const sensor = new TemperatureAccessory(accessory, api, 'Test', separate);
    sensor.update(temperature);
    const service = accessory.getService(api.hap.Service.TemperatureSensor);
    if (separate) {
      assert.equal(await service.getCharacteristic(api.hap.Characteristic.CurrentTemperature).handleGetRequest(), 23);
      assert.equal(accessory.services.filter(item => item.UUID === api.hap.Service.TemperatureSensor.UUID).length, 1);
    } else {
      assert.equal(service, undefined);
    }
    assert.equal(accessory.UUID, uuid);
    assert.equal(accessory.getServiceById(api.hap.Service.Thermostat, 'heating'), heating);
    assert.equal(accessory.getServiceById(api.hap.Service.Switch, 'power'), power);
    assert.throws(() => sensor.update({ ...temperature, celsius: NaN }));
    sensor.markUnavailable();
    if (separate) {
      await assert.rejects(service.getCharacteristic(api.hap.Characteristic.CurrentTemperature).handleGetRequest());
    }
  }
});

test('ambient temperature uses only the validated word value and retains unknown freshness', () => {
  for (const value of [0, 18, 23, 256, 65535]) {
    const input = reading(value);
    const result = decodeNobisAmbientTemperature(map, input, 1);
    assert.deepEqual(result, {
      registerKey: 'temp_air2_get', celsius: value, receivedAt: 123456, freshness: 'unknown',
    });
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual([...input.values], [[103, value], [104, 255]]);
  }
});

test('unknown buffers, maps and changed decoding contracts fail explicitly without fallbacks', () => {
  for (const buffer of [0, 130, 131, 132, NaN]) {
    assert.throws(() => decodeNobisAmbientTemperature(map, reading(23), buffer), failure('protocol'));
  }
  for (const registers of [[], [register, register], [{ ...register, reg_key: 'temp_air_get' }]]) {
    assert.throws(() => decodeNobisAmbientTemperature({ ...map, registers }, reading(23), 1), failure('protocol'));
  }
  for (const patch of [
    { reg_type: 'SET' }, { offset: 104 }, { mask: 255 }, { formula: '#/10' },
    { formula: 'process.exit()' }, { is_word: false }, { is_word: undefined },
    { big_endian: true }, { big_endian: undefined }, { with_sign: true }, { with_sign: undefined },
  ]) {
    assert.throws(() => decodeNobisAmbientTemperature({
      ...map, registers: [{ ...register, ...patch }],
    }, reading(23), 1), failure('protocol'));
  }
});

test('missing temperature never becomes zero or a different probe value', () => {
  assert.throws(() => decodeNobisAmbientTemperature(map, {
    values: new Map([[0, 19], [2, 23]]), receivedAt: 123456,
  }, 1), failure('unavailable'));
});

test('invalid unsigned words and reception times are rejected rather than truncated or clamped', () => {
  for (const value of [-1, 65536, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, '23']) {
    assert.throws(() => decodeNobisAmbientTemperature(map, reading(value), 1), failure('protocol'));
  }
  for (const receivedAt of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => decodeNobisAmbientTemperature(map, {
      ...reading(23), receivedAt,
    }, 1), failure('protocol'));
  }
});

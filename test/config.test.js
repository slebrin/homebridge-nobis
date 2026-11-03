import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import Ajv from 'ajv';

import { ConfigError, parseConfig } from '../dist/config.js';
import { PLATFORM_NAME } from '../dist/settings.js';

const credentials = { email: 'reader@example.invalid', password: ' mock password ' };

test('configuration defaults and exact password preservation', () => {
  const config = parseConfig(credentials);
  assert.equal(config.password, credentials.password);
  assert.equal(config.name, PLATFORM_NAME);
  assert.equal(config.pollIntervalSeconds, 60);
  assert.equal(config.diagnostic, false);
  assert.equal(config.enableCloud, false);
  assert.equal(config.enableTemperatureSensor, false);
  assert.equal(config.enablePowerSwitch, false);
  assert.equal(config.enableSetpointControl, false);
  assert.equal(config.enableVentilationControl, false);
  assert.equal(config.enablePowerfulControl, false);
  assert.equal(config.enableAutoControl, false);
  assert.equal(config.confirmAbandonPendingCommands, false);
  assert.equal(config.useHeatingActivityIndicator, false);
  assert.equal(config.enableChronoControl, false);
  assert.equal(config.enableEcoStopSensor, false);
  assert.equal(Object.isFrozen(config), true);
});

test('normalizes display fields without altering credentials', () => {
  const config = parseConfig({
    ...credentials, email: ' reader@example.invalid ', name: ' Nobis ',
    stoveName: ' Living room ', deviceId: ' fictional-device ', diagnostic: true,
  });

  test('invalid Eco Stop option is reported once, independently of optional display fields', () => {
    assert.throws(() => parseConfig({ ...credentials, enableEcoStopSensor: true }), error => {
      assert.ok(error instanceof ConfigError);
      assert.deepEqual(error.fields, ['enableEcoStopSensor']);
      return true;
    });
  });
  assert.equal(config.email, credentials.email);
  assert.equal(config.stoveName, 'Living room');
  assert.equal(config.deviceId, 'fictional-device');
});

for (const input of [undefined, null, [], 'invalid', {}]) {
  test(`rejects missing or malformed configuration: ${JSON.stringify(input)}`, () => {
    assert.throws(() => parseConfig(input), ConfigError);
  });
}

for (const [field, values] of Object.entries({
  email: ['', ' ', 'invalid', 'a@b', 1, null],
  password: ['', ' ', false, null],
  name: ['', ' ', 1, null],
  stoveName: ['', ' ', false, null],
  deviceId: ['', ' ', 42, null],
  pollIntervalSeconds: [0, 29, 3601, 30.5, NaN, Infinity, '60', null],
  diagnostic: ['true', 1, null],
  enableCloud: ['true', 1, null],
  enableTemperatureSensor: ['true', 1, null, true],
  enablePowerSwitch: ['true', 1, null, true],
  enableSetpointControl: ['true', 1, null, true],
  enableVentilationControl: ['true', 1, null, true],
  confirmAbandonPendingCommands: ['true', 1, null, true],
  useHeatingActivityIndicator: ['true', 1, null, true],
  enableChronoControl: ['true', 1, null, true],
  enableEcoStopSensor: ['true', 1, null, true],
})) {
  test(`rejects invalid ${field} without leaking its value`, () => {
    for (const value of values) {
      assert.throws(() => parseConfig({ ...credentials, [field]: value }), (error) => {
        assert.ok(error instanceof ConfigError);
        assert.ok(error.fields.includes(field));
        assert.equal(error.message.includes(credentials.email), false);
        assert.equal(error.message.includes(credentials.password), false);
        return true;
      });
    }
  });
}

test('accepts both refresh interval bounds', () => {
  for (const interval of [30, 3600]) {
    assert.equal(parseConfig({ ...credentials, pollIntervalSeconds: interval }).pollIntervalSeconds, interval);
  }
});

test('accepts a saved GUI configuration without optional device identification', () => {
  const saved = JSON.parse(JSON.stringify({
    platform: PLATFORM_NAME,
    name: PLATFORM_NAME,
    ...credentials,
    stoveName: 'Offline Test Stove',
    pollIntervalSeconds: 120,
    enableCloud: false,
    diagnostic: true,
  }));
  const config = parseConfig(saved);
  assert.equal(config.password, credentials.password);
  assert.equal(config.pollIntervalSeconds, 120);
  assert.equal(config.stoveName, 'Offline Test Stove');
  assert.equal(config.deviceId, undefined);
  assert.equal(config.enableCloud, false);
  assert.equal(config.diagnostic, true);
});

test('GUI matches runtime alias, defaults, limits and password masking', async () => {
  const schema = JSON.parse(await readFile(new URL('../config.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.pluginAlias, PLATFORM_NAME);
  assert.equal(schema.pluginType, 'platform');
  assert.equal(schema.singular, true);
  assert.equal(schema.strictValidation, true);
  assert.deepEqual(schema.schema.required, ['email', 'password', 'pollIntervalSeconds']);
  assert.equal(schema.schema.properties.pollIntervalSeconds.type, 'integer');
  assert.equal(schema.schema.properties.pollIntervalSeconds.minimum, 30);
  assert.equal(schema.schema.properties.pollIntervalSeconds.maximum, 3600);
  assert.equal(schema.schema.properties.pollIntervalSeconds.multipleOf, 1);
  assert.equal(schema.schema.properties.pollIntervalSeconds.default, parseConfig(credentials).pollIntervalSeconds);
  assert.ok(schema.layout[0].items.some((item) => item.key === 'password' && item.type === 'password'));
  assert.ok(schema.layout[0].items.some((item) => item.key === 'pollIntervalSeconds' && item.type === 'number'));
  assert.equal(schema.schema.properties.enableCloud.default, false);
  assert.equal(schema.schema.properties.enableTemperatureSensor.default, false);
  assert.equal(schema.schema.properties.enablePowerSwitch.default, false);
  assert.ok(schema.layout[0].items.includes('enablePowerSwitch'));
  assert.equal(schema.schema.properties.enableSetpointControl.default, false);
  assert.ok(schema.layout[0].items.includes('enableSetpointControl'));
  assert.equal(schema.schema.properties.enableVentilationControl.default, false);
  assert.ok(schema.layout[0].items.includes('enableVentilationControl'));
  assert.equal(schema.schema.properties.enablePowerfulControl.default, false);
  assert.ok(schema.layout[0].items.includes('enablePowerfulControl'));
  assert.equal(schema.schema.properties.enableAutoControl.default, false);
  assert.ok(schema.layout[0].items.includes('enableAutoControl'));
  assert.equal(schema.schema.properties.confirmAbandonPendingCommands.default, false);
  assert.ok(schema.layout[0].items.includes('confirmAbandonPendingCommands'));
  assert.equal(schema.schema.properties.useHeatingActivityIndicator.default, false);
  assert.ok(schema.layout[0].items.includes('useHeatingActivityIndicator'));
  assert.equal(schema.schema.properties.enableChronoControl.default, false);
  assert.ok(schema.layout[0].items.includes('enableChronoControl'));
  assert.equal(schema.schema.properties.enableEcoStopSensor.default, false);
  assert.ok(schema.layout[0].items.includes('enableEcoStopSensor'));
});

test('temperature sensor requires explicit cloud and sensor enablement', () => {
  assert.equal(parseConfig({ ...credentials, enableCloud: true, enableTemperatureSensor: true }).enableTemperatureSensor, true);
  assert.throws(() => parseConfig({ ...credentials, enableCloud: false, enableTemperatureSensor: true }), ConfigError);
});

test('power switch requires both cloud and temperature sensor opt-ins', () => {
  assert.equal(parseConfig({ ...credentials, enableCloud: true,
    enableTemperatureSensor: true, enablePowerSwitch: true }).enablePowerSwitch, true);
  for (const settings of [{ enableCloud: true }, { enableTemperatureSensor: true }, {}]) {
    assert.throws(() => parseConfig({ ...credentials, ...settings, enablePowerSwitch: true }), ConfigError);
  }
});

test('setpoint tile requires all previous control opt-ins', () => {
  assert.equal(parseConfig({ ...credentials, enableCloud: true, enableTemperatureSensor: true,
    enablePowerSwitch: true, enableSetpointControl: true }).enableSetpointControl, true);
  assert.throws(() => parseConfig({ ...credentials, enableCloud: true,
    enableTemperatureSensor: true, enableSetpointControl: true }), ConfigError);
});

test('ventilation requires every previous opt-in and remains disabled by default', () => {
  const options = { enableCloud: true, enableTemperatureSensor: true, enablePowerSwitch: true, enableSetpointControl: true };
  assert.equal(parseConfig({ ...credentials, ...options }).enableVentilationControl, false);
  assert.equal(parseConfig({ ...credentials, ...options, enableVentilationControl: true }).enableVentilationControl, true);
  for (const key of Object.keys(options)) {
    assert.throws(() => parseConfig({ ...credentials, ...options, [key]: false, enableVentilationControl: true }), ConfigError);
  }
});

test('Powerful opt-in requires cloud, sensor and power, but not the heating or ventilation tiles', () => {
  const options = { enableCloud: true, enableTemperatureSensor: true, enablePowerSwitch: true };
  assert.equal(parseConfig({ ...credentials, ...options, enablePowerfulControl: true }).enablePowerfulControl, true);
  for (const key of Object.keys(options)) {
    assert.throws(() => parseConfig({ ...credentials, ...options, [key]: false, enablePowerfulControl: true }), ConfigError);
  }
  for (const value of [1, null, 'true']) {
    assert.throws(() => parseConfig({ ...credentials, ...options, enablePowerfulControl: value }), ConfigError);
  }
});

test('Auto requires cloud, sensor and power opt-ins, independently of Powerful and heating tiles', () => {
  const options = { enableCloud: true, enableTemperatureSensor: true, enablePowerSwitch: true };
  assert.equal(parseConfig({ ...credentials, ...options, enableAutoControl: true }).enableAutoControl, true);
  for (const key of Object.keys(options)) {
    assert.throws(() => parseConfig({ ...credentials, ...options, [key]: false, enableAutoControl: true }), ConfigError);
  }
  for (const value of [1, null, 'true']) {
    assert.throws(() => parseConfig({ ...credentials, ...options, enableAutoControl: value }), ConfigError);
  }
});

test('GUI schema and runtime agree on every omitted, disabled or enabled control combination', async () => {
  const { schema } = JSON.parse(await readFile(new URL('../config.schema.json', import.meta.url), 'utf8'));
  const ajv = new Ajv({ allErrors: true });
  ajv.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  const validate = ajv.compile(schema);
  const options = ['enableCloud', 'enableTemperatureSensor', 'enablePowerSwitch',
    'enableSetpointControl', 'enableVentilationControl', 'enablePowerfulControl', 'enableAutoControl', 'confirmAbandonPendingCommands',
    'useHeatingActivityIndicator', 'enableChronoControl', 'enableEcoStopSensor'];
  let checked = 0;
  for (let combination = 0; combination < 3 ** options.length; combination++) {
    let remaining = combination;
    const config = { ...credentials, pollIntervalSeconds: 60 };
    for (const key of options) {
      const value = remaining % 3;
      remaining = Math.floor(remaining / 3);
      if (value !== 0) {
        config[key] = value === 2;
      }
    }
    let accepted = true;
    try {
      parseConfig(config);
    } catch (error) {
      assert(error instanceof ConfigError);
      accepted = false;
    }
    assert.equal(validate(config), accepted, `Schema/runtime mismatch: ${JSON.stringify(config)}`);
    checked++;
  }
  assert.equal(checked, 177147);
  for (const key of options) {
    for (const value of [null, 1, 'true']) {
      assert.equal(validate({ ...credentials, pollIntervalSeconds: 60, [key]: value }), false);
    }
  }
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

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
  assert.equal(Object.isFrozen(config), true);
});

test('normalizes display fields without altering credentials', () => {
  const config = parseConfig({
    ...credentials, email: ' reader@example.invalid ', name: ' Nobis ',
    stoveName: ' Living room ', deviceId: ' fictional-device ', diagnostic: true,
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
});

test('temperature sensor requires explicit cloud and sensor enablement', () => {
  assert.equal(parseConfig({ ...credentials, enableCloud: true, enableTemperatureSensor: true }).enableTemperatureSensor, true);
  assert.throws(() => parseConfig({ ...credentials, enableCloud: false, enableTemperatureSensor: true }), ConfigError);
});

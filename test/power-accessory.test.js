import assert from 'node:assert/strict';
import { HomebridgeAPI } from './homebridge-api.js';
import test from 'node:test';
import { PowerAccessory } from '../dist/power-accessory.js';

const observation = kind => ({ receivedAt: 123, freshness: 'unknown',
  phase: { kind, code: { off: 0, starting: 2, working: 5, stopping: 7, 'eco-stop': 8, unknown: 10 }[kind] } });

test('power switch retains a confirmed activation through known transitions, never infers from unknown phases', async () => {
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Test', api.hap.uuid.generate('power-test'));
  const power = new PowerAccessory(accessory, api, 'Test', async () => assert.fail('No command'));
  const service = accessory.getServiceById(api.hap.Service.Switch, 'power');
  const on = service.getCharacteristic(api.hap.Characteristic.On);
  await assert.rejects(on.handleGetRequest());
  for (const kind of ['off', 'working', 'eco-stop', 'starting', 'stopping', 'unknown']) {
    power.update(observation(kind));
    if (kind !== 'unknown') {
      assert.equal(await on.handleGetRequest(), kind !== 'off');
      if (kind === 'starting' || kind === 'stopping') {
        await assert.rejects(on.handleSetRequest(false), error => error === api.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
      }
    } else {
      await assert.rejects(on.handleGetRequest());
    }
  }
});

test('eco-stop allows OFF but keeps activation until confirmed and never bypasses pending locks', async () => {
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Test', api.hap.uuid.generate('eco-stop'));
  let calls = 0;
  const power = new PowerAccessory(accessory, api, 'Test', async value => {
    assert.equal(value, false);
    calls++;
  });
  const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(api.hap.Characteristic.On);
  power.update(observation('eco-stop'));
  assert.equal(await on.handleGetRequest(), true);
  await on.handleSetRequest(true);
  assert.equal(await on.handleSetRequest(false), true);
  assert.equal(calls, 1);
  assert.equal(await on.handleGetRequest(), true);
  accessory.context.pendingPowerAction = 'on';
  power.update(observation('eco-stop'));
  assert.equal(await on.handleGetRequest(), true);
  await assert.rejects(on.handleSetRequest(false));
  assert.equal(calls, 1);
  assert.equal(accessory.context.pendingPowerAction, 'on');
});

test('acknowledgement alone never optimistically sets On, and pending writes cannot be repeated', async () => {
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Test', api.hap.uuid.generate('pending-power'));
  let calls = 0;
  const power = new PowerAccessory(accessory, api, 'Test', async value => {
    calls++;
    accessory.context.pendingPowerAction = value ? 'on' : 'off';
  });
  const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(api.hap.Characteristic.On);
  power.update(observation('off'));
  await on.handleSetRequest(false);
  assert.equal(calls, 0);
  assert.equal(await on.handleSetRequest(true), false);
  assert.notEqual(on.value, true);
  assert.equal(await on.handleGetRequest(), false);
  power.update(observation('off'));
  await assert.rejects(on.handleSetRequest(true));
  await assert.rejects(on.handleSetRequest(false));
  assert.equal(calls, 1);
  delete accessory.context.pendingPowerAction;
  power.update(observation('working'));
  assert.equal(await on.handleGetRequest(), true);
});

test('pending context blocks writes without hiding an actual readback; storage corruption is handled by the platform', async () => {
  for (const pending of ['on', 'off', 'invalid', { action: 'on' }]) {
    const api = new HomebridgeAPI();
    const accessory = new api.platformAccessory('Test', api.hap.uuid.generate(JSON.stringify(pending)));
    accessory.context.pendingPowerAction = pending;
    accessory.addService(api.hap.Service.Switch, 'Old', 'power');
    const power = new PowerAccessory(accessory, api, 'New', async () => assert.fail('Never replay a cached command'));
    power.update(observation('working'));
    const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(api.hap.Characteristic.On);
    assert.equal(await on.handleGetRequest(), true);
    await assert.rejects(on.handleSetRequest(true));
    assert.equal(accessory.services.filter(service => service.UUID === api.hap.Service.Switch.UUID).length, 1);
  }
});

test('ECO STOP OFF is allowed and pending locks or unknown activation explain local refusals without cloud writes', async () => {
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Test', api.hap.uuid.generate('eco-refusal-log'));
  const logs = [];
  let calls = 0;
  const power = new PowerAccessory(accessory, api, 'Test', async () => { calls++; }, message => logs.push(message));
  const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(api.hap.Characteristic.On);
  power.update(observation('eco-stop'));
  accessory.context.pendingPowerAction = 'on';
  await assert.rejects(on.handleSetRequest(false));
  assert.match(logs.pop(), /pendingPowerAction.*no command sent/i);
  assert.equal(calls, 0);
  delete accessory.context.pendingPowerAction;
  assert.equal(await on.handleSetRequest(false), true);
  assert.equal(calls, 1);
  power.update(observation('stopping'));
  await assert.rejects(on.handleSetRequest(false));
  assert.match(logs.pop(), /phase stopping/);
  power.markUnavailable();
  await assert.rejects(on.handleSetRequest(false));
  assert.match(logs.pop(), /activation unavailable/);
  assert.equal(calls, 1);
});

test('optional activity indicator migrates the existing switch, never writes and follows confirmed TRAVAIL only', async () => {
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Test', api.hap.uuid.generate('activity-migration'));
  const uuid = accessory.UUID;
  const logs = [];
  let calls = 0;
  let power = new PowerAccessory(accessory, api, 'Test', async () => { calls++; });
  const service = accessory.getServiceById(api.hap.Service.Switch, 'power');
  const on = service.getCharacteristic(api.hap.Characteristic.On);
  power.update(observation('eco-stop'));
  assert.equal(await on.handleGetRequest(), true);
  power = new PowerAccessory(accessory, api, 'Test', async () => assert.fail('Indicator never commands'),
    message => logs.push(message), true);
  for (const phase of ['off', 'working', 'eco-stop', 'starting', 'stopping', 'working', 'unknown']) {
    power.update(observation(phase));
    if (phase === 'unknown') {
      await assert.rejects(on.handleGetRequest());
    } else {
      assert.equal(await on.handleGetRequest(), phase === 'working');
    }
    for (const value of [true, false]) {
      await assert.rejects(on.handleSetRequest(value),
        error => error === api.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
    }
  }
  assert.ok(logs.every(message => message.includes('observation-only')));
  accessory.context.pendingPowerAction = 'off';
  power.update(observation('working'));
  assert.equal(await on.handleGetRequest(), true);
  power.markUnavailable();
  await assert.rejects(on.handleGetRequest());
  assert.equal(service.getCharacteristic(api.hap.Characteristic.Name).value, 'Test En chauffe');
  delete accessory.context.pendingPowerAction;
  power = new PowerAccessory(accessory, api, 'Test', async () => { calls++; });
  power.update(observation('eco-stop'));
  assert.equal(await on.handleGetRequest(), true);
  await on.handleSetRequest(false);
  assert.equal(calls, 1);
  assert.equal(service.getCharacteristic(api.hap.Characteristic.Name).value, 'Test Marche');
  assert.equal(accessory.UUID, uuid);
  assert.equal(accessory.getServiceById(api.hap.Service.Switch, 'power'), service);
  assert.equal(accessory.services.filter(item => item.subtype === 'power').length, 1);
});

test('power setter succeeds only when its callback supplies a matching actual observation', async () => {
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Test', api.hap.uuid.generate('confirmed-power'));
  const power = new PowerAccessory(accessory, api, 'Test', async value => {
    power.update(observation(value ? 'working' : 'off'));
  });
  const on = accessory.getServiceById(api.hap.Service.Switch, 'power').getCharacteristic(api.hap.Characteristic.On);
  power.update(observation('off'));
  await on.handleSetRequest(true);
  assert.equal(await on.handleGetRequest(), true);
  await on.handleSetRequest(false);
  assert.equal(await on.handleGetRequest(), false);
});

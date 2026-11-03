import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import test from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';

import { startDiagnosticBrowser } from '../dist/diagnostic-browser.js';
import { diagnosticScript } from '../dist/diagnostic-page.js';
import { describeResponseShape, observeBufferIndexes, observeNackCode } from '../dist/diagnostic-shape.js';

const powerRegisters = [
  { reg_key: 'status_get', reg_type: 'GET', offset: 8, mask: 65535, formula: '#',
    enc_val: [{ value: 0, lang: 'FRE', description: 'OFF' }, { value: 5, lang: 'FRE', description: 'TRAVAIL' },
      { value: 8, lang: 'FRE', description: 'ECO STOP' }] },
  { reg_key: 'status_managed_get', reg_type: 'GET', readonly: false, offset: 232, mask: 255,
    formula: '#', formula_inverse: '#', set_min: 0, set_max: 255, step: 1,
    is_word: false, big_endian: false, with_sign: false,
    enc_val: [{ value: 85, lang: 'FRE', description: 'ON' }, { value: 170, lang: 'FRE', description: 'OFF' }] },
];

const ventilationRegisters = [
  ...powerRegisters,
  ...[
    ['power_set', 33120, 1, 7], ['vent_front_set', 33132, 0, 8],
    ['fun_auto_set', 33128, 0, 1], ['fun_pwf_set', 33154, 0, 1],
  ].map(([reg_key, offset, set_min, set_max]) => ({
    reg_key, reg_type: 'SET', offset, set_min, set_max, mask: 65535,
    formula: '#', formula_inverse: '#', readonly: false, step: 1,
    is_word: true, big_endian: false, with_sign: false,
    ...(reg_key === 'vent_front_set' ? { enc_val: [
      { value: 0, lang: 'FRE', description: 'OFF' }, { value: 8, lang: 'FRE', description: 'PS' },
    ] } : {}),
  })),
];

test('manual ventilation is confirmed, protected, single-write and never repeats HTTP/network/Nack failures', async context => {
  for (const failure of ['none', '401', 'network', 'nack', 'readback']) {
    const mock = mockedClient({
      '/deviceGetRegistersMap': { Success: true, device_registers_map: {
        registers_map: [{ id: 'private-map', registers: ventilationRegisters }],
      } },
      '/deviceGetBufferReading': { Success: true, idRequest: 'read' },
      '/deviceJobStatus/read': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [8, 232, 33120, 33132, 33128, 33154], Values: [0, 0, 5, 4, 0, 0] } },
      '/deviceRequestWriting': { Success: true, idRequest: 'write' },
      '/deviceJobStatus/write': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: failure === 'nack' ? { NackErrCode: 0 } : {} },
    });
    const writes = [];
    let reads = 0;
    const local = await setup(context, { jobPollIntervalMs: 1, fetch: (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/deviceGetBufferReading' && ++reads === 2 && failure === 'readback') {
        throw new Error('private');
      }
      if (path === '/deviceRequestWriting') {
        writes.push(JSON.parse(init.body));
        if (failure === '401') {
          return Promise.resolve(new globalThis.Response('{}', { status: 401 }));
        }
        if (failure === 'network') {
          throw new Error('private');
        }
      }
      return mock.fetch(url, init);
    } });
    for (const input of [{ level: 3 }, { level: 0, confirmVentilationChange: true },
      { level: 8, confirmVentilationChange: true }, { level: '3', confirmVentilationChange: true }]) {
      assert.equal((await local.post({ ...credentials, ...input }, {}, '/ventilation-test')).status, 400);
    }
    const input = { ...credentials, level: 3, confirmVentilationChange: true };
    assert.equal((await local.post(input, { 'X-Nobis-Token': 'wrong' }, '/ventilation-test')).status, 403);
    assert.equal(mock.calls.length, 0);
    const response = await local.post(input, {}, '/ventilation-test');
    const data = await response.json();
    assert.equal(response.status, failure === 'none' ? 200 : 502);
    assert.deepEqual(writes, [{
      id_device: 'private-device', id_product: 'private-product', Protocol: 'RWMSmaster',
      BitData: 8, Endianess: 'L', Items: [33132], Masks: [65535], Values: [3],
    }]);
    if (failure === 'none') {
      assert.equal(data.originalLevel, 4);
      assert.equal(data.requestedLevel, 3);
      assert.equal(data.after.registers[1].rawValue, 4);
      assert.equal(data.physicalEffectVerified, false);
      assert.equal(reads, 4);
      assert.equal(data.observations.length, 3);
      assert.equal(data.readbackMatches, false);
    } else {
      assert.match(data.error, /aucune repetition ni restauration automatiques/);
    }
    assert.equal(JSON.stringify(data).includes('private'), false);
  }
});

test('ventilation page requires per-click confirmation and never mistakes mismatched readback for physical success', async () => {
  const settings = {
    receivedAt: 123, freshness: 'unknown', controlValidated: false,
    registers: [
      { key: 'power_set', offset: 33120, rawValue: 5, label: null },
      { key: 'vent_front_set', offset: 33132, rawValue: 4, label: null },
      { key: 'fun_auto_set', offset: 33128, rawValue: 0, label: 'OFF' },
      { key: 'fun_pwf_set', offset: 33154, rawValue: 0, label: 'OFF' },
    ],
  };
  let data = { originalLevel: 4, requestedLevel: 3, before: settings, after: settings,
    physicalEffectVerified: false, freshnessVerified: false, observations: [settings], readbackMatches: false };
  let calls = 0;
  const page = pageHarness(async (path, init) => {
    assert.equal(path, '/ventilation-test');
    assert.equal(JSON.parse(init.body).confirmVentilationChange, true);
    calls++;
    return { ok: true, json: async () => data };
  });

  page.elements.operation.value = 'ventilation';
  page.elements.operation.listeners.change();
  page.elements['ventilation-target'].value = '3';
  await page.submit();
  assert.equal(calls, 0);
  page.elements['ventilation-confirm'].checked = true;
  await page.submit();
  assert.equal(calls, 1);
  assert.equal(page.elements['ventilation-confirm'].checked, false);
  assert.equal(page.elements.password.value, '');
  assert.equal(page.elements['ventilation-result'].hidden, false);
  assert.match(page.elements.result.textContent, /ne renvoyez pas/);
  page.elements['clear-ventilation'].listeners.click();
  assert.equal(page.elements['ventilation-values'].textContent, '');
  data = { ...data, physicalEffectVerified: true };
  page.elements.password.value = credentials.password;
  page.elements['ventilation-confirm'].checked = true;
  await page.submit();
  assert.equal(page.elements['ventilation-result'].hidden, true);
  assert.match(page.elements.result.textContent, /Ne repetez pas/);
});

test('manual ventilation refuses unsupported initial conditions and unchanged levels before any write', async context => {
  for (const values of [
    [8, 0, 5, 4, 0, 0], [0, 0, 5, 4, 1, 0], [0, 0, 5, 4, 0, 1],
    [0, 0, 5, 8, 0, 0], [0, 0, 5, 3, 0, 0],
  ]) {
    const mock = mockedClient({
      '/deviceGetRegistersMap': { Success: true, device_registers_map: {
        registers_map: [{ id: 'private-map', registers: ventilationRegisters }],
      } },
      '/deviceGetBufferReading': { Success: true, idRequest: 'read' },
      '/deviceJobStatus/read': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [8, 232, 33120, 33132, 33128, 33154], Values: values } },
    });
    const local = await setup(context, { fetch: mock.fetch, jobPollIntervalMs: 1 });
    const response = await local.post({ ...credentials, level: 3, confirmVentilationChange: true }, {}, '/ventilation-test');
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /Commande non envoyee/);
    assert.equal(mock.calls.includes('/deviceRequestWriting'), false);
  }
});

test('manual heating power level requires confirmation, writes only 33120 once and never retries failures', async context => {
  for (const failure of ['none', 'matched', '401', 'network', 'nack', 'readback', 'invalid-json', 'timeout']) {
    let reads = 0;
    const replies = {
      '/deviceGetRegistersMap': { Success: true, device_registers_map: {
        registers_map: [{ id: 'private-map', registers: ventilationRegisters }],
      } },
      '/deviceGetBufferReading': { Success: true, idRequest: 'read' },
      '/deviceJobStatus/read': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [8, 232, 33120, 33132, 33128, 33154],
          Values: [0, 0, 5, 4, 0, 0] } },
      '/deviceRequestWriting': { Success: true, idRequest: 'write' },
      '/deviceJobStatus/write': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: failure === 'nack' ? { NackErrCode: 0 } : {} },
    };
    const mock = mockedClient(replies);
    const writes = [];
    const local = await setup(context, { jobPollIntervalMs: 1, timeoutMs: 1000, fetch: (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/deviceGetBufferReading' && ++reads === 2 && failure === 'readback') {
        throw new Error('private');
      }
      if (reads === 2 && failure === 'matched') {
        replies['/deviceJobStatus/read'].jobAnswerData.Values[2] = 3;
      }
      if (path === '/deviceRequestWriting') {
        writes.push(JSON.parse(init.body));
        if (failure === '401') {
          return Promise.resolve(new globalThis.Response('{}', { status: 401 }));
        }
        if (failure === 'network') {
          throw new Error('private');
        }
        if (failure === 'invalid-json') {
          return Promise.resolve(new globalThis.Response('not JSON'));
        }
        if (failure === 'timeout') {
          return new Promise((_resolve, reject) =>
            init.signal.addEventListener('abort', () => reject(new Error('private')), { once: true }));
        }
      }
      return mock.fetch(url, init);
    } });
    for (const input of [{ level: 3 }, { level: 0, confirmPowerLevelChange: true },
      { level: 8, confirmPowerLevelChange: true }, { level: '3', confirmPowerLevelChange: true },
      { level: 3, confirmVentilationChange: true }]) {
      assert.equal((await local.post({ ...credentials, ...input }, {}, '/power-level-test')).status, 400);
    }
    const input = { ...credentials, level: 3, confirmPowerLevelChange: true };
    assert.equal((await local.post(input, { 'X-Nobis-Token': 'wrong' }, '/power-level-test')).status, 403);
    assert.equal(mock.calls.length, 0);
    const response = await local.post(input, {}, '/power-level-test');
    const data = await response.json();
    assert.equal(response.status, ['none', 'matched'].includes(failure) ? 200 : 502);
    assert.deepEqual(writes, [{
      id_device: 'private-device', id_product: 'private-product', Protocol: 'RWMSmaster',
      BitData: 8, Endianess: 'L', Items: [33120], Masks: [65535], Values: [3],
    }]);
    if (response.status === 200) {
      assert.equal(data.originalLevel, 5);
      assert.equal(data.requestedLevel, 3);
      assert.equal(data.after.registers[0].rawValue, failure === 'matched' ? 3 : 5);
      assert.equal(data.physicalEffectVerified, false);
      assert.equal(data.freshnessVerified, false);
      assert.equal(reads, failure === 'matched' ? 2 : 4);
      assert.equal(data.observations.length, failure === 'matched' ? 1 : 3);
      assert.equal(data.readbackMatches, failure === 'matched');
    } else {
      assert.match(data.error, /aucune repetition ni restauration automatiques/);
    }
    assert.equal(mock.calls.filter(path => path === '/userLogin').length, 1);
    assert.equal(JSON.stringify(data).includes('private'), false);
  }
});

test('heating power level refuses unsupported initial conditions and unchanged targets before sending', async context => {
  for (const values of [
    [8, 0, 5, 4, 0, 0], [2, 0, 5, 4, 0, 0], [0, 0, 5, 4, 1, 0],
    [0, 0, 5, 4, 0, 1], [0, 0, 3, 4, 0, 0], [0, 0, 8, 4, 0, 0],
  ]) {
    const mock = mockedClient({
      '/deviceGetRegistersMap': { Success: true, device_registers_map: {
        registers_map: [{ id: 'private-map', registers: ventilationRegisters }],
      } },
      '/deviceGetBufferReading': { Success: true, idRequest: 'read' },
      '/deviceJobStatus/read': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [8, 232, 33120, 33132, 33128, 33154], Values: values } },
    });
    const local = await setup(context, { fetch: mock.fetch, jobPollIntervalMs: 1 });
    const response = await local.post({ ...credentials, level: 3, confirmPowerLevelChange: true }, {}, '/power-level-test');
    assert.equal(response.status, 502);
    assert.equal(mock.calls.includes('/deviceRequestWriting'), false);
  }
});

test('heating power level page confirms per click, clears secrets and distinguishes API readback from physical success', async () => {
  const settings = {
    receivedAt: 123, freshness: 'unknown', controlValidated: false,
    registers: [
      { key: 'power_set', offset: 33120, rawValue: 5, label: null },
      { key: 'vent_front_set', offset: 33132, rawValue: 4, label: null },
      { key: 'fun_auto_set', offset: 33128, rawValue: 0, label: 'OFF' },
      { key: 'fun_pwf_set', offset: 33154, rawValue: 0, label: 'OFF' },
    ],
  };
  let data = { originalLevel: 5, requestedLevel: 3, before: settings, after: settings,
    physicalEffectVerified: false, freshnessVerified: false, observations: [settings], readbackMatches: false };
  let calls = 0;
  const page = pageHarness(async (path, init) => {
    assert.equal(path, '/power-level-test');
    const input = JSON.parse(init.body);
    assert.equal(input.confirmPowerLevelChange, true);
    assert.equal(input.confirmVentilationChange, undefined);
    calls++;
    return { ok: true, json: async () => data };
  });
  page.elements.operation.value = 'power-level';
  page.elements.operation.listeners.change();
  assert.equal(page.elements['ventilation-controls'].hidden, false);
  page.elements['ventilation-target'].value = '3';
  await page.submit();
  assert.equal(calls, 0);
  page.elements['ventilation-confirm'].checked = true;
  await page.submit();
  assert.equal(calls, 1);
  assert.equal(page.elements.password.value, '');
  assert.equal(page.elements['ventilation-confirm'].checked, false);
  assert.match(page.elements.result.textContent, /ne renvoyez pas/);
  assert.match(page.elements['ventilation-values'].textContent, /Puissance de chauffe/);
  data = { ...data, after: { ...settings, registers: settings.registers.map((entry, i) =>
    i === 0 ? { ...entry, rawValue: 3 } : entry) } };
  data = { ...data, observations: [data.after], readbackMatches: true };
  page.elements.password.value = credentials.password;
  page.elements['ventilation-confirm'].checked = true;
  await page.submit();
  assert.match(page.elements.result.textContent, /concordante, effet physique NON confirme/);
  data = { ...data, physicalEffectVerified: true };
  page.elements.password.value = credentials.password;
  page.elements['ventilation-confirm'].checked = true;
  await page.submit();
  assert.equal(page.elements['ventilation-result'].hidden, true);
  assert.match(page.elements.result.textContent, /Ne repetez pas/);
  page.elements['ventilation-confirm'].checked = true;
  page.elements.operation.value = 'ventilation';
  page.elements.operation.listeners.change();
  assert.equal(page.elements['ventilation-confirm'].checked, false);
});

for (const mode of ['auto', 'powerful']) {
test(`manual ${mode} writes one register with independent confirmation and no retry on failures`, async context => {
  const key = mode === 'auto' ? 'fun_auto_set' : 'fun_pwf_set';
  const index = mode === 'auto' ? 4 : 5;
  const offset = mode === 'auto' ? 33128 : 33154;
  const confirmation = mode === 'auto' ? 'confirmAutoChange' : 'confirmPowerfulChange';
  const route = '/' + mode + '-test';
  const registers = ventilationRegisters.map(entry => entry.reg_key === key ? {
    ...entry, enc_val: [{ value: 0, lang: 'FRE', description: 'OFF' }, { value: 1, lang: 'FRE', description: 'ON' }],
  } : entry);
  for (const [enabled, failure] of [
    [true, 'matched'], [false, 'matched'], [true, 'delayed'], [true, 'different'], [true, '401'],
    [true, 'network'], [true, 'nack'], [true, 'readback'], [true, 'invalid-json'], [true, 'timeout'],
  ]) {
    let reads = 0;
    const original = enabled ? 0 : 1;
    const replies = {
      '/deviceGetRegistersMap': { Success: true, device_registers_map: {
        registers_map: [{ id: 'private-map', registers }],
      } },
      '/deviceGetBufferReading': { Success: true, idRequest: 'read' },
      '/deviceJobStatus/read': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [8, 232, 33120, 33132, 33128, 33154],
          Values: [0, 0, 5, 4, mode === 'auto' ? original : 0, mode === 'powerful' ? original : 0] } },
      '/deviceRequestWriting': { Success: true, idRequest: 'write' },
      '/deviceJobStatus/write': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: failure === 'nack' ? { NackErrCode: 0 } : {} },
    };
    const mock = mockedClient(replies);
    const writes = [];
    const local = await setup(context, { jobPollIntervalMs: 1, timeoutMs: 1000, fetch: (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/deviceGetBufferReading' && ++reads >= 2) {
        if (failure === 'readback') {
          throw new Error('private');
        }
        if (failure === 'matched' || (failure === 'delayed' && reads === 3)) {
          replies['/deviceJobStatus/read'].jobAnswerData.Values[index] = Number(enabled);
        }
      }
      if (path === '/deviceRequestWriting') {
        writes.push(JSON.parse(init.body));
        if (failure === '401') {
          return Promise.resolve(new globalThis.Response('{}', { status: 401 }));
        }
        if (failure === 'network') {
          throw new Error('private');
        }
        if (failure === 'invalid-json') {
          return Promise.resolve(new globalThis.Response('invalid JSON'));
        }
        if (failure === 'timeout') {
          return new Promise((_resolve, reject) =>
            init.signal.addEventListener('abort', () => reject(new Error('private')), { once: true }));
        }
      }
      return mock.fetch(url, init);
    } });
    for (const input of [{ enabled }, { enabled: 1, [confirmation]: true },
      { enabled: 'on', [confirmation]: true }, { enabled, confirmPowerChange: true }]) {
      assert.equal((await local.post({ ...credentials, ...input }, {}, route)).status, 400);
    }
    const input = { ...credentials, enabled, [confirmation]: true };
    assert.equal((await local.post(input, { 'X-Nobis-Token': 'wrong' }, route)).status, 403);
    assert.equal(mock.calls.length, 0);
    const response = await local.post(input, {}, route);
    const data = await response.json();
    assert.equal(response.status, ['matched', 'delayed', 'different'].includes(failure) ? 200 : 502);
    assert.deepEqual(writes, [{
      id_device: 'private-device', id_product: 'private-product', Protocol: 'RWMSmaster',
      BitData: 8, Endianess: 'L', Items: [offset], Masks: [65535], Values: [Number(enabled)],
    }]);
    if (response.status === 200) {
      assert.equal(data.originalEnabled, !enabled);
      assert.equal(data.requestedEnabled, enabled);
      const matched = failure === 'matched' || failure === 'delayed';
      assert.equal(data.after.registers[index - 2].rawValue, matched ? Number(enabled) : original);
      assert.equal(data.physicalEffectVerified, false);
      assert.equal(data.freshnessVerified, false);
      assert.equal(reads, failure === 'matched' ? 2 : failure === 'delayed' ? 3 : 4);
      assert.equal(data.observations.length, reads - 1);
      assert.equal(data.readbackMatches, matched);
    } else {
      assert.match(data.error, /aucune repetition ni restauration automatiques/);
    }
    assert.equal(mock.calls.filter(path => path === '/userLogin').length, 1);
    assert.equal(JSON.stringify(data).includes('private'), false);
  }
});
}

test('Powerful route refuses Auto active, transitions, CRONO, unchanged targets and wrong confirmation', async context => {
  for (const [phase, auto, powerful] of [[7, 0, 0], [2, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 2]]) {
    const mock = mockedClient({
      '/deviceGetRegistersMap': { Success: true, device_registers_map: {
        registers_map: [{ id: 'private-map', registers: ventilationRegisters.map(entry =>
          entry.reg_key === 'fun_pwf_set' ? { ...entry, enc_val: [
            { value: 0, lang: 'FRE', description: 'OFF' }, { value: 1, lang: 'FRE', description: 'ON' },
            { value: 2, lang: 'FRE', description: 'CRONO' },
          ] } : entry) }],
      } },
      '/deviceGetBufferReading': { Success: true, idRequest: 'read' },
      '/deviceJobStatus/read': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [8, 232, 33120, 33132, 33128, 33154], Values: [phase, 0, 5, 4, auto, powerful] } },
    });
    const local = await setup(context, { fetch: mock.fetch, jobPollIntervalMs: 1 });
    assert.equal((await local.post({ ...credentials, enabled: true, confirmAutoChange: true }, {}, '/powerful-test')).status, 400);
    assert.equal(mock.calls.length, 0);
    assert.equal((await local.post({ ...credentials, enabled: true, confirmPowerfulChange: true }, {}, '/powerful-test')).status, 502);
    assert.equal(mock.calls.includes('/deviceRequestWriting'), false);
  }
});

test('Powerful page uses its own confirmation, actual readback and resets selection when changing modes', async () => {
  const settings = {
    receivedAt: 123, freshness: 'unknown', controlValidated: false,
    registers: [
      { key: 'power_set', offset: 33120, rawValue: 5, label: null },
      { key: 'vent_front_set', offset: 33132, rawValue: 4, label: null },
      { key: 'fun_auto_set', offset: 33128, rawValue: 0, label: 'OFF' },
      { key: 'fun_pwf_set', offset: 33154, rawValue: 0, label: 'OFF' },
    ],
  };
  let data = { originalEnabled: false, requestedEnabled: true, before: settings, after: settings,
    observations: [settings], readbackMatches: false, physicalEffectVerified: false, freshnessVerified: false };
  let calls = 0;
  const page = pageHarness(async (path, init) => {
    assert.equal(path, '/powerful-test');
    const input = JSON.parse(init.body);
    assert.equal(input.confirmPowerfulChange, true);
    assert.equal(input.confirmAutoChange, undefined);
    assert.equal(input.enabled, true);
    calls++;
    return { ok: true, json: async () => data };
  });
  page.elements.operation.value = 'powerful';
  page.elements.operation.listeners.change();
  assert.equal(page.elements['auto-controls'].hidden, false);
  await page.submit();
  assert.equal(calls, 0);
  page.elements['auto-target'].value = 'on';
  page.elements['auto-confirm'].checked = true;
  await page.submit();
  assert.equal(calls, 1);
  assert.equal(page.elements.password.value, '');
  assert.equal(page.elements['auto-confirm'].checked, false);
  assert.match(page.elements.result.textContent, /Powerful relu different/);
  const after = { ...settings, registers: settings.registers.map((entry, index) =>
    index === 3 ? { ...entry, rawValue: 1, label: 'ON' } : entry) };
  data = { ...data, after, observations: [after], readbackMatches: true };
  page.elements.password.value = credentials.password;
  page.elements['auto-confirm'].checked = true;
  await page.submit();
  assert.match(page.elements.result.textContent, /Powerful relu concordant, effet physique NON confirme/);
  data = { ...data, observations: [settings] };
  page.elements.password.value = credentials.password;
  page.elements['auto-confirm'].checked = true;
  await page.submit();
  assert.equal(page.elements['ventilation-result'].hidden, true);
  assert.match(page.elements.result.textContent, /Powerful peut avoir ete applique/);
  page.elements.operation.value = 'auto';
  page.elements.operation.listeners.change();
  assert.equal(page.elements['auto-target'].value, '');
  assert.equal(page.elements['auto-confirm'].checked, false);
});

test('Auto initial-state and exact labels refuse invalid requests before writing', async context => {
  for (const [phase, auto, powerful, labels = [
    { value: 0, lang: 'FRE', description: 'OFF' }, { value: 1, lang: 'FRE', description: 'ON' },
  ]] of [[7, 0, 0], [2, 0, 0], [0, 0, 1], [0, 1, 0], [0, 0, 0, []]]) {
    const mock = mockedClient({
      '/deviceGetRegistersMap': { Success: true, device_registers_map: {
        registers_map: [{ id: 'private-map', registers: ventilationRegisters.map(entry =>
          entry.reg_key === 'fun_auto_set' ? { ...entry, enc_val: labels } : entry) }],
      } },
      '/deviceGetBufferReading': { Success: true, idRequest: 'read' },
      '/deviceJobStatus/read': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [8, 232, 33120, 33132, 33128, 33154], Values: [phase, 0, 5, 4, auto, powerful] } },
    });
    const local = await setup(context, { fetch: mock.fetch, jobPollIntervalMs: 1 });
    assert.equal((await local.post({ ...credentials, enabled: true, confirmAutoChange: true }, {}, '/auto-test')).status, 502);
    assert.equal(mock.calls.includes('/deviceRequestWriting'), false);
  }
});

test('Auto page requires an explicit boolean choice and confirmation, clears secrets and preserves uncertainty', async () => {
  const settings = {
    receivedAt: 123, freshness: 'unknown', controlValidated: false,
    registers: [
      { key: 'power_set', offset: 33120, rawValue: 5, label: null },
      { key: 'vent_front_set', offset: 33132, rawValue: 4, label: null },
      { key: 'fun_auto_set', offset: 33128, rawValue: 0, label: 'OFF' },
      { key: 'fun_pwf_set', offset: 33154, rawValue: 0, label: 'OFF' },
    ],
  };
  let data = { originalEnabled: false, requestedEnabled: true, before: settings, after: settings,
    physicalEffectVerified: false, freshnessVerified: false, observations: [settings], readbackMatches: false };
  let calls = 0;
  const page = pageHarness(async (path, init) => {
    assert.equal(path, '/auto-test');
    const input = JSON.parse(init.body);
    assert.equal(input.confirmAutoChange, true);
    assert.equal(input.enabled, true);
    assert.equal(input.confirmPowerChange, undefined);
    calls++;
    return { ok: true, json: async () => data };
  });
  page.elements.operation.value = 'auto';
  page.elements.operation.listeners.change();
  assert.equal(page.elements['auto-controls'].hidden, false);
  page.elements['auto-confirm'].checked = true;
  await page.submit();
  assert.equal(calls, 0);
  page.elements['auto-target'].value = 'on';
  page.elements['auto-confirm'].checked = false;
  await page.submit();
  assert.equal(calls, 0);
  page.elements['auto-confirm'].checked = true;
  await page.submit();
  assert.equal(calls, 1);
  assert.equal(page.elements.password.value, '');
  assert.equal(page.elements['auto-confirm'].checked, false);
  assert.match(page.elements.result.textContent, /Auto relu different/);
  assert.match(page.elements['ventilation-values'].textContent, /fun_auto_set=0/);
  data = { ...data, after: { ...settings, registers: settings.registers.map((entry, i) =>
    i === 2 ? { ...entry, rawValue: 1, label: 'ON' } : entry) } };
  data = { ...data, observations: [data.after], readbackMatches: true };
  page.elements.password.value = credentials.password;
  page.elements['auto-confirm'].checked = true;
  await page.submit();
  assert.match(page.elements.result.textContent, /concordant, effet physique NON confirme/);
  assert.match(page.elements['ventilation-values'].textContent, /Relectures : #1 1/);
  for (const invalid of [
    { ...data, observations: [] }, { ...data, observations: Array(4).fill(data.after) },
    { ...data, observations: [settings] }, { ...data, readbackMatches: false },
    { ...data, observations: [data.after, data.after] },
  ]) {
    const valid = data;
    data = invalid;
    page.elements.password.value = credentials.password;
    page.elements['auto-confirm'].checked = true;
    await page.submit();
    assert.equal(page.elements['ventilation-result'].hidden, true);
    assert.match(page.elements.result.textContent, /Ne repetez pas/);
    data = valid;
  }
  data = { ...data, physicalEffectVerified: true };
  page.elements.password.value = credentials.password;
  page.elements['auto-confirm'].checked = true;
  await page.submit();
  assert.equal(page.elements['ventilation-result'].hidden, true);
  assert.match(page.elements.result.textContent, /Ne repetez pas/);
  page.elements['auto-confirm'].checked = true;
  page.elements.operation.value = 'settings-read';
  page.elements.operation.listeners.change();
  assert.equal(page.elements['auto-confirm'].checked, false);
});

test('manual power requires confirmation, sends one map-derived write and never retries ambiguous failures', async context => {
  for (const [action, failure, initialPhase = action === 'on' ? 0 : 5] of [
    ['on', 'none'], ['off', 'none'], ['on', '401'], ['on', 'network'], ['on', 'nack'], ['on', 'readback'],
    ['off', 'none', 8], ['off', '401', 8], ['off', 'network', 8], ['off', 'nack', 8],
  ]) {
    const replies = {
      '/deviceGetRegistersMap': { Success: true, device_registers_map: {
        registers_map: [{ id: 'private-map', registers: powerRegisters }],
      } },
      '/deviceGetBufferReading': { Success: true, idRequest: 'read' },
      '/deviceJobStatus/read': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [8, 232], Values: [initialPhase, 0] } },
      '/deviceRequestWriting': { Success: true, idRequest: 'write' },
      '/deviceJobStatus/write': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: failure === 'nack' ? { NackErrCode: 0 } : {} },
    };
    const mock = mockedClient(replies);
    const writes = [];
    let reads = 0;
    const local = await setup(context, { jobPollIntervalMs: 1, fetch: (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/deviceGetBufferReading' && ++reads === 2 && failure === 'readback') {
        throw new Error('private readback failure');
      }
      if (path === '/deviceRequestWriting') {
        writes.push(JSON.parse(init.body));
        if (failure === '401') {
          return Promise.resolve(new globalThis.Response('{}', { status: 401 }));
        }
        if (failure === 'network') {
          throw new Error('private write failure');
        }
      }
      return mock.fetch(url, init);
    } });
    for (const input of [{ ...credentials, action: 'on' },
      { ...credentials, action: 'invalid', confirmPowerChange: true },
      { ...credentials, action: ['on'], confirmPowerChange: true }]) {
      assert.equal((await local.post(input, {}, '/power-test')).status, 400);
    }
    assert.equal(mock.calls.length, 0);
    assert.equal((await local.post({ ...credentials, action: 'on', confirmPowerChange: true },
      { 'X-Nobis-Token': 'wrong' }, '/power-test')).status, 403);
    const response = await local.post({ ...credentials, action, confirmPowerChange: true }, {}, '/power-test');
    const data = await response.json();
    assert.equal(response.status, failure === 'none' ? 200 : 502);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0], {
      id_device: 'private-device', id_product: 'private-product',
      Protocol: 'RWMSmaster', BitData: 8, Endianess: 'L', Items: [232], Masks: [255], Values: [action === 'on' ? 85 : 170],
    });
    if (failure === 'none') {
      assert.equal(data.before.phase.kind, initialPhase === 8 ? 'eco-stop' : action === 'on' ? 'off' : 'working');
      assert.equal(data.after.phase.kind, data.before.phase.kind);
      assert.equal(data.physicalEffectVerified, false);
      assert.equal(data.freshnessVerified, false);
      assert.equal(reads, 2);
    } else {
      assert.match(data.error, /Effet physique non confirme/);
    }
    assert.equal(JSON.stringify(data).includes('private'), false);
  }
});

test('power requests from unknown or transitional phases and incompatible masks never send a command', async context => {
  for (const [code, action, mask] of [[0, 'off', 255], [5, 'on', 255], [2, 'on', 255], [7, 'off', 255], [0, 'on', 65535]]) {
    const mock = mockedClient({
      '/deviceGetRegistersMap': { Success: true, device_registers_map: {
        registers_map: [{ id: 'private-map', registers: [powerRegisters[0], { ...powerRegisters[1], mask }] }],
      } },
      '/deviceGetBufferReading': { Success: true, idRequest: 'read' },
      '/deviceJobStatus/read': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [8, 232], Values: [code, 0] } },
    });
    const local = await setup(context, { fetch: mock.fetch, jobPollIntervalMs: 1 });
    assert.equal((await local.post({ ...credentials, action, confirmPowerChange: true }, {}, '/power-test')).status, 502);
    assert.equal(mock.calls.includes('/deviceRequestWriting'), false);
  }
});

test('power page requires physical confirmation, resets it and preserves uncertainty for unchanged readback', async () => {
  let calls = 0;
  let ok = true;
  const observation = { receivedAt: 123, freshness: 'unknown', phase: { kind: 'off', code: 0 } };
  const page = pageHarness(async (path, init) => {
    calls++;
    assert.equal(path, '/power-test');
    assert.equal(JSON.parse(init.body).confirmPowerChange, true);
    return { ok, json: async () => ok ? {
      action: 'on', mask: 255, before: observation, after: observation,
      physicalEffectVerified: false, freshnessVerified: false,
    } : { error: 'Effet physique non confirme' } };
  });
  page.elements.operation.value = 'power';
  page.elements.operation.listeners.change();
  page.elements['power-action'].value = 'on';
  await page.submit();
  assert.equal(calls, 0);
  page.elements['power-confirm'].checked = true;
  await page.submit();
  assert.equal(calls, 1);
  assert.equal(page.elements['power-confirm'].checked, false);
  assert.equal(page.elements.password.value, '');
  assert.equal(page.elements['power-result'].hidden, false);
  assert.match(page.elements.result.textContent, /NON confirme/);
  assert.match(page.elements['power-values'].textContent, /Avant : 0.*\nApres : 0/);
  ok = false;
  page.elements.password.value = credentials.password;
  page.elements['power-confirm'].checked = true;
  await page.submit();
  assert.equal(page.elements['power-result'].hidden, true);
  assert.equal(page.elements['power-values'].textContent, '');
});

test('power page accepts an OFF job from ECO STOP without claiming its unchanged phase confirms extinction', async () => {
  const observation = { receivedAt: 123, freshness: 'unknown', phase: { kind: 'eco-stop', code: 8 } };
  const page = pageHarness(async () => ({ ok: true, json: async () => ({
    action: 'off', mask: 255, before: observation, after: observation,
    physicalEffectVerified: false, freshnessVerified: false,
  }) }));
  page.elements.operation.value = 'power';
  page.elements.operation.listeners.change();
  page.elements['power-action'].value = 'off';
  page.elements['power-confirm'].checked = true;
  await page.submit();
  assert.equal(page.elements['power-result'].hidden, false);
  assert.match(page.elements['power-values'].textContent, /Avant : 8 \(eco-stop\)/);
  assert.match(page.elements.result.textContent, /NON confirme/);
});

async function setup(context, clientOptions = {}, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'nobis-browser-test-'));
  const browser = await startDiagnosticBrowser(root, { clientOptions, ...options });
  context.after(async () => {
    await browser.close();
    await rm(root, { recursive: true, force: true });
  });
  const script = await (await globalThis.fetch(`${browser.url}/app.js`)).text();
  const token = script.match(/'X-Nobis-Token': "([a-f0-9]+)"/)[1];
  const headers = { Origin: browser.url, 'X-Nobis-Token': token, 'Content-Type': 'application/json' };
  const post = (input, override = {}, path = '/discover') => globalThis.fetch(`${browser.url}${path}`, {
    method: 'POST', headers: { ...headers, ...override }, body: JSON.stringify(input),
  });
  return { root, browser, headers, post };
}

const credentials = { email: 'fictional@example.invalid', password: ' private password ' };

const ambientRegister = {
  reg_key: 'temp_air2_get', reg_type: 'GET', offset: 103, mask: 65535,
  formula: '#', is_word: true, big_endian: false, with_sign: false,
};

const setpointRegister = {
  reg_key: 'temp_air_set', reg_type: 'SET', readonly: false, offset: 33122,
  mask: 65535, formula: '#', formula_inverse: '#', set_min: 7, set_max: 41,
  step: 1, is_word: true, big_endian: false, with_sign: false,
  enc_val: [{ value: 41, lang: 'FRE', description: 'MAN' }],
};

test('operating settings route reads once with writes disabled and fails explicitly for incompatible profiles', async context => {
  for (const incompatible of [false, true]) {
    const registers = [
      ['power_set', 33120, 1, 7], ['vent_front_set', 33132, 0, 8],
      ['fun_auto_set', 33128, 0, 1], ['fun_pwf_set', 33154, 0, 1],
    ].map(([reg_key, offset, set_min, set_max]) => ({
      reg_key, reg_type: 'SET', offset, set_min, set_max, mask: incompatible ? 255 : 65535,
      formula: '#', formula_inverse: '#', readonly: false, step: 1,
      is_word: true, big_endian: false, with_sign: false,
    }));
    const mock = mockedClient({
      '/deviceGetRegistersMap': { Success: true, device_registers_map: {
        registers_map: [{ id: 'private-map', registers }],
      } },
      '/deviceGetBufferReading': { Success: true, idRequest: 'read' },
      '/deviceJobStatus/read': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [33120, 33132, 33128, 33154], Values: [5, 4, 0, 0] } },
    });
    const local = await setup(context, {
      fetch: mock.fetch, jobPollIntervalMs: 1, enableExperimentalPower: true, enableExperimentalSetpoint: true,
      enableExperimentalPowerLevel: true,
      enableExperimentalAuto: true,
    });
    assert.equal((await local.post(credentials, { 'X-Nobis-Token': 'wrong' }, '/settings-read')).status, 403);
    assert.equal(mock.calls.length, 0);
    const response = await local.post({ ...credentials, action: 'on', confirmPowerChange: true,
      celsius: 28, confirmSetpointChange: true, level: 3, confirmPowerLevelChange: true,
      enabled: true, confirmAutoChange: true }, {}, '/settings-read');
    assert.equal(response.status, incompatible ? 502 : 200);
    const data = await response.json();
    if (!incompatible) {
      assert.equal(data.settings.controlValidated, false);
      assert.deepEqual(data.settings.registers.map(x => x.rawValue), [5, 4, 0, 0]);
    } else {
      assert.match(data.error, /operating-settings/);
    }
    assert.equal(JSON.stringify(data).includes('private'), false);
    assert.equal(mock.calls.includes('/deviceRequestWriting'), false);
    assert.equal(mock.calls.filter(path => path === '/deviceGetBufferReading').length, 1);
  }
});

test('settings page renders candidates as text and clears stale values on error or malformed responses', async () => {
  const settings = {
    receivedAt: 123, freshness: 'unknown', controlValidated: false,
    registers: [
      { key: 'power_set', offset: 33120, rawValue: 5, label: null },
      { key: 'vent_front_set', offset: 33132, rawValue: 8, label: '<script>PS</script>' },
      { key: 'fun_auto_set', offset: 33128, rawValue: 0, label: 'OFF' },
      { key: 'fun_pwf_set', offset: 33154, rawValue: 0, label: 'OFF' },
    ],
  };
  let data = { bufferId: 1, settings };
  let ok = true;
  const page = pageHarness(async path => {
    assert.equal(path, '/settings-read');
    return { ok, json: async () => data };
  });
  page.elements.operation.value = 'settings-read';
  page.elements.operation.listeners.change();
  assert.match(page.elements.connect.textContent, /sans commande/);
  await page.submit();
  assert.equal(page.elements.password.value, '');
  assert.equal(page.elements['settings-reading'].hidden, false);
  assert.match(page.elements['settings-reading-value'].textContent, /<script>PS<\/script>/);
  page.elements['clear-settings-reading'].listeners.click();
  assert.equal(page.elements['settings-reading-value'].textContent, '');
  for (const invalid of [
    { ...settings, controlValidated: true }, { ...settings, receivedAt: -1 },
    { ...settings, registers: settings.registers.slice(1) },
    { ...settings, registers: settings.registers.map(x => ({ ...x, rawValue: 9 })) },
    { ...settings, registers: settings.registers.map(x => ({ ...x, label: {} })) },
  ]) {
    data = { bufferId: 1, settings: invalid };
    page.elements.password.value = credentials.password;
    await page.submit();
    assert.equal(page.elements['settings-reading'].hidden, true);
    assert.equal(page.elements['settings-reading-value'].textContent, '');
  }
  ok = false;
  data = { error: 'Explicit failure' };
  page.elements.password.value = credentials.password;
  await page.submit();
  assert.equal(page.elements.result.textContent, 'Explicit failure');
  assert.equal(page.elements['settings-reading'].hidden, true);
});

test('status route reads buffer one once and keeps unknown codes without enabling writes', async context => {
  const mock = mockedClient({
    '/deviceGetRegistersMap': { Success: true, device_registers_map: {
      registers_map: [{ id: 'private-map', registers: [
        { reg_key: 'status_get', reg_type: 'GET', offset: 8, mask: 65535, formula: '#',
          enc_val: [{ value: 0, lang: 'FRE', description: 'OFF' }] },
        { reg_key: 'status_managed_get', reg_type: 'GET', offset: 232, mask: 255, formula: '#',
          enc_val: [{ value: 85, lang: 'FRE', description: 'ON' }] },
      ] }],
    } },
    '/deviceGetBufferReading': { Success: true, idRequest: 'read' },
    '/deviceJobStatus/read': { Success: true, jobAnswerStatus: 'completed',
      jobAnswerData: { Items: [8, 232, 103], Values: [0, 0, 23] } },
  });
  const local = await setup(context, {
    fetch: mock.fetch, jobPollIntervalMs: 1, enableExperimentalSetpoint: true, enableExperimentalPower: true,
    enableExperimentalVentilation: true, enableExperimentalPowerLevel: true,
  });
  assert.equal((await local.post(credentials, { 'X-Nobis-Token': 'wrong' }, '/status-read')).status, 403);
  assert.equal(mock.calls.length, 0);
  const response = await local.post({ ...credentials, confirmSetpointChange: true, celsius: 28 }, {}, '/status-read');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.bufferId, 1);
  assert.equal(data.status.freshness, 'unknown');
  assert.deepEqual(data.status.phase, { kind: 'off', code: 0 });
  assert.equal(data.status.registers[0].label, 'OFF');
  assert.equal(data.status.registers[1].label, null);
  assert.equal(JSON.stringify(data).includes('private'), false);
  assert.equal('values' in data, false);
  assert.equal(mock.calls.includes('/deviceRequestWriting'), false);
  assert.equal(mock.calls.filter(path => path === '/deviceGetBufferReading').length, 1);
});

test('status page renders labels as text and clears on error, invalid response or explicit action', async () => {
  let response = { ok: true, json: async () => ({ bufferId: 1, status: {
    receivedAt: 123, freshness: 'unknown',
    phase: { kind: 'unknown', code: 0, reason: 'label-mismatch' },
    registers: [
      { key: 'status_get', offset: 8, rawValue: 0, label: '<script>OFF</script>' },
      { key: 'status_managed_get', offset: 232, rawValue: 0, label: null },
    ],
  } }) };
  const page = pageHarness(async path => {
    assert.equal(path, '/status-read');
    return response;
  });
  page.elements.operation.value = 'status-read';
  page.elements.operation.listeners.change();
  await page.submit();
  assert.match(page.elements['status-reading-value'].textContent, /<script>OFF<\/script>/);
  assert.match(page.elements['status-reading-value'].textContent, /INCONNU/);
  assert.equal(page.elements['status-reading'].hidden, false);
  assert.equal(page.elements['setpoint-controls'].hidden, true);
  page.elements['clear-status-reading'].listeners.click();
  assert.equal(page.elements['status-reading-value'].textContent, '');
  for (const next of [
    { ok: false, json: async () => ({ error: 'Lecture refusee' }) },
    { ok: true, json: async () => ({ bufferId: 1, status: {} }) },
  ]) {
    response = next;
    page.elements.password.value = credentials.password;
    await page.submit();
    assert.equal(page.elements['status-reading'].hidden, true);
    assert.equal(page.elements['status-reading-value'].textContent, '');
    assert.equal(page.elements.password.value, '');
    assert.match(page.elements.result.textContent, /Lecture refusee|reponse invalide/);
  }
});

test('status page distinguishes all compared phases and rejects inconsistent phase payloads without stale display', async () => {
  let status;
  const page = pageHarness(async () => ({ ok: true, json: async () => ({ bufferId: 1, status }) }));
  page.elements.operation.value = 'status-read';
  page.elements.operation.listeners.change();
  const sample = (code, label, phase) => ({
    receivedAt: 123, freshness: 'unknown', phase,
    registers: [
      { key: 'status_get', offset: 8, rawValue: code, label },
      { key: 'status_managed_get', offset: 232, rawValue: 0, label: null },
    ],
  });
  for (const [code, label, kind, expected] of [
    [0, 'OFF', 'off', /Eteint/],
    [2, 'D\u00c9BUT', 'starting', /Demarrage/],
    [5, 'TRAVAIL', 'working', /Phase observee : Travail/],
    [7, 'ARR\u00caT', 'stopping', /Arret en cours \(pas encore OFF\)/],
    [8, 'ECO STOP', 'eco-stop', /Pause ECO STOP \(activation conservee\)/],
    [9, 'STAND BY', 'unknown', /NON VALIDEE SUR APPAREIL/],
  ]) {
    status = sample(code, label, { kind, code, ...(kind === 'unknown' ? { reason: 'unvalidated-code' } : {}) });
    page.elements.password.value = credentials.password;
    await page.submit();
    assert.equal(page.elements['status-reading'].hidden, false);
    assert.match(page.elements['status-reading-value'].textContent, expected);
  }
  for (const invalid of [
    sample(7, 'ARR\u00caT', { kind: 'off', code: 7 }),
    sample(0, 'TRAVAIL', { kind: 'off', code: 0 }),
    sample(5, 'TRAVAIL', { kind: 'working', code: 0 }),
    sample(5, 'TRAVAIL', { kind: 'unknown', code: 5, reason: 'unvalidated-code' }),
    sample(5, 'TRAVAIL', { kind: 'unknown', code: 5, reason: 'label-mismatch' }),
    sample(8, 'ECO STOP', { kind: 'unknown', code: 8, reason: 'label-mismatch' }),
    sample(8, 'ECO STOP', { kind: 'unknown', code: 8, reason: 'unvalidated-code' }),
    sample(8, 'OFF', { kind: 'eco-stop', code: 8 }),
    sample(0, 'OFF', { kind: '__proto__', code: 0 }),
    sample(0, 'OFF', undefined),
  ]) {
    status = invalid;
    page.elements.password.value = credentials.password;
    await page.submit();
    assert.equal(page.elements['status-reading'].hidden, true);
    assert.equal(page.elements['status-reading-value'].textContent, '');
    assert.match(page.elements.result.textContent, /reponse invalide/);
  }
});

test('read-only setpoint route never enables writes and exposes temperature or MAN without other readings', async context => {
  for (const value of [18, 41]) {
    const mock = mockedClient({
      '/deviceGetRegistersMap': { Success: true, device_registers_map: {
        registers_map: [{ id: 'private-map', registers: [setpointRegister] }],
      } },
      '/deviceGetBufferReading': { Success: true, idRequest: 'read' },
      '/deviceJobStatus/read': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [33122, 103], Values: [value, 23] } },
    });
    const local = await setup(context, { fetch: mock.fetch, jobPollIntervalMs: 1 });
    assert.equal((await local.post(credentials, { 'X-Nobis-Token': 'wrong' }, '/setpoint-read')).status, 403);
    assert.equal(mock.calls.length, 0);
    const response = await local.post({ ...credentials, confirmSetpointChange: true, celsius: 28 }, {}, '/setpoint-read');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.setpoint.mode, value === 41 ? 'manual' : 'temperature');
    assert.equal(data.setpoint.celsius, value === 41 ? undefined : value);
    assert.equal(data.setpoint.freshness, 'unknown');
    assert.equal(JSON.stringify(data).includes('private'), false);
    assert.equal('values' in data, false);
    assert.equal(mock.calls.includes('/deviceRequestWriting'), false);
    assert.equal(mock.calls.filter(path => path === '/deviceGetBufferReading').length, 1);
  }
});

test('read-only setpoint page shows MAN without degrees and clears prior values on failure', async () => {
  let ok = true;
  let setpoint = { mode: 'manual', freshness: 'unknown', receivedAt: 123 };
  const page = pageHarness(async path => {
    assert.equal(path, '/setpoint-read');
    return { ok, json: async () => ok ? { bufferId: 1, setpoint } : { error: 'Lecture refusee' } };
  });
  page.elements.operation.value = 'setpoint-read';
  page.elements.operation.listeners.change();
  await page.submit();
  assert.match(page.elements['setpoint-reading-value'].textContent, /pas 41 degres/);
  assert.equal(page.elements['setpoint-controls'].hidden, true);
  page.elements['clear-setpoint-reading'].listeners.click();
  assert.equal(page.elements['setpoint-reading'].hidden, true);
  setpoint = { mode: 'temperature', celsius: 18, freshness: 'unknown', receivedAt: 123 };
  page.elements.password.value = credentials.password;
  await page.submit();
  assert.match(page.elements['setpoint-reading-value'].textContent, /18 degres/);
  ok = false;
  page.elements.password.value = credentials.password;
  await page.submit();
  assert.equal(page.elements['setpoint-reading-value'].textContent, '');
  assert.equal(page.elements['setpoint-reading'].hidden, true);
  assert.equal(page.elements.result.textContent, 'Lecture refusee');
});

test('manual setpoint test requires explicit confirmation and sends one exact write followed by a separate read', async context => {
  for (const observed of [19, 20]) {
    const replies = {
      '/deviceGetRegistersMap': { Success: true, device_registers_map: {
        registers_map: [{ id: 'private-map', registers: [setpointRegister] }],
      } },
      '/deviceGetBufferReading': { Success: true, idRequest: 'read' },
      '/deviceJobStatus/read': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [33122], Values: [20] } },
      '/deviceRequestWriting': { Success: true, idRequest: 'write' },
      '/deviceJobStatus/write': { Success: true, jobAnswerStatus: 'completed', jobAnswerData: {} },
    };
    const mock = mockedClient(replies);
    let reads = 0;
    const writes = [];
    const local = await setup(context, { jobPollIntervalMs: 1, fetch: (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/deviceGetBufferReading' && ++reads === 2) {
        replies['/deviceJobStatus/read'].jobAnswerData.Values = [observed];
      }
      if (path === '/deviceRequestWriting') {
        writes.push(JSON.parse(init.body));
      }
      return mock.fetch(url, init);
    } });
    for (const input of [
      { ...credentials, celsius: 19 },
      { ...credentials, celsius: 41, confirmSetpointChange: true },
    ]) {
      assert.equal((await local.post(input, {}, '/setpoint-test')).status, 400);
    }
    assert.equal(mock.calls.length, 0);
    assert.equal((await local.post({ ...credentials, celsius: 19, confirmSetpointChange: true },
      { Origin: 'https://attacker.example' }, '/setpoint-test')).status, 403);
    const response = await local.post({ ...credentials, celsius: 19, confirmSetpointChange: true }, {}, '/setpoint-test');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.originalCelsius, 20);
    assert.equal(result.observedCelsius, observed);
    assert.equal(result.readbackMatches, observed === 19);
    assert.equal(result.freshnessVerified, false);
    assert.deepEqual(writes, [{
      id_device: 'private-device', id_product: 'private-product',
      Protocol: 'RWMSmaster', BitData: 8, Endianess: 'L', Items: [33122], Masks: [65535], Values: [19],
    }]);
    assert.equal(reads, observed === 19 ? 2 : 4);
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.deepEqual(await readdir(join(local.root, 'homebridge-nobis')), ['app-id']);
  }
});

test('manual writes are not repeated on 401, network ambiguity or Nack including zero', async context => {
  for (const failure of ['401', 'network', 'nack']) {
    const mock = mockedClient({
      '/deviceGetRegistersMap': { Success: true, device_registers_map: {
        registers_map: [{ id: 'private-map', registers: [setpointRegister] }],
      } },
      '/deviceGetBufferReading': { Success: true, idRequest: 'read' },
      '/deviceJobStatus/read': { Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { Items: [33122], Values: [20] } },
      '/deviceRequestWriting': { Success: true, idRequest: 'write' },
      '/deviceJobStatus/write': { Success: true, jobAnswerStatus: 'completed', jobAnswerData: { NackErrCode: 0 } },
    });
    let writes = 0;
    const local = await setup(context, { jobPollIntervalMs: 1, fetch: (url, init) => {
      if (new URL(url).pathname === '/deviceRequestWriting') {
        writes++;
        if (failure === '401') {
          return new globalThis.Response(JSON.stringify({ Success: false }), { status: 401 });
        }
        if (failure === 'network') {
          throw new Error('private-network');
        }
      }
      return mock.fetch(url, init);
    } });
    const response = await local.post({ ...credentials, celsius: 19, confirmSetpointChange: true }, {}, '/setpoint-test');
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.match(result.error, /indetermine/);
    assert.match(result.error, /restaurez/);
    assert.equal('readbackMatches' in result, false);
    assert.equal(writes, 1);
    assert.equal(mock.calls.includes('/refreshToken'), false);
    assert.equal(mock.calls.filter(path => path === '/deviceGetBufferReading').length, 1);
  }
});

test('setpoint page requires confirmation per click and distinguishes readback mismatch', async () => {
  let calls = 0;
  const page = pageHarness(async path => {
    calls++;
    assert.equal(path, '/setpoint-test');
    return { ok: true, json: async () => ({
      originalCelsius: 20, requestedCelsius: 19, observedCelsius: 20,
      readbackMatches: false, freshnessVerified: false,
    }) };
  });
  page.elements.operation.value = 'setpoint';
  page.elements.operation.listeners.change();
  page.elements['setpoint-target'].value = '19';
  await page.submit();
  assert.equal(calls, 0);
  page.elements['setpoint-confirm'].checked = true;
  await page.submit();
  assert.equal(calls, 1);
  assert.equal(page.elements['setpoint-confirm'].checked, false);
  assert.match(page.elements.result.textContent, /ne correspond PAS/);
  assert.equal(page.elements.password.value, '');
  page.elements['clear-setpoint'].listeners.click();
  assert.equal(page.elements['setpoint-result'].hidden, true);
  assert.equal(page.elements['setpoint-values'].textContent, '');
});

function temperatureReplies(register = ambientRegister, values = [23, 0]) {
  return {
    '/deviceGetRegistersMap': { Success: true, device_registers_map: { registers_map: [
      { id: 'private-map', registers: [register] },
    ] } },
    '/deviceGetBufferReading': { Success: true, idRequest: 'private-temperature-job' },
    '/deviceJobStatus/private-temperature-job': {
      Success: true, jobAnswerStatus: 'completed',
      jobAnswerPayload: { secret: 'private-payload' },
      jobAnswerData: { Items: [103, 8], Values: values },
    },
  };
}

test('temperature diagnostic checks the map, reads buffer one once and exposes only the decoded measurement', async (context) => {
  const mock = mockedClient(temperatureReplies());
  const bodies = [];
  const local = await setup(context, { jobPollIntervalMs: 1, fetch: (url, init) => {
    if (new URL(url).pathname === '/deviceGetBufferReading') {
      bodies.push(JSON.parse(init.body));
    }
    return mock.fetch(url, init);
  } });
  for (const headers of [{ Origin: 'https://attacker.example' }, { 'X-Nobis-Token': 'wrong' }]) {
    assert.equal((await local.post(credentials, headers, '/ambient-temperature')).status, 403);
  }
  assert.equal(mock.calls.length, 0);
  const response = await local.post({ ...credentials, bufferId: 132 }, {}, '/ambient-temperature');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data, { bufferId: 1, temperature: {
    registerKey: 'temp_air2_get', celsius: 23, freshness: 'unknown', receivedAt: data.temperature.receivedAt,
  } });
  assert.ok(Number.isSafeInteger(data.temperature.receivedAt));
  assert.deepEqual(bodies, [{ id_device: 'private-device', id_product: 'private-product', BufferId: 1 }]);
  assert.deepEqual(mock.calls, ['/appSignup', '/userLogin', '/deviceList', '/deviceGetInfo',
    '/deviceGetRegistersMap', '/deviceGetBufferReading', '/deviceJobStatus/private-temperature-job']);
  assert.equal(JSON.stringify(data).includes('private'), false);
  assert.deepEqual(await readdir(join(local.root, 'homebridge-nobis')), ['app-id']);
});

test('temperature diagnostic refuses incompatible profiles and missing values without retries or false success', async (context) => {
  for (const replies of [
    temperatureReplies({ ...ambientRegister, formula: '#/10' }),
    temperatureReplies(ambientRegister, [-1, 0]),
    { ...temperatureReplies(), '/deviceJobStatus/private-temperature-job': {
      Success: true, jobAnswerStatus: 'completed', jobAnswerData: { Items: [8], Values: [0] },
    } },
  ]) {
    const mock = mockedClient(replies);
    const local = await setup(context, { fetch: mock.fetch, jobPollIntervalMs: 1 });
    const response = await local.post(credentials, {}, '/ambient-temperature');
    assert.equal(response.status, 502);
    const data = await response.json();
    assert.match(data.error, /ambient-temperature/);
    assert.match(data.error, /Aucun repli/);
    assert.equal('temperature' in data, false);
    assert.equal(mock.calls.filter(path => path === '/deviceGetBufferReading').length, 1);
  }
});

test('temperature page renders unknown freshness and clears the value on clear, error and new attempts', async () => {
  let data = { bufferId: 1, temperature: {
    registerKey: 'temp_air2_get', celsius: 23, receivedAt: 1_700_000_000_000, freshness: 'unknown',
  } };
  let ok = true;
  let requested;
  const page = pageHarness(async path => {
    requested = path;
    assert.equal(page.elements['temperature-value'].textContent, '');
    return { ok, json: async () => data };
  });
  page.elements.operation.value = 'temperature';
  page.elements.operation.listeners.change();
  assert.match(page.elements.connect.textContent, /temperature ambiante/);
  await page.submit();
  assert.equal(requested, '/ambient-temperature');
  assert.equal(page.elements.temperature.hidden, false);
  assert.equal(page.elements['temperature-value'].textContent, '23 degres Celsius (temp_air2_get)');
  assert.match(page.elements['temperature-received'].textContent, /Heure de mesure inconnue/);
  assert.match(page.elements.result.textContent, /Fraicheur inconnue/);
  assert.equal(page.elements['raw-values'].children.length, 0);
  assert.equal(page.elements.password.value, '');
  page.elements['clear-temperature'].listeners.click();
  assert.equal(page.elements.temperature.hidden, true);
  assert.equal(page.elements['temperature-value'].textContent, '');
  const valid = data;
  for (const invalid of [
    { ...valid, bufferId: 131 }, { ...valid, temperature: null },
    ...[{ freshness: 'verified' }, { registerKey: 'temp_air_get' }, { celsius: '23' },
      { celsius: -1 }, { celsius: 65536 }, { receivedAt: -1 }].map(patch => ({
      ...valid, temperature: { ...valid.temperature, ...patch },
    })),
  ]) {
    data = valid;
    page.elements.password.value = credentials.password;
    await page.submit();
    data = invalid;
    page.elements.password.value = credentials.password;
    await page.submit();
    assert.equal(page.elements.temperature.hidden, true);
    assert.equal(page.elements['temperature-value'].textContent, '');
    assert.match(page.elements.result.textContent, /Aucun succes confirme/);
  }
  ok = false;
  data = { error: 'Temperature refusee' };
  page.elements.password.value = credentials.password;
  await page.submit();
  assert.equal(page.elements.result.textContent, 'Temperature refusee');
  assert.equal(page.elements.temperature.hidden, true);
});

test('refused reading structure is displayed as a failure, cleared locally and never converted to raw values', async () => {
  const structure = { dataType: 'object', payloadType: 'object', itemsType: 'array', valuesType: 'array',
    itemCount: 2, valueCount: 2 };
  const page = pageHarness(async () => ({
    ok: false, json: async () => ({ error: 'Lecture refusee', readingStructure: structure }),
  }));
  page.elements.operation.value = 'buffer-one';
  await page.submit();
  assert.equal(page.elements.result.textContent, 'Lecture refusee');
  assert.equal(page.elements['reading-failure'].hidden, false);
  assert.deepEqual(JSON.parse(page.elements['reading-structure'].textContent), structure);
  assert.equal(page.elements['raw-values'].children.length, 0);
  assert.equal(page.elements.password.value, '');
  page.elements['clear-failure'].listeners.click();
  assert.equal(page.elements['reading-failure'].hidden, true);
  assert.equal(page.elements['reading-structure'].textContent, '');
});

test('explicit buffer one route sends only BufferId 1 and returns raw integers without secrets or persistence', async (context) => {
  const mock = mockedClient({
    '/deviceGetBufferReading': { Success: true, idRequest: 'private-reading-job' },
    '/deviceJobStatus/private-reading-job': {
      Success: true, jobAnswerStatus: 'completed',
      jobAnswerPayload: { private: 'must-not-be-returned' },
      jobAnswerData: { Items: [103, 8], Values: [215, 0] },
    },
  });
  const bodies = [];
  const local = await setup(context, { jobPollIntervalMs: 1, fetch: (url, init) => {
    if (new URL(url).pathname === '/deviceGetBufferReading') {
      bodies.push(JSON.parse(init.body));
    }
    return mock.fetch(url, init);
  } });
  assert.equal((await local.post(credentials, { Origin: 'https://attacker.example' }, '/buffer-one')).status, 403);
  assert.equal(mock.calls.length, 0);
  const response = await local.post({ ...credentials, bufferId: 131 }, {}, '/buffer-one');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(bodies, [{ id_device: 'private-device', id_product: 'private-product', BufferId: 1 }]);
  assert.equal(data.bufferId, 1);
  assert.equal(data.freshnessVerified, false);
  assert.ok(Number.isSafeInteger(data.receivedAt));
  assert.deepEqual(data.values, [{ offset: 103, value: 215 }, { offset: 8, value: 0 }]);
  assert.deepEqual(Object.keys(data).sort(), ['bufferId', 'freshnessVerified', 'receivedAt', 'values']);
  assert.equal(JSON.stringify(data).includes('must-not-be-returned'), false);
  assert.deepEqual(mock.calls, ['/appSignup', '/userLogin', '/deviceList',
    '/deviceGetBufferReading', '/deviceJobStatus/private-reading-job']);
  assert.deepEqual(await readdir(join(local.root, 'homebridge-nobis')), ['app-id']);
});

test('malformed raw data stays rejected alongside opaque payload without retry or fallback', async (context) => {
  const mock = mockedClient({
    '/deviceGetBufferReading': { Success: true, idRequest: 'job' },
    '/deviceJobStatus/job': {
      Success: true, jobAnswerStatus: 'completed',
      jobAnswerPayload: { private: 'secret' },
      jobAnswerData: { Items: [1], Values: ['private-value'] },
    },
  });
  const local = await setup(context, { fetch: mock.fetch, jobPollIntervalMs: 1 });
  const response = await local.post(credentials, {}, '/buffer-one');
  assert.equal(response.status, 502);
  const failure = await response.json();
  assert.match(failure.error, /invalid-values/);
  assert.deepEqual(failure.readingStructure, {
    dataType: 'object', payloadType: 'object', itemsType: 'array', valuesType: 'array',
    itemCount: 1, valueCount: 1,
  });
  assert.equal(JSON.stringify(failure).includes('secret'), false);
  assert.equal(mock.calls.filter(path => path === '/deviceGetBufferReading').length, 1);
});

test('raw page renders exact integers, clears credentials and old rows, and rejects invalid readings', async () => {
  let data = { bufferId: 1, freshnessVerified: false, receivedAt: 1_700_000_000_000,
    values: [{ offset: 103, value: 215 }, { offset: 8, value: -1 }] };
  let path;
  const page = pageHarness(async url => {
    path = url;
    return { ok: true, json: async () => data };
  });
  page.elements.operation.value = 'buffer-one';
  page.elements.operation.listeners.change();
  await page.submit();
  assert.equal(path, '/buffer-one');
  assert.equal(page.elements['raw-reading'].hidden, false);
  assert.equal(page.elements['raw-values'].children[0].children[1].textContent, '215');
  assert.equal(page.elements['raw-values'].children[1].children[1].textContent, '-1');
  assert.match(page.elements['raw-received'].textContent, /Fraicheur NON VERIFIEE/);
  assert.equal(page.elements.password.value, '');
  page.elements['clear-raw'].listeners.click();
  assert.equal(page.elements['raw-values'].children.length, 0);
  assert.equal(page.elements['raw-reading'].hidden, true);
  for (const invalid of [
    { ...data, bufferId: 131 }, { ...data, freshnessVerified: true },
    { ...data, values: [] }, { ...data, values: [{ offset: 0, value: 'secret' }] },
    { ...data, values: [{ offset: 1, value: 0 }, { offset: 1, value: 2 }] },
  ]) {
    data = invalid;
    page.elements.password.value = credentials.password;
    await page.submit();
    assert.equal(page.elements['raw-values'].children.length, 0);
    assert.equal(page.elements['raw-reading'].hidden, true);
    assert.match(page.elements.result.textContent, /Aucun succes confirme/);
  }
});

test('buffer index observation requires bounded consistent integers without assuming meanings', () => {
  for (const indexes of [[], [0, 3], [1, 2, 7, 9]]) {
    assert.deepEqual(observeBufferIndexes({ jobAnswerData: { BufferCnt: indexes.length, Indexes: indexes } }),
      { status: 'observed', bufferCount: indexes.length, indexes });
  }
  for (const data of [
    { BufferCnt: 2, Indexes: [1] }, { BufferCnt: 2, Indexes: [1, 1] },
    { BufferCnt: 1, Indexes: ['private-secret'] }, { BufferCnt: 1, Indexes: [-1] },
    { BufferCnt: 1, Indexes: [0.5] }, { BufferCnt: '1', Indexes: [1] },
    { BufferCnt: 1 }, { Indexes: [1] }, { BufferCnt: 0, Indexes: null },
    { BufferCnt: 257, Indexes: Array.from({ length: 257 }, (_, i) => i) },
  ]) {
    assert.deepEqual(observeBufferIndexes({ jobAnswerData: data }), { status: 'invalid' });
  }
  assert.deepEqual(observeBufferIndexes({ jobAnswerData: {} }), { status: 'absent' });
  assert.deepEqual(observeBufferIndexes({}), { status: 'absent' });
});

function mockedClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push(path);
      const body = init.body === undefined ? {} : JSON.parse(init.body);
      if (path === '/userLogin') {
        assert.equal(body.password, credentials.password);
      }
      const replies = {
        '/appSignup': { Success: true, id_app: body.id_app },
        '/userLogin': { Success: true, token: 'secret-token', refresh_token: 'secret-refresh' },
        '/deviceList': { Success: true, device: [{
          id_device: 'private-device', id_product: 'private-product', name: 'private-name', is_online: true,
        }] },
        '/deviceGetInfo': { Success: true, Value: true, device_info: [{ id_registers_map: 'private-map' }] },
        '/deviceGetRegistersMap': { Success: true, device_registers_map: { registers_map: [{
          id: 'private-map', registers: [{ reg_key: 'fictional', reg_type: 'GET', offset: 1, mask: 255, formula: '#' }],
        }] } },
        ...overrides,
      };
      assert.ok(path in replies);
      return new globalThis.Response(JSON.stringify(replies[path]), { status: path === '/appSignup' ? 201 : 200 });
    },
  };
}

test('browser is offline until authorized POST, serves protected local assets without storage', async (context) => {
  const local = await setup(context, { fetch: async () => assert.fail('No cloud request') });
  const page = await globalThis.fetch(local.browser.url);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /type="password"/);
  assert.deepEqual(await readdir(local.root), []);
  const remoteStatus = await new Promise((resolve, reject) => {
    const call = request(local.browser.url, { headers: { Host: 'attacker.example' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    call.once('error', reject);
    call.end();
  });
  assert.equal(remoteStatus, 403);
  assert.equal((await local.post(credentials, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await local.post(credentials, { 'X-Nobis-Token': 'invalid' })).status, 403);
  assert.equal((await globalThis.fetch(`${local.browser.url}/discover`, { method: 'POST' })).status, 403);
  assert.deepEqual(await readdir(local.root), []);
});

test('invalid JSON, oversized bodies and invalid credentials are rejected before cloud access', async (context) => {
  const local = await setup(context, { fetch: async () => assert.fail('No cloud request') });
  assert.equal((await local.post({ ...credentials, password: ' ' })).status, 400);
  assert.equal((await local.post({ ...credentials, email: 'invalid' })).status, 400);
  assert.equal((await local.post(credentials, { 'Content-Type': 'text/plain' })).status, 415);
  const invalid = await globalThis.fetch(`${local.browser.url}/discover`, {
    method: 'POST', headers: local.headers, body: '{private-malformed',
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.text()).includes('private-malformed'), false);
  assert.equal((await local.post({ ...credentials, password: 'x'.repeat(17_000) })).status, 413);
  assert.deepEqual(await readdir(local.root), []);
});

test('authorized discovery returns validated definitions without identifiers and persists no credentials or reports', async (context) => {
  const mock = mockedClient();
  const local = await setup(context, { fetch: mock.fetch });
  const response = await local.post(credentials);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data, { deviceCount: 1, registerCount: 1, registers: [
    { reg_key: 'fictional', reg_type: 'GET', offset: 1, mask: 255, formula: '#' },
  ] });
  for (const secret of [credentials.email, credentials.password, 'secret-token', 'secret-refresh',
    'private-device', 'private-product', 'private-name', 'private-map']) {
    assert.equal(JSON.stringify(data).includes(secret), false);
  }
  assert.deepEqual(mock.calls, ['/appSignup', '/userLogin', '/deviceList', '/deviceGetInfo', '/deviceGetRegistersMap']);
  assert.deepEqual(await readdir(local.root), ['homebridge-nobis']);
  assert.deepEqual(await readdir(join(local.root, 'homebridge-nobis')), ['app-id']);
});

test('inspection preserves optional metadata, false flags and fractional enumerations without interpretation', async (context) => {
  const register = {
    reg_key: 'fictional-definition', reg_type: 'UNVERIFIED', offset: 7, mask: 65535,
    formula: '# / 10', formula_inverse: '# * 10', readonly: false,
    set_min: 0.5, set_max: 9.5, step: 0.5,
    is_word: true, big_endian: false, with_sign: true,
    enc_val: [{ value: 0.5, lang: 'en', description: '<script>not executable</script>' }],
  };
  const mock = mockedClient({
    '/deviceGetRegistersMap': { Success: true, device_registers_map: {
      registers_map: [{ id: 'private-map', registers: [register] }],
    } },
  });
  const local = await setup(context, { fetch: mock.fetch });
  const response = await local.post(credentials);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).registers, [register]);
  assert.equal(mock.calls.some(path => path.includes('Buffer')), false);
});

function pageHarness(fetcher) {
  const element = (tag = '') => ({
    tag, value: '', textContent: '', hidden: false, disabled: false, children: [], listeners: {},
    addEventListener(event, handler) { this.listeners[event] = handler; },
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
  });
  const ids = ['test', 'connect', 'result', 'inspection', 'filter', 'registers',
    'register-count', 'clear', 'email', 'password', 'device', 'operation',
    'configuration', 'configuration-shape', 'clear-configuration', 'nack-code', 'buffer-indexes',
    'raw-reading', 'raw-values', 'raw-received', 'clear-raw',
    'temperature', 'temperature-value', 'temperature-received', 'clear-temperature',
    'setpoint-controls', 'setpoint-target', 'setpoint-confirm', 'setpoint-result', 'setpoint-values', 'clear-setpoint',
    'setpoint-reading', 'setpoint-reading-value', 'clear-setpoint-reading',
    'status-reading', 'status-reading-value', 'clear-status-reading',
    'settings-reading', 'settings-reading-value', 'clear-settings-reading',
    'power-controls', 'power-action', 'power-confirm', 'power-result', 'power-values', 'clear-power',
    'ventilation-controls', 'ventilation-target', 'ventilation-confirm', 'ventilation-result', 'ventilation-values', 'clear-ventilation',
    'auto-controls', 'auto-target', 'auto-confirm',
    'reading-failure', 'reading-structure', 'clear-failure'];
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  elements.email.value = credentials.email;
  elements.password.value = credentials.password;
  runInNewContext(diagnosticScript('fictional-token'), {
    document: { getElementById: id => elements[id], createElement: element },
    fetch: fetcher, AbortSignal: globalThis.AbortSignal,
  });
  return { elements, submit: () => elements.test.listeners.submit({ preventDefault() {} }) };
}

test('page renders definitions as text, filters locally and clears all stored rows', async () => {
  let calls = 0;
  const register = {
    reg_key: '<img src=x onerror=alert(1)>', reg_type: 'GET', offset: 1, mask: 255, formula: '#',
    enc_val: [{ value: 0.5, lang: 'en', description: 'fictional label' }],
  };
  const page = pageHarness(async () => {
    calls++;
    return { ok: true, json: async () => ({ deviceCount: 1, registerCount: 1, registers: [register] }) };
  });
  await page.submit();
  const { elements } = page;
  assert.equal(elements.password.value, '');
  assert.equal(elements.inspection.hidden, false);
  assert.equal(elements.registers.children[0].children[0].textContent, register.reg_key);
  const details = elements.registers.children[0].children[5].children[0];
  assert.deepEqual(JSON.parse(details.children[1].textContent), register);
  elements.filter.value = 'fictional label';
  elements.filter.listeners.input();
  assert.equal(elements.registers.children.length, 1);
  elements.filter.value = 'no match';
  elements.filter.listeners.input();
  assert.equal(elements.registers.children.length, 0);
  assert.equal(elements['register-count'].textContent, '0 / 1 definitions affichees');
  assert.equal(calls, 1);
  elements.clear.listeners.click();
  assert.equal(elements.inspection.hidden, true);
  elements.filter.value = '';
  elements.filter.listeners.input();
  assert.equal(elements.registers.children.length, 0);
});

test('configuration inspection returns only structure and the explicitly allowed numeric code', async (context) => {
  const mock = mockedClient({
    '/deviceGetConfigBuffer': { Success: true, idRequest: 'fictional-config-job' },
    '/deviceJobStatus/fictional-config-job': {
      Success: true, jobAnswerStatus: 'completed',
      jobAnswerPayload: { fictional_config: [{ BufferId: 7, Items: [103], Protocol: 'unverified' }],
        security_code: 'private-code', token: 'private-token' },
      jobAnswerData: { NackErrCode: 42, Cmd: 'private-command', cmd: 'private-other-command' },
    },
  });

  const local = await setup(context, { fetch: mock.fetch });
  const response = await local.post(credentials, {}, '/buffer-configuration');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.configurationValidated, false);
  assert.deepEqual(data.nack, { status: 'observed', value: 42 });
  assert.ok(data.shape.fields.some(field => field.path.endsWith('.BufferId') && field.type === 'number'));
  for (const secret of ['private-code', 'private-token', 'unverified', 'fictional-config-job',
    'private-command', 'private-other-command', credentials.email]) {
    assert.equal(JSON.stringify(data).includes(secret), false);
  }
  assert.deepEqual(mock.calls, ['/appSignup', '/userLogin', '/deviceList',
    '/deviceGetConfigBuffer', '/deviceJobStatus/fictional-config-job']);
  assert.deepEqual(await readdir(join(local.root, 'homebridge-nobis')), ['app-id']);
  assert.equal((await local.post(credentials, { Origin: 'https://attacker.example' }, '/buffer-configuration')).status, 403);
});

test('buffer ID route inspects metadata only, keeps values private and requires local authorization', async (context) => {
    const mock = mockedClient({
      '/devicegetBufferId': { Success: true, idRequest: 'private-buffer-id-job' },
      '/deviceJobStatus/private-buffer-id-job': {
        Success: true, jobAnswerStatus: 'completed',
        jobAnswerData: { fictionalBufferIdentifier: 12345, NackErrCode: 0, BufferCnt: 2, Indexes: [0, 3] },
      },
    });
    const local = await setup(context, { fetch: mock.fetch });
    assert.equal((await local.post(credentials, { 'X-Nobis-Token': 'wrong' }, '/buffer-id')).status, 403);
    assert.equal(mock.calls.length, 0);
    const response = await local.post(credentials, {}, '/buffer-id');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.configurationValidated, false);
    assert.deepEqual(data.nack, { status: 'observed', value: 0 });
    assert.deepEqual(data.bufferIndexes, { status: 'observed', bufferCount: 2, indexes: [0, 3] });
    assert.ok(data.shape.fields.some(field => field.path.endsWith('.fictionalBufferIdentifier')));
    assert.equal(JSON.stringify(data).includes('12345'), false);
    assert.equal(JSON.stringify(data).includes('private-buffer-id-job'), false);
    assert.deepEqual(mock.calls, ['/appSignup', '/userLogin', '/deviceList',
      '/devicegetBufferId', '/deviceJobStatus/private-buffer-id-job']);
  });

test('buffer ID page selects its dedicated route without automatically reading a buffer', async () => {
    let requested;
    const page = pageHarness(async path => {
      requested = path;
      return { ok: true, json: async () => ({
        configurationValidated: false, nack: { status: 'absent' },
        bufferIndexes: { status: 'observed', bufferCount: 2, indexes: [0, 3] },
        shape: { fields: [{ path: '$.jobAnswerData', type: 'object' }], truncated: false },
      }) };
    });
    page.elements.operation.value = 'buffer-id';
    page.elements.operation.listeners.change();
    assert.match(page.elements.connect.textContent, /identifiant de buffer/);
    await page.submit();
    assert.equal(requested, '/buffer-id');
    assert.match(page.elements.result.textContent, /aucun buffer choisi ou lu/);
    assert.equal(page.elements.password.value, '');
    assert.match(page.elements['buffer-indexes'].textContent, /Indexes observes : \[0,3\]/);
    assert.match(page.elements['buffer-indexes'].textContent, /aucun index selectionne/);
    page.elements['clear-configuration'].listeners.click();
    assert.equal(page.elements['buffer-indexes'].textContent, '');
  });

test('response structure inspection is bounded and never recursively parses string payloads', () => {
  const shape = describeResponseShape({
    jobAnswerPayload: '{"password":"private-secret","BufferId":1}',
    id_device: 'secret-device',
    nested: { token: { secret: 'hidden' }, fields: Array.from({ length: 10 }, () => ({ value: 42 })) },
    'private@example.invalid': 'hidden',
  });
  assert.ok(shape.fields.some(field => field.path === '$.jobAnswerPayload' && field.type === 'string'));
  assert.equal(JSON.stringify(shape).includes('private-secret'), false);
  assert.equal(JSON.stringify(shape).includes('id_device'), false);
  assert.equal(JSON.stringify(shape).includes('token'), false);
  assert.equal(shape.truncated, true);
  const large = describeResponseShape(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`field_${i}`, i])));
  assert.equal(large.fields.length, 200);
  assert.equal(large.truncated, true);
});

test('configuration page explicitly marks completed metadata unvalidated and supports clearing', async () => {
  let requested;
  const page = pageHarness(async (path) => {
    requested = path;
    return { ok: true, json: async () => ({
      configurationValidated: false,
      nack: { status: 'observed', value: 0 },
      shape: { fields: [{ path: '$.jobAnswerPayload', type: 'string' }], truncated: false },
    }) };
  });
  page.elements.operation.value = 'configuration';
  await page.submit();
  assert.equal(requested, '/buffer-configuration');
  assert.match(page.elements.result.textContent, /Configuration non validee/);
  assert.equal(page.elements.configuration.hidden, false);
  assert.match(page.elements['nack-code'].textContent, /observe : 0/);
  assert.match(page.elements['nack-code'].textContent, /meme 0 ne confirme pas/);
  assert.equal(page.elements['configuration-shape'].textContent, '$.jobAnswerPayload : string');
  assert.equal(page.elements.password.value, '');
  assert.equal(page.elements.operation.disabled, false);
  page.elements['clear-configuration'].listeners.click();
  assert.equal(page.elements.configuration.hidden, true);
  assert.equal(page.elements['configuration-shape'].textContent, '');
  assert.equal(page.elements['nack-code'].textContent, '');
});

test('numeric code extraction distinguishes absent, malformed and observed codes without string conversion', () => {
  for (const value of [0, 42, -1, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(observeNackCode({ jobAnswerData: { NackErrCode: value } }),
      { status: 'observed', value });
  }
  for (const value of ['private-secret', '0', null, true, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1, {}]) {
    assert.deepEqual(observeNackCode({ jobAnswerData: { NackErrCode: value } }), { status: 'invalid' });
  }
  for (const data of [undefined, null, [], 'opaque', {}]) {
    assert.deepEqual(observeNackCode({ jobAnswerData: data }), { status: 'absent' });
  }
});

test('unavailable configuration jobs display the exact known status without retrying the command', async (context) => {
  for (const state of ['terminated', 'Missing job', 'Missing job answer']) {
    const mock = mockedClient({
      '/deviceGetConfigBuffer': { Success: true, idRequest: 'private-job' },
      '/deviceJobStatus/private-job': { Success: true, jobAnswerStatus: state },
    });
    const local = await setup(context, { fetch: mock.fetch });
    const response = await local.post(credentials, {}, '/buffer-configuration');
    assert.equal(response.status, 502);
    const error = (await response.json()).error;
    assert.ok(error.includes(`[job status: ${state}]`));
    assert.match(error, /aucun nouvel essai automatique/);
    assert.equal(error.includes('private-job'), false);
    assert.equal(mock.calls.filter(path => path === '/deviceGetConfigBuffer').length, 1);
    assert.equal(mock.calls.filter(path => path === '/deviceJobStatus/private-job').length, 1);
  }
});

test('page removes previous definitions on retry or malformed success and never claims success for invalid data', async () => {
  let data = { deviceCount: 1, registerCount: 1, registers: [
    { reg_key: 'fictional', reg_type: 'GET', offset: 1, mask: 255, formula: '#' },
  ] };
  const page = pageHarness(async () => ({ ok: true, json: async () => data }));
  await page.submit();
  data = { deviceCount: 1, registerCount: 2, registers: [] };
  page.elements.password.value = credentials.password;
  await page.submit();
  assert.equal(page.elements.inspection.hidden, true);
  assert.equal(page.elements.registers.children.length, 0);
  assert.match(page.elements.result.textContent, /Aucun succes confirme/);
  assert.equal(page.elements.password.value, '');
  assert.equal(page.elements.connect.disabled, false);
});

test('ambiguous device selection stops before map requests', async (context) => {
  const mock = mockedClient({ '/deviceList': { Success: true, device: [] } });
  const local = await setup(context, { fetch: mock.fetch });
  const response = await local.post(credentials);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Selection impossible/);
  assert.equal(mock.calls.includes('/deviceGetInfo'), false);
});

test('offline devices fail explicitly without reading a register map', async (context) => {
  const mock = mockedClient({ '/deviceList': { Success: true, device: [{
    id_device: 'private-device', id_product: 'private-product', name: 'private-name', is_online: false,
  }] } });
  const local = await setup(context, { fetch: mock.fetch });
  const response = await local.post(credentials);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /hors ligne/);
  assert.equal(mock.calls.includes('/deviceGetInfo'), false);
});

test('HTTP authentication errors do not expose credentials or server response text', async (context) => {
  const local = await setup(context, {
    fetch: async () => new globalThis.Response('private-server-secret', { status: 401 }),
  });
  const response = await local.post(credentials);
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.match(text, /HTTP 401/);
  for (const secret of [credentials.email, credentials.password, 'private-server-secret']) {
    assert.equal(text.includes(secret), false);
  }
});

test('concurrent tests are refused and session deadline closes pending cloud requests without leaking errors', async (context) => {
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const local = await setup(context, {
    fetch: async (_url, init) => {
      entered();
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('private network secret')), { once: true });
      });
    },
  }, { sessionTimeoutMs: 150 });
  const first = local.post(credentials);
  await started;
  assert.equal((await local.post(credentials)).status, 409);
  const response = await first;
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.match(text, /timeout/);
  assert.equal(text.includes('private network secret'), false);
});

test('shutdown aborts an active cloud request and repeated closure is safe', async (context) => {
  let entered;
  let cancelled = false;
  const started = new Promise((resolve) => { entered = resolve; });
  const local = await setup(context, {
    fetch: async (_url, init) => {
      entered();
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          cancelled = true;
          reject(new Error('private cancellation'));
        }, { once: true });
      });
    },
  });
  const pending = local.post(credentials);
  const failure = assert.rejects(pending);
  await started;
  await local.browser.close();
  await failure;
  await local.browser.close();
  assert.equal(cancelled, true);
});

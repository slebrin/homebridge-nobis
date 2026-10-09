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

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { ReadableStream } from 'node:stream/web';
import { setTimeout as delay } from 'node:timers/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { URL } from 'node:url';

import { AguaClient } from '../dist/agua/client.js';
import { AguaError } from '../dist/agua/errors.js';
import { devices, jobReading, registers } from '../dist/agua/models.js';
import { AguaTransport } from '../dist/agua/transport.js';

const appId = '12345678-1234-4123-8123-123456789abc';
const { Response, AbortSignal } = globalThis;
const credentials = { email: 'reader@example.invalid', password: ' fictitious password ', appId };
const device = { id_device: 'fictional-device', id_product: 'fictional-product' };

test('reading errors expose only fixed structural observations while preserving strict rejection', () => {
  for (const [data, payload, reason] of [
    [undefined, { secret: 'private' }, 'unsupported-envelope'],
    [{ Items: [1], Values: ['private'] }, { secret: 'private' }, 'invalid-values'],
    [{ Items: [1, 2], Values: [42] }, undefined, 'invalid-values'],
    [{ Items: 'private', Values: [42] }, undefined, 'invalid-values'],
    [{ Items: [1], Values: ['private'] }, undefined, 'invalid-values'],
  ]) {
    assert.throws(() => jobReading({
      jobAnswerStatus: 'completed', jobAnswerData: data,
      ...(payload === undefined ? {} : { jobAnswerPayload: payload }),
    }, Date.now()), error => {
      assert.equal(error.kind, 'protocol');
      assert.equal(error.reason, reason);
      assert.equal(JSON.stringify(error.readingStructure).includes('private'), false);
      assert.ok(error.readingStructure.dataType);
      return true;
    });

  }
});

test('observed coexistence of data and opaque payload does not block strictly validated 76-value readings', () => {
  const items = Array.from({ length: 76 }, (_, index) => index);
  const values = items.map(index => index - 10);
  const response = {
    jobAnswerStatus: 'completed',
    jobAnswerData: { Items: items, Values: values },
    jobAnswerPayload: { private: 'not interpreted', Items: [999], Values: [999] },
  };
  const result = jobReading(response, 123);
  assert.deepEqual([...result.values], items.map((offset, index) => [offset, values[index]]));
  assert.equal(result.receivedAt, 123);
  assert.equal(result.values.has(999), false);
  for (const data of [
    { Items: [1, 1], Values: [2, 3] }, { Items: [-1], Values: [2] },
    { Items: [1], Values: [0.5] }, { Items: [1], Values: [] },
  ]) {
    assert.throws(() => jobReading({ ...response, jobAnswerData: data }, 123),
      error => error.kind === 'protocol' && error.reason === 'invalid-values');
  }
});

test('first job poll waits the full configured interval inside the existing deadline', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { client, calls } = mockClient(call => reply(call.path === '/devicegetBufferId'
    ? { Success: true, idRequest: 'job' }
    : { Success: true, jobAnswerStatus: 'completed', jobAnswerData: {} }));
  context.after(() => client.close());
  const pending = client.inspectConfiguredBufferId(device);
  await setImmediate();
  assert.equal(calls.filter(call => call.path === '/devicegetBufferId').length, 1);
  assert.equal(calls.some(call => call.path.startsWith('/deviceJobStatus/')), false);
  context.mock.timers.tick(999);
  await setImmediate();
  assert.equal(calls.some(call => call.path.startsWith('/deviceJobStatus/')), false);
  context.mock.timers.tick(1);
  await pending;
  assert.equal(calls.filter(call => call.path.startsWith('/deviceJobStatus/')).length, 1);
});

test('closing during the initial job wait prevents the first poll', async (context) => {
  const { client, calls } = mockClient(() => reply({ Success: true, idRequest: 'job' }));
  context.after(() => client.close());
  const pending = client.inspectConfiguredBufferId(device);
  const rejected = assert.rejects(pending, expectKind('closed'));
  await setImmediate();
  client.close();
  await rejected;
  assert.equal(calls.some(call => call.path.startsWith('/deviceJobStatus/')), false);
});
const deviceList = { Success: true, device: [{ ...device, name: 'Fictional stove', is_online: true }] };
const info = { Success: true, Value: true, device_info: [{ id_registers_map: 'fictional-map' }] };
const map = {
  Success: true,
  device_registers_map: {
    registers_map: [{
      id: 'fictional-map',
      registers: [{ reg_key: 'fictional_get', reg_type: 'GET', offset: 1, mask: 65535, formula: '#/10', readonly: true }],
    }],
  },
};
const reading = { Success: true, jobAnswerStatus: 'completed', jobAnswerData: { Items: [1, 2], Values: [215, 0] } };

function jwt(exp) {
  return `e30.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.fictional`;
}

function reply(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function mockClient(handler = () => reply(deviceList), options = {}, login = { token: 'opaque-test-token', refresh_token: 'opaque-refresh' }) {
  const calls = [];
  const fetch = async (url, init) => {
    const path = new URL(url).pathname;
    const call = { path, url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) };
    calls.push(call);
    if (path === '/appSignup') {
      return reply({ Success: true, id_app: appId }, 201);
    }
    if (path === '/userLogin') {
      return reply({ Success: true, ...login });
    }
    return handler(call, calls);
  };
  const client = new AguaClient(credentials, { ...options, fetch });
  return { client, calls };
}

function expectKind(kind) {
  return (error) => {
    assert.ok(error instanceof AguaError);
    assert.equal(error.kind, kind);
    return true;
  };
}

test('configuration job preserves unknown structure without treating it as buffer values; shared and read-only', async (context) => {
  let polls = 0;
  const completed = { Success: true, jobAnswerStatus: 'completed', jobAnswerPayload: { fictional: 'opaque' } };
  const { client, calls } = mockClient(call => {
    if (call.path === '/deviceGetConfigBuffer') {
      assert.deepEqual(call.body, device);
      return reply({ Success: true, idRequest: 'configuration-job' });
    }
    assert.equal(call.path, '/deviceJobStatus/configuration-job');
    assert.equal(call.init.method, 'GET');
    assert.equal(call.body, undefined);
    return reply(++polls === 1 ? { Success: true, jobAnswerStatus: 'waiting' } : completed);
  }, { jobPollIntervalMs: 1 });
  context.after(() => client.close());
  const [first, second] = await Promise.all([
    client.inspectBufferConfiguration(device), client.inspectBufferConfiguration(device),
  ]);
  assert.deepEqual(first, completed);
  assert.equal(first, second);
  assert.equal(calls.filter(call => call.path === '/deviceGetConfigBuffer').length, 1);
});

test('configuration jobs reject unknown, missing and terminated statuses and invalid job IDs', async (context) => {
  for (const state of ['unexpected', 'terminated', 'Missing job', 'Missing job answer']) {
    const { client } = mockClient(call => reply(call.path === '/deviceGetConfigBuffer'
      ? { Success: true, idRequest: 'job' } : { Success: true, jobAnswerStatus: state }));
    context.after(() => client.close());
    await assert.rejects(client.inspectBufferConfiguration(device),
      error => {
        expectKind(state === 'unexpected' ? 'protocol' : 'unavailable')(error);
        if (state !== 'unexpected') {
          assert.equal(error.jobStatus, state);
          assert.ok(error.message.includes(`[job status: ${state}]`));
        } else {
          assert.equal(error.message.includes(state), false);
        }
        return true;
      });
  }
  const { client } = mockClient(() => reply({ Success: true, idRequest: '../private' }));
  context.after(() => client.close());
  await assert.rejects(client.inspectBufferConfiguration(device), expectKind('protocol'));
});

test('configuration job budget stops waiting without selecting or reading a buffer', async (context) => {
  const { client, calls } = mockClient(call => reply(call.path === '/deviceGetConfigBuffer'
    ? { Success: true, idRequest: 'job' } : { Success: true, jobAnswerStatus: 'waiting' }),
  { jobTimeoutMs: 20, jobPollIntervalMs: 1 });
  context.after(() => client.close());
  await assert.rejects(client.inspectBufferConfiguration(device), expectKind('job-timeout'));
  assert.equal(calls.some(call => call.path === '/deviceGetBufferReading'), false);
});

test('buffer ID inspection uses the exact documented path, shares jobs and keeps the result uninterpreted', async (context) => {
  const completed = { Success: true, jobAnswerStatus: 'completed',
    jobAnswerData: { fictionalBufferIdentifier: 7 } };
  const { client, calls } = mockClient(call => {
    if (call.path === '/devicegetBufferId') {
      assert.deepEqual(call.body, device);
      return reply({ Success: true, idRequest: 'buffer-id-job' });
    }
    assert.equal(call.path, '/deviceJobStatus/buffer-id-job');
    return reply(completed);
  });
  context.after(() => client.close());
  const [first, second] = await Promise.all([
    client.inspectConfiguredBufferId(device), client.inspectConfiguredBufferId(device),
  ]);
  assert.deepEqual(first, completed);
  assert.equal(first, second);
  assert.equal(calls.filter(call => call.path === '/devicegetBufferId').length, 1);
  assert.equal(calls.some(call => call.path === '/deviceGetBufferReading'), false);
});

test('buffer ID jobs stop on missing answers, unknown statuses and timeout', async (context) => {
  for (const state of ['Missing job answer', 'unexpected', 'waiting']) {
    const { client } = mockClient(call => reply(call.path === '/devicegetBufferId'
      ? { Success: true, idRequest: 'job' } : { Success: true, jobAnswerStatus: state }),
    { jobTimeoutMs: 20, jobPollIntervalMs: 1 });
    context.after(() => client.close());
    await assert.rejects(client.inspectConfiguredBufferId(device),
      expectKind(state === 'waiting' ? 'job-timeout' : state === 'unexpected' ? 'protocol' : 'unavailable'));
  }
});

test('authentication and discovery preserve the exact documented request contract', async (context) => {
  const { client, calls } = mockClient();
  context.after(() => client.close());
  assert.deepEqual(await client.getDevices(), deviceList.device);
  assert.deepEqual(calls.map((call) => call.path), ['/appSignup', '/userLogin', '/deviceList']);
  for (const call of calls) {
    assert.equal(call.url.startsWith('https://nobis.agua-iot.com/'), true);
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.headers.customer_code, '700700');
    assert.equal(call.init.headers.id_brand, '1');
    assert.equal(call.init.headers['Content-Type'], 'application/json');
    assert.ok(call.init.signal instanceof AbortSignal);
  }
  assert.equal(calls[0].body.push_notification_active, false);
  assert.equal(calls[0].body.phone_id, appId);
  assert.equal(calls[1].init.headers.Authorization, appId);
  assert.equal(calls[1].init.headers.local, 'true');
  assert.equal(calls[1].body.password, credentials.password);
  assert.equal(calls[2].init.headers.Authorization, 'opaque-test-token');
  assert.equal(calls[2].init.headers.local, 'false');
  assert.deepEqual(calls[2].body, {});
});

test('accepts the Swagger refreshToken spelling without inventing another field', async (context) => {
  const { client } = mockClient(undefined, {}, { token: 'opaque-token', refreshToken: 'opaque-refresh' });
  context.after(() => client.close());
  assert.equal((await client.getDevices()).length, 1);
});

test('conflicting refresh token spellings fail explicitly', async (context) => {
  const { client } = mockClient(undefined, {}, { token: 'opaque-token', refreshToken: 'one', refresh_token: 'two' });
  context.after(() => client.close());
  await assert.rejects(client.getDevices(), expectKind('protocol'));
});

test('missing tokens and Success are rejected', async () => {
  for (const login of [
    {}, { token: 'token' }, { token: '', refresh_token: 'refresh' },
    { token: 'token', refresh_token: null, refreshToken: 'other' },
  ]) {
    const { client } = mockClient(undefined, {}, login);
    try {
      await assert.rejects(client.getDevices(), expectKind('protocol'));
    } finally {
      client.close();
    }
  }
  const transport = new AguaTransport({ fetch: async () => reply({ token: 'secret' }) });
  try {
    await assert.rejects(transport.request('/userLogin'), expectKind('protocol'));
  } finally {
    transport.close();
  }
});

test('concurrent identical reads and authentication are single-flight', async (context) => {
  const { client, calls } = mockClient(async () => {
    await delay(5);
    return reply(deviceList);
  });
  context.after(() => client.close());
  const results = await Promise.all(Array.from({ length: 10 }, () => client.getDevices()));
  assert.equal(results.length, 10);
  assert.equal(calls.length, 3);
});

test('reads the selected register map, not the first map returned', async (context) => {
  const { client, calls } = mockClient(({ path }) => {
    if (path === '/deviceGetInfo') {
      return reply(info);
    }
    return reply({
      ...map,
      device_registers_map: { registers_map: [{ id: 'wrong-map', registers: [] }, ...map.device_registers_map.registers_map] },
    });
  });
  context.after(() => client.close());
  const results = await Promise.all([client.getRegisterMap(device), client.getRegisterMap(device)]);
  assert.equal(results[0].id, 'fictional-map');
  assert.equal(results[0].registers[0].formula, '#/10');
  assert.equal(calls.filter((call) => call.path === '/deviceGetRegistersMap').length, 1);
  assert.deepEqual(calls.at(-1).body, device);
});

test('register map absence, mismatch and multiple device_info entries are not silently accepted', async () => {
  for (const [responseInfo, responseMap, kind] of [
    [{ Success: true, Value: false, device_info: null }, map, 'unavailable'],
    [info, { Success: true, device_registers_map: null }, 'unavailable'],
    [info, { Success: true, device_registers_map: { registers_map: [] } }, 'protocol'],
    [{ ...info, device_info: [...info.device_info, ...info.device_info] }, map, 'protocol'],
  ]) {
    const { client } = mockClient(({ path }) => reply(path === '/deviceGetInfo' ? responseInfo : responseMap));
    try {
      await assert.rejects(client.getRegisterMap(device), expectKind(kind));
    } finally {
      client.close();
    }
  }
});

test('completed buffer reading remains raw, with reception time and no synthetic thermal state', async (context) => {
  let polls = 0;
  const { client, calls } = mockClient(({ path }) => {
    if (path === '/deviceGetBufferReading') {
      return reply({ Success: true, idRequest: 'fictional-job' });
    }
    return reply(++polls === 1 ? { Success: true, jobAnswerStatus: 'waiting' } : reading);
  }, { jobPollIntervalMs: 1 });
  context.after(() => client.close());
  const before = Date.now();
  const [result] = await Promise.all([client.readBuffer(device), client.readBuffer(device)]);
  assert.deepEqual([...result.values], [[1, 215], [2, 0]]);
  assert.ok(result.receivedAt >= before);
  assert.equal('temperature' in result, false);
  const bufferCalls = calls.filter((call) => call.path === '/deviceGetBufferReading');
  assert.equal(bufferCalls.length, 1);
  assert.deepEqual(bufferCalls[0].body, device);
  for (const call of calls.filter((call) => call.path.startsWith('/deviceJobStatus/'))) {
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.body, undefined);
  }
});

test('explicit buffer ID is validated and sent, never defaults silently to community buffer 1', async (context) => {
  const { client, calls } = mockClient(({ path }) => reply(
    path === '/deviceGetBufferReading' ? { Success: true, idRequest: 'job' } : reading,
  ));
  context.after(() => client.close());
  await client.readBuffer(device, 1);
  assert.equal(calls.find((call) => call.path === '/deviceGetBufferReading').body.BufferId, 1);
  await assert.rejects(client.readBuffer(device, -1), AguaError);
});

test('Swagger jobAnswerPayload is blocked because its structure is unspecified', () => {
  assert.throws(() => jobReading({
    jobAnswerStatus: 'completed', jobAnswerPayload: { Items: [1], Values: [42] },
  }, Date.now()), expectKind('protocol'));
});

test('unknown states, missing jobs and inconsistent raw arrays do not become success', () => {
  for (const state of ['unknown', 'terminated', 'Missing job', 'Missing job answer']) {
    assert.throws(() => jobReading({ jobAnswerStatus: state }, Date.now()), AguaError);
  }
  for (const data of [
    { Items: [1], Values: [] }, { Items: [1, 1], Values: [1, 2] },
    { Items: [-1], Values: [1] }, { Items: [1], Values: ['42'] },
    { Items: [1], Values: [NaN] }, { Items: [], Values: [] },
  ]) {
    assert.throws(() => jobReading({ jobAnswerStatus: 'completed', jobAnswerData: data }, Date.now()), expectKind('protocol'));
  }
});

test('401 refreshes once then replays the read with the new token', async (context) => {
  const { client, calls } = mockClient(({ path, init }) => {
    if (path === '/refreshToken') {
      return reply({ Success: true, token: 'renewed-token' }, 201);
    }
    return init.headers.Authorization === 'renewed-token'
      ? reply(deviceList) : reply({ Success: false, Error: '1106' }, 401);
  });
  context.after(() => client.close());
  await client.getDevices();
  assert.equal(calls.filter((call) => call.path === '/refreshToken').length, 1);
  assert.deepEqual(calls.find((call) => call.path === '/refreshToken').body, { refresh_token: 'opaque-refresh' });
  assert.equal(calls.at(-1).init.headers.Authorization, 'renewed-token');
});

test('repeated 401 is bounded, not recursively retried', async (context) => {
  const { client, calls } = mockClient(({ path }) => path === '/refreshToken'
    ? reply({ Success: true, token: 'renewed-token' }, 201) : reply({ Success: false, Error: '1106' }, 401));
  context.after(() => client.close());
  await assert.rejects(client.getDevices(), (error) => error.status === 401);
  assert.equal(calls.filter((call) => call.path === '/deviceList').length, 2);
});

test('distinct concurrent operations share one refresh after simultaneous 401 responses', async (context) => {
  const { client, calls } = mockClient(async ({ path, init }) => {
    if (path === '/refreshToken') {
      await delay(5);
      return reply({ Success: true, token: 'renewed-token' }, 201);
    }
    if (init.headers.Authorization !== 'renewed-token') {
      return reply({ Success: false, Error: '1106' }, 401);
    }
    return reply(path === '/deviceList' ? deviceList : path === '/deviceGetInfo' ? info : map);
  });
  context.after(() => client.close());
  await Promise.all([client.getDevices(), client.getRegisterMap(device)]);
  assert.equal(calls.filter((call) => call.path === '/userLogin').length, 1);
  assert.equal(calls.filter((call) => call.path === '/refreshToken').length, 1);
});

test('device schema errors and invalid register metadata are rejected', () => {
  for (const entry of [
    { ...deviceList.device[0], is_online: 1 },
    { ...deviceList.device[0], deleted: 'false' },
    { ...deviceList.device[0], id_device: 1 },
  ]) {
    assert.throws(() => devices({ device: [entry] }), expectKind('protocol'));
  }
  for (const patch of [{ offset: -1 }, { mask: -1 }, { formula: 1 }, { step: '1' }, { enc_val: [{ value: NaN }] }]) {
    const data = {
      device_registers_map: { registers_map: [{
        id: 'fictional-map', registers: [{ ...map.device_registers_map.registers_map[0].registers[0], ...patch }],
      }] },
    };
    assert.throws(() => registers(data, 'fictional-map'), expectKind('protocol'));
  }
});

test('register metadata preserves fractions and encoding without interpreting state or formulas', () => {
  const metadata = {
    ...map.device_registers_map.registers_map[0].registers[0],
    set_min: 10, set_max: 30, step: 0.5, formula_inverse: '#*10',
    is_word: true, big_endian: false, with_sign: true,
    enc_val: [{ value: 0.64, lang: 'ENG', description: 'Fictional encoding' }],
  };
  const result = registers({
    device_registers_map: { registers_map: [{ id: 'fictional-map', registers: [metadata] }] },
  }, 'fictional-map');
  assert.deepEqual(result.registers[0], metadata);
  assert.equal(result.registers[0].enc_val[0].value, 0.64);
});

test('exp triggers renewal; opaque refresh tokens are preserved', async (context) => {
  const { client, calls } = mockClient(({ path }) => path === '/refreshToken'
    ? reply({ Success: true, token: jwt(Date.now() / 1000 + 3600) }, 201) : reply(deviceList),
  {}, { token: jwt(1), refresh_token: 'opaque-refresh' });
  context.after(() => client.close());
  await client.getDevices();
  await client.getDevices();
  assert.equal(calls.filter((call) => call.path === '/refreshToken').length, 1);
});

test('refused refresh falls back to one login; server failure does not cause a login storm', async () => {
  for (const status of [401, 500]) {
    const { client, calls } = mockClient(({ path }) => path === '/refreshToken'
      ? reply({ Success: false }, status) : reply({ Success: false }, 401));
    try {
      await assert.rejects(client.getDevices(), AguaError);
      assert.equal(calls.filter((call) => call.path === '/userLogin').length, status === 401 ? 2 : 1);
    } finally {
      client.close();
    }
  }
});

test('HTTP and business errors are explicit and safe to log', async () => {
  for (const status of [200, 401, 403, 404, 412, 422, 429, 500]) {
    const diagnostics = [];
    const transport = new AguaTransport({
      fetch: async () => reply({
        Success: false, Error: '1104', Text: credentials.password, token: 'secret-token',
      }, status, { 'retry-after': '120' }),
      diagnostic: (event) => diagnostics.push(event),
    });
    try {
      await assert.rejects(transport.request('/deviceList'), (error) => {
        assert.equal(error.kind, status === 200 ? 'api' : 'http');
        assert.equal(error.retryAfterMs, 120_000);
        assert.equal(error.apiCode, '1104');
        assert.equal(error.message.includes(credentials.password), false);
        assert.equal(error.message.includes('secret-token'), false);
        return true;
      });
      assert.equal(JSON.stringify(diagnostics).includes(credentials.password), false);
    } finally {
      transport.close();
    }
  }
});

test('invalid JSON, wrong envelope and oversized body are refused', async () => {
  for (const body of ['not-json', 'null', '[]', '{"Success":"true"}', 'x'.repeat(200)]) {
    const transport = new AguaTransport({ maxResponseBytes: 100, fetch: async () => new Response(body) });
    try {
      await assert.rejects(transport.request('/deviceList'), expectKind('protocol'));
    } finally {
      transport.close();
    }
  }
});

test('network and timeout failures do not reveal the underlying error message', async () => {
  const network = new AguaTransport({ fetch: async () => { throw new Error(credentials.password); } });
  await assert.rejects(network.request('/deviceList'), expectKind('network'));
  network.close();
  const timed = new AguaTransport({
    timeoutMs: 5,
    fetch: async (_url, { signal }) => {
      await delay(1000, undefined, { signal });
      return reply(deviceList);
    },
  });
  await assert.rejects(timed.request('/deviceList'), expectKind('timeout'));
  timed.close();
});

test('timeout covers a slow response body as well as response headers', async () => {
  const transport = new AguaTransport({
    timeoutMs: 5,
    fetch: async (_url, { signal }) => new Response(new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
      },
    })),
  });
  await assert.rejects(transport.request('/deviceList'), expectKind('timeout'));
  transport.close();
});

test('job budget bounds endless waiting and cancels polling', async (context) => {
  const { client, calls } = mockClient(({ path }) => reply(path === '/deviceGetBufferReading'
    ? { Success: true, idRequest: 'job' } : { Success: true, jobAnswerStatus: 'waiting' }),
  { jobTimeoutMs: 20, jobPollIntervalMs: 2 });
  context.after(() => client.close());
  await assert.rejects(client.readBuffer(device), expectKind('job-timeout'));
  const count = calls.length;
  await delay(10);
  assert.equal(calls.length, count);
});

test('job deadline also bounds waiting for authentication', async (context) => {
  const client = new AguaClient(credentials, {
    jobTimeoutMs: 5,
    fetch: async (_url, { signal }) => {
      await delay(1000, undefined, { signal });
      return reply({ Success: true, id_app: appId }, 201);
    },
  });
  context.after(() => client.close());
  await assert.rejects(client.readBuffer(device), expectKind('job-timeout'));
});

test('closing aborts an in-flight request and refuses subsequent operations', async () => {
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const { client, calls } = mockClient(async ({ init }) => {
    started();
    await delay(1000, undefined, { signal: init.signal });
    return reply(deviceList);
  });
  const pending = client.getDevices();
  await ready;
  client.close();
  await assert.rejects(pending, expectKind('closed'));
  const count = calls.length;
  await assert.rejects(client.getDevices(), expectKind('closed'));
  assert.equal(calls.length, count);
});

test('there is no public command method and transport rejects non-read endpoints', async () => {
  const { client } = mockClient();
  assert.equal(client.turnOn, undefined);
  assert.equal(client.writeRegister, undefined);
  client.close();
  const transport = new AguaTransport({ fetch: async () => assert.fail('No writing request may reach the network') });
  for (const path of ['/deviceRequestWriting', '/deviceSetConfigBuffer', '/deviceRegister', '/deviceJobStatus/../../userLogin']) {
    await assert.rejects(transport.request(path), expectKind('configuration'));
  }
  transport.close();
});

test('invalid time budgets are rejected instead of overflowing Node timers', () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 2_147_483_648]) {
    assert.throws(() => new AguaTransport({ timeoutMs }), expectKind('configuration'));
    assert.throws(() => new AguaClient(credentials, { jobTimeoutMs: timeoutMs }), expectKind('configuration'));
  }
});

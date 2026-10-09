import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL } from 'node:url';

import { parseDiagnosticArguments, runDiagnostic } from '../dist/diagnostic.js';
import { AguaError } from '../dist/agua/errors.js';

const execute = promisify(execFile);

async function files(context) {
  const root = await mkdtemp(join(tmpdir(), 'nobis-diagnostic-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const credentials = join(root, 'credentials.json');
  await writeFile(credentials, JSON.stringify({ email: 'mock@example.invalid', password: 'private-test-password' }), { mode: 0o600 });
  const storage = join(root, 'storage');
  return {
    root, storage, credentials,
    args: ['--connect', '--credentials', credentials, '--storage', storage],
  };
}

function transport() {
  const calls = [];
  const fetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(path);
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    const replies = {
      '/appSignup': { Success: true, id_app: body?.id_app },
      '/userLogin': { Success: true, token: 'private-token', refresh_token: 'private-refresh' },
      '/deviceList': { Success: true, device: [{
        id_device: 'private-device', id_product: 'private-product', name: 'Private name', is_online: true,
      }] },
      '/deviceGetInfo': { Success: true, Value: true, device_info: [{ id_registers_map: 'private-map' }] },
      '/deviceGetRegistersMap': { Success: true, device_registers_map: { registers_map: [{
        id: 'private-map', registers: [{ reg_key: 'fictional_get', reg_type: 'GET', offset: 1, mask: 255, formula: '#' }],
      }] } },
      '/deviceGetBufferReading': { Success: true, idRequest: 'mock-job' },
      '/deviceJobStatus/mock-job': { Success: true, jobAnswerStatus: 'completed', jobAnswerData: { Items: [1], Values: [42] } },
    };
    assert.ok(path in replies, 'Only known read-only operations are permitted');
    return new globalThis.Response(JSON.stringify(replies[path]), { status: path === '/appSignup' ? 201 : 200 });
  };
  return { calls, clientOptions: { fetch } };
}

test('diagnostic is offline by default and does not access files or network', async () => {
  const clientOptions = { fetch: async () => assert.fail('No network without explicit consent') };
  assert.deepEqual(await runDiagnostic([], { clientOptions }), { connected: false });
  assert.deepEqual(await runDiagnostic(['--help'], { clientOptions }), { connected: false });
  const { stdout, stderr } = await execute(process.execPath, ['dist/diagnostic-cli.js']);
  assert.match(stdout, /Default: offline/);
  assert.equal(stderr, '');
});

test('arguments reject secrets, missing consent, duplicate flags and invalid buffers without reflecting input', () => {
  for (const args of [
    ['--password', 'private-secret'], ['--connect'], ['--credentials', '/private/file'],
    ['--help', '--connect'], ['--connect', '--connect'],
    ['--connect', '--credentials', 'relative', '--storage', '/private'],
    ['--connect', '--credentials', '/file', '--storage', '/private', '--buffer', '-1'],
    ['--connect', '--credentials', '/file', '--storage', '/private', '--buffer', '1.5'],
    ['--connect', '--credentials', '/file', '--storage', '/private', '--buffer', '99999999999999999'],
  ]) {
    assert.throws(() => parseDiagnosticArguments(args), (error) => {
      assert.ok(error instanceof AguaError);
      assert.equal(error.message.includes('private-secret'), false);
      return true;
    });
  }
});

test('one-shot mocked discovery writes a protected report without raw identifiers or session secrets', async (context) => {
  const local = await files(context);
  const { calls, clientOptions } = transport();
  const result = await runDiagnostic(local.args, { clientOptions });
  assert.deepEqual(calls, ['/appSignup', '/userLogin', '/deviceList', '/deviceGetInfo', '/deviceGetRegistersMap']);
  assert.equal(result.registerCount, 1);
  assert.equal(result.readingCount, undefined);
  const content = await readFile(result.reportPath, 'utf8');
  for (const secret of ['mock@example.invalid', 'private-test-password', 'private-token', 'private-refresh',
    'private-device', 'private-product', 'Private name', 'private-map']) {
    assert.equal(content.includes(secret), false);
  }
  const report = JSON.parse(content);
  assert.equal(report.reading, undefined);
  assert.equal(report.registers[0].reg_key, 'fictional_get');
  assert.equal((await stat(result.reportPath)).mode & 0o777, 0o600);
  assert.equal((await stat(join(local.storage, 'reports'))).mode & 0o777, 0o700);
  const again = await runDiagnostic(local.args, { clientOptions });
  assert.notEqual(again.reportPath, result.reportPath);
  assert.equal((await readdir(join(local.storage, 'reports'))).length, 2);
});

test('raw buffer is only read with an explicit buffer selection and is not converted into a temperature', async (context) => {
  const local = await files(context);
  const { calls, clientOptions } = transport();
  const result = await runDiagnostic([...local.args, '--buffer', '1'], { clientOptions });
  assert.equal(calls.at(-2), '/deviceGetBufferReading');
  assert.equal(calls.at(-1), '/deviceJobStatus/mock-job');
  const report = JSON.parse(await readFile(result.reportPath, 'utf8'));
  assert.deepEqual(report.reading.values, [{ offset: 1, value: 42 }]);
  assert.equal(report.reading.freshnessVerified, false);
  assert.equal(report.reading.temperature, undefined);
});

test('insecure credential permissions and symlinks are refused before authentication', async (context) => {
  const local = await files(context);
  const clientOptions = { fetch: async () => assert.fail('No network for invalid credentials') };
  await chmod(local.credentials, 0o644);
  await assert.rejects(runDiagnostic(local.args, { clientOptions }), AguaError);
  await chmod(local.credentials, 0o600);
  const alias = join(local.root, 'alias.json');
  await symlink(local.credentials, alias);
  await assert.rejects(runDiagnostic(['--connect', '--credentials', alias, '--storage', local.storage], { clientOptions }), AguaError);
});

test('malformed private JSON and invalid configuration do not expose values', async (context) => {
  const local = await files(context);
  for (const content of ['private-invalid-json', '{"email":"private-invalid-email","password":"private-secret"}']) {
    await writeFile(local.credentials, content);
    await assert.rejects(runDiagnostic(local.args), (error) => {
      assert.equal(error.message.includes('private-invalid'), false);
      assert.equal(error.message.includes('private-secret'), false);
      return true;
    });
  }
});

test('cancellation prevents connection and does not leave a diagnostic report', async (context) => {
  const local = await files(context);
  const shutdown = new globalThis.AbortController();
  shutdown.abort();
  await assert.rejects(runDiagnostic(local.args, {
    signal: shutdown.signal, clientOptions: { fetch: async () => assert.fail('No connection after cancellation') },
  }), (error) => error.kind === 'closed');
  assert.deepEqual(await readdir(local.root), ['credentials.json']);
});

test('unknown job payload stops validation without inventing a result or writing a success report', async (context) => {
  const local = await files(context);
  const { clientOptions } = transport();
  const base = clientOptions.fetch;
  clientOptions.fetch = async (url, init) => new URL(url).pathname.startsWith('/deviceJobStatus/')
    ? new globalThis.Response(JSON.stringify({
      Success: true, jobAnswerStatus: 'completed', jobAnswerPayload: 'unspecified',
    })) : base(url, init);
  await assert.rejects(runDiagnostic([...local.args, '--buffer', '1'], { clientOptions }), (error) => error.kind === 'protocol');
  assert.deepEqual(await readdir(join(local.storage, 'reports')), []);
});

test('in-flight cancellation closes the client and produces no success report', async (context) => {
  const local = await files(context);
  const { clientOptions, calls } = transport();
  const base = clientOptions.fetch;
  const shutdown = new globalThis.AbortController();
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  clientOptions.fetch = async (url, init) => {
    if (new URL(url).pathname !== '/deviceList') {
      return base(url, init);
    }
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('private-cancel-detail')), { once: true });
      entered();
    });
  };
  const pending = runDiagnostic(local.args, { clientOptions, signal: shutdown.signal });
  await ready;
  shutdown.abort();
  await assert.rejects(pending, (error) => {
    assert.equal(error.kind, 'closed');
    assert.equal(error.message.includes('private-cancel-detail'), false);
    return true;
  });
  assert.deepEqual(calls, ['/appSignup', '/userLogin']);
  assert.deepEqual(await readdir(join(local.storage, 'reports')), []);
});

test('ambiguous device selection stops before reading maps or buffers', async (context) => {
  const local = await files(context);
  const { clientOptions } = transport();
  const base = clientOptions.fetch;
  clientOptions.fetch = async (url, init) => {
    const response = await base(url, init);
    if (new URL(url).pathname !== '/deviceList') {
      return response;
    }
    const data = await response.json();
    data.device.push({ ...data.device[0], id_device: 'second-private-device' });
    return new globalThis.Response(JSON.stringify(data));
  };
  await assert.rejects(runDiagnostic(local.args, { clientOptions }), (error) => error.operation === 'diagnostic-device-selection');
  const result = await runDiagnostic([...local.args, '--device-id', 'second-private-device'], { clientOptions });
  assert.equal(result.connected, true);
});

test('an insecure existing storage directory is refused without changing its permissions', async (context) => {
  const local = await files(context);
  await chmod(local.root, 0o755);
  const clientOptions = { fetch: async () => assert.fail('No connection with public storage') };
  await assert.rejects(runDiagnostic([
    '--connect', '--credentials', local.credentials, '--storage', local.root,
  ], { clientOptions }), (error) => error.kind === 'storage');
  assert.equal((await stat(local.root)).mode & 0o777, 0o755);
});

test('CLI failures exit unsuccessfully without reflecting argument secrets', async () => {
  await assert.rejects(execute(process.execPath, ['dist/diagnostic-cli.js', '--password', 'private-argument']), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /configuration/);
    assert.equal(error.stderr.includes('private-argument'), false);
    return true;
  });
});

test('overall network budget aborts the session instead of allowing indefinite diagnostics', async (context) => {
  const local = await files(context);
  const { clientOptions } = transport();
  const base = clientOptions.fetch;
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  clientOptions.fetch = async (url, init) => {
    if (new URL(url).pathname !== '/deviceList') {
      return base(url, init);
    }
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      entered();
    });
  };
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = runDiagnostic(local.args, { clientOptions });
  await ready;
  context.mock.timers.tick(120_000);
  await assert.rejects(pending, (error) => error.kind === 'timeout' && error.operation === 'diagnostic-session');
  assert.deepEqual(await readdir(join(local.storage, 'reports')), []);
});

import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

import { AguaClient } from './agua/client.js';
import type { ClientOptions } from './agua/client.js';
import { AguaError } from './agua/errors.js';
import { loadAppIdentity } from './agua/identity.js';
import { ConfigError, parseConfig } from './config.js';

export async function discoverDevice(client: AguaClient, deviceId?: string) {
  const devices = (await client.getDevices()).filter((device) => !device.deleted);
  const selected = deviceId === undefined
    ? devices : devices.filter((device) => device.id_device === deviceId);
  const device = selected[0];
  if (selected.length !== 1 || device === undefined) {
    throw new AguaError('configuration', 'diagnostic-device-selection');
  }
  if (!device.is_online) {
    throw new AguaError('unavailable', 'diagnostic-device-offline');
  }
  return { device, deviceCount: devices.length };
}

export async function discoverRegisterMap(client: AguaClient, deviceId?: string) {
  const selected = await discoverDevice(client, deviceId);
  const map = await client.getRegisterMap(selected.device);
  return { ...selected, map };
}

export const DIAGNOSTIC_HELP = `Nobis local read-only diagnostic

Default: offline help only; no files, credentials or network are accessed.

Usage:
  npm run diagnostic -- --help
  npm run diagnostic -- --connect --credentials /absolute/private/credentials.json --storage /absolute/private/diagnostic-storage

Options:
  --connect             Explicitly authorize one read-only cloud session.
  --credentials PATH    Private JSON file containing email and password.
  --storage PATH        Dedicated private directory for identity and reports.
  --device-id ID        Required only if the account has multiple stoves.
  --buffer ID           Explicitly request one raw buffer after discovery.
  --help                Offline help; cannot be combined with other options.

No command, pairing, buffer configuration, telemetry or HomeKit accessory.
No buffer read unless --buffer is provided. No assumption about the A8 buffer.
The report is local and private, NOT certified anonymous: do not publish it.
Never pass a password/token on the command line or share credentials in chat.
Credentials/storage require POSIX private permissions (macOS/Linux).
`;

interface DiagnosticOptions {
  readonly connect: boolean;
  readonly credentials?: string;
  readonly storage?: string;
  readonly deviceId?: string;
  readonly bufferId?: number;
}

export interface DiagnosticResult {
  readonly connected: boolean;
  readonly registerCount?: number;
  readonly readingCount?: number;
  readonly reportPath?: string;
}

function argumentsError(): AguaError {
  return new AguaError('configuration', 'diagnostic-arguments');
}

export function parseDiagnosticArguments(args: readonly string[]): DiagnosticOptions {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    return { connect: false };
  }
  const values = new Map<string, string>();
  let connect = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--connect' && !connect) {
      connect = true;
      continue;
    }
    if (flag === undefined || !['--credentials', '--storage', '--device-id', '--buffer'].includes(flag)
      || values.has(flag)) {
      throw argumentsError();
    }
    const value = args[++index];
    if (value === undefined || value.startsWith('--') || value.trim().length === 0) {
      throw argumentsError();
    }
    values.set(flag, value);
  }
  const credentials = values.get('--credentials');
  const storage = values.get('--storage');
  const buffer = values.get('--buffer');
  const deviceId = values.get('--device-id');
  if (!connect || credentials === undefined || storage === undefined
    || !isAbsolute(credentials) || !isAbsolute(storage)
    || (buffer !== undefined && (!/^\d+$/.test(buffer) || !Number.isSafeInteger(Number(buffer))))) {
    throw argumentsError();
  }
  return {
    connect, credentials, storage,
    ...(deviceId === undefined ? {} : { deviceId }),
    ...(buffer === undefined ? {} : { bufferId: Number(buffer) }),
  };
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
    || (process.getuid !== undefined && stat.uid !== process.getuid())) {
    throw new AguaError('storage', 'diagnostic-directory');
  }
}

async function readCredentials(path: string): Promise<{ email: string; password: string }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 16_384 || (stat.mode & 0o077) !== 0
      || (process.getuid !== undefined && stat.uid !== process.getuid())) {
      throw new AguaError('storage', 'diagnostic-credentials');
    }
    let input: unknown;
    try {
      input = JSON.parse(await handle.readFile('utf8'));
    } catch {
      throw new AguaError('configuration', 'diagnostic-credentials');
    }
    const { email, password } = parseConfig(input);
    return { email, password };
  } finally {
    await handle.close();
  }
}

export async function runDiagnostic(
  args: readonly string[],
  dependencies: { readonly clientOptions?: ClientOptions; readonly signal?: AbortSignal } = {},
): Promise<DiagnosticResult> {
  const options = parseDiagnosticArguments(args);
  if (!options.connect) {
    return { connected: false };
  }
  if (process.platform === 'win32' || options.credentials === undefined || options.storage === undefined) {
    throw new AguaError('configuration', 'diagnostic-posix-storage');
  }
  let client: AguaClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let handle;
  const deadline = new AbortController();
  const signal = AbortSignal.any([
    deadline.signal, ...(dependencies.signal === undefined ? [] : [dependencies.signal]),
  ]);
  const cancel = () => client?.close();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const credentials = await readCredentials(options.credentials);
    await privateDirectory(options.storage);
    const reports = join(options.storage, 'reports');
    await privateDirectory(reports);
    const appId = await loadAppIdentity(options.storage);
    signal.throwIfAborted();
    client = new AguaClient({ ...credentials, appId }, dependencies.clientOptions);
    timer = setTimeout(() => deadline.abort(), 120_000);
    const { device, deviceCount, map } = await discoverRegisterMap(client, options.deviceId);
    const reading = options.bufferId === undefined ? undefined : await client.readBuffer(device, options.bufferId);
    signal.throwIfAborted();
    const report = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      warning: 'Private local diagnostic. Not certified anonymous; review before any sharing.',
      source: 'Agua-IoT Nobis, live read-only session',
      deviceCount,
      selectedDeviceOnline: device.is_online,
      registers: map.registers,
      ...(reading === undefined ? {} : {
        reading: {
          bufferId: options.bufferId,
          receivedAt: reading.receivedAt,
          freshnessVerified: false,
          interpretation: 'Raw integers; no temperature or thermal-state conversion',
          values: [...reading.values].map(([offset, value]) => ({ offset, value })),
        },
      }),
      limitations: [
        'No hardware model or firmware verification',
        'No thermal-state, units, formulas or commands validated',
        'No proof of measurement freshness',
        'No raw HTTP response, account credentials, token, app ID, device ID, name or map ID included',
      ],
    };
    const reportPath = join(reports, `diagnostic-${randomUUID()}.json`);
    handle = await open(reportPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await handle.sync();
    signal.throwIfAborted();
    return {
      connected: true, reportPath, registerCount: map.registers.length,
      ...(reading === undefined ? {} : { readingCount: reading.values.size }),
    };
  } catch (error) {
    if (deadline.signal.aborted) {
      throw new AguaError('timeout', 'diagnostic-session');
    }
    if (dependencies.signal?.aborted) {
      throw new AguaError('closed', 'diagnostic-session');
    }
    if (error instanceof AguaError || error instanceof ConfigError) {
      throw error;
    }
    throw new AguaError('storage', 'diagnostic-local-files');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    client?.close();
    await handle?.close();
  }
}

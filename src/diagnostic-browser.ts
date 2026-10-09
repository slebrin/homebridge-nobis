import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AguaClient } from './agua/client.js';
import type { ClientOptions } from './agua/client.js';
import { AguaError, AguaJobUnavailableError, AguaReadingProtocolError } from './agua/errors.js';
import type { ReadingStructure } from './agua/errors.js';
import { loadAppIdentity } from './agua/identity.js';
import { decodeNobisAmbientTemperature } from './agua/temperature.js';
import { ConfigError, parseConfig } from './config.js';
import { discoverDevice, discoverRegisterMap } from './diagnostic.js';
import { describeResponseShape, observeBufferIndexes, observeNackCode } from './diagnostic-shape.js';
import { diagnosticPage, diagnosticScript, diagnosticStyle } from './diagnostic-page.js';

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readInput(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type'] !== 'application/json') {
    throw new RequestError(415, 'Format de requete refuse.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 16_384) {
      throw new RequestError(413, 'Requete trop volumineuse.');
    }
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'Requete JSON invalide.');
  }
}

function safeFailure(error: unknown): { status: number; error: string; readingStructure?: ReadingStructure } {
  if (error instanceof AguaReadingProtocolError) {
    return {
      status: 502,
      error: `${error.message}. Lecture refusee, aucune valeur interpretee.`
        + ' Types et tailles seulement ; aucun nouvel essai automatique.',
      readingStructure: error.readingStructure,
    };
  }
  if (error instanceof RequestError) {
    return { status: error.status, error: error.message };
  }
  if (error instanceof ConfigError) {
    return { status: 400, error: 'Verifiez les champs e-mail, mot de passe et identifiant optionnel.' };
  }
  if (error instanceof AguaJobUnavailableError) {
    const explanations = {
      'terminated': 'Le service indique un job termine sans resultat exploitable.',
      'Missing job': 'Le service indique que le job est introuvable.',
      'Missing job answer': 'Le service indique que la reponse du job est introuvable.',
    };
    return { status: 502, error: `${error.message}. ${explanations[error.jobStatus]}`
      + ' Cause non etablie ; aucun code NackErrCode disponible et aucun nouvel essai automatique.' };
  }
  if (error instanceof AguaError) {
    const guidance = error.operation === 'diagnostic-device-selection'
      ? ' Selection impossible : verifiez le compte ou renseignez un identifiant pour plusieurs poeles.'
      : error.operation === 'diagnostic-device-offline' ? ' Le poele est signale hors ligne.'
      : error.operation === 'ambient-temperature'
        ? ' Temperature refusee : registre absent, valeur invalide ou profil different du profil valide. Aucun repli ni nouvel essai automatique.'
        : '';
    return { status: 502, error: `${error.message}.${guidance}` };
  }
  return { status: 500, error: 'Echec du diagnostic local. Details prives non journalises.' };
}

export async function startDiagnosticBrowser(
  storagePath: string,
  options: { readonly clientOptions?: ClientOptions; readonly sessionTimeoutMs?: number } = {},
) {
  const sessionTimeoutMs = options.sessionTimeoutMs ?? 120_000;
  if (!Number.isSafeInteger(sessionTimeoutMs) || sessionTimeoutMs <= 0 || sessionTimeoutMs > 120_000) {
    throw new AguaError('configuration', 'browser-timeout');
  }
  const token = randomBytes(32).toString('hex');
  let origin = '';
  let active = false;
  let stopped = false;
  let client: AguaClient | undefined;
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      const failure = safeFailure(error);
      if (!response.headersSent && !response.destroyed) {
        response.writeHead(failure.status, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({
          error: failure.error,
          ...(failure.readingStructure === undefined ? {} : { readingStructure: failure.readingStructure }),
        }));
      } else {
        response.destroy();
      }
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.timeout = 130_000;

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy',
      'default-src \'none\'; script-src \'self\'; style-src \'self\'; connect-src \'self\'; form-action \'self\'; frame-ancestors \'none\'; base-uri \'none\'');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.headers.host !== new URL(origin).host
      || (request.headers.origin !== undefined && request.headers.origin !== origin)
      || (request.headers['sec-fetch-site'] !== undefined
        && !['same-origin', 'none'].includes(String(request.headers['sec-fetch-site'])))) {
      throw new RequestError(403, 'Acces local uniquement.');
    }
    const pages: Record<string, readonly [string, string]> = {
      '/': ['text/html', diagnosticPage],
      '/app.js': ['text/javascript', diagnosticScript(token)],
      '/style.css': ['text/css', diagnosticStyle],
    };
    const page = request.url === undefined ? undefined : pages[request.url];
    if (request.method === 'GET' && page !== undefined) {
      response.writeHead(200, { 'Content-Type': `${page[0]}; charset=utf-8` });
      response.end(page[1]);
      return;
    }
    if (request.method !== 'POST'
      || !['/discover', '/buffer-configuration', '/buffer-id', '/buffer-one', '/ambient-temperature'].includes(request.url ?? '')) {
      throw new RequestError(404, 'Route indisponible.');
    }
    if (request.headers.origin !== origin || request.headers['x-nobis-token'] !== token) {
      throw new RequestError(403, 'Autorisation locale invalide. Rechargez la page.');
    }
    if (active || stopped) {
      throw new RequestError(409, 'Un diagnostic est deja en cours ou l\'interface est arretee.');
    }
    active = true;
    const deadline = new AbortController();
    const timer = setTimeout(() => { deadline.abort(); client?.close(); }, sessionTimeoutMs);
    const cancel = () => { deadline.abort(); client?.close(); };
    response.once('close', cancel);
    try {
      const input = await readInput(request);
      const config = parseConfig(input);
      const appId = await loadAppIdentity(storagePath);
      if (deadline.signal.aborted || stopped) {
        throw new AguaError('closed', 'browser-discovery');
      }
      client = new AguaClient({ email: config.email, password: config.password, appId }, options.clientOptions);
      let result: object;
      if (request.url === '/ambient-temperature') {
        const { device, map } = await discoverRegisterMap(client, config.deviceId);
        const reading = await client.readBuffer(device, 1);
        result = { bufferId: 1, temperature: decodeNobisAmbientTemperature(map, reading, 1) };
      } else if (request.url === '/buffer-one') {
        const { device } = await discoverDevice(client, config.deviceId);
        const reading = await client.readBuffer(device, 1);
        result = {
          bufferId: 1,
          receivedAt: reading.receivedAt,
          freshnessVerified: false,
          values: [...reading.values].map(([offset, value]) => ({ offset, value })),
        };
      } else if (request.url === '/buffer-configuration' || request.url === '/buffer-id') {
        const { device } = await discoverDevice(client, config.deviceId);
        const job = request.url === '/buffer-id'
          ? await client.inspectConfiguredBufferId(device) : await client.inspectBufferConfiguration(device);
        result = {
          configurationValidated: false,
          shape: describeResponseShape(job),
          nack: observeNackCode(job),
          ...(request.url === '/buffer-id' ? { bufferIndexes: observeBufferIndexes(job) } : {}),
        };
      } else {
        const { deviceCount, map } = await discoverRegisterMap(client, config.deviceId);
        result = { deviceCount, registerCount: map.registers.length, registers: map.registers };
      }
      if (deadline.signal.aborted) {
        throw new AguaError('timeout', 'browser-discovery');
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(result));
    } catch (error) {
      throw deadline.signal.aborted ? new AguaError('timeout', 'browser-discovery') : error;
    } finally {
      clearTimeout(timer);
      response.removeListener('close', cancel);
      client?.close();
      client = undefined;
      active = false;
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new AguaError('configuration', 'browser-listen');
  }
  origin = `http://127.0.0.1:${address.port}`;
  let closing: Promise<void> | undefined;
  return {
    url: origin,
    close: (): Promise<void> => {
      if (closing !== undefined) {
        return closing;
      }
      stopped = true;
      client?.close();
      closing = new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
        server.closeAllConnections();
      });
      return closing;
    },
  };
}

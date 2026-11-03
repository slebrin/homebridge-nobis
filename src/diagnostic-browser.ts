import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AguaClient } from './agua/client.js';
import type { ClientOptions } from './agua/client.js';
import { AguaError, AguaJobUnavailableError, AguaReadingProtocolError } from './agua/errors.js';
import type { ReadingStructure } from './agua/errors.js';
import { loadAppIdentity } from './agua/identity.js';
import { decodeNobisAmbientTemperature } from './agua/temperature.js';
import { record } from './agua/models.js';
import { confirmSetpoint } from './agua/setpoint-confirmation.js';
import { decodeSetpoint } from './agua/command-preview.js';
import { observeNobisStatus } from './agua/status-observation.js';
import { observeOperatingSettings } from './agua/operating-settings.js';
import { previewFrontVentilation } from './agua/ventilation-preview.js';
import { previewPowerLevel } from './agua/power-level-preview.js';
import { previewAuto, previewPowerful } from './agua/auto-preview.js';
import { confirmReading } from './agua/readback-confirmation.js';
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
      : error.operation === 'power-initial-phase'
        ? ' Commande non envoyee : allumage exige OFF, arret exige TRAVAIL ou ECO STOP ; phase relue differente ou non validee.'
      : error.operation === 'power-preview'
        ? ' Commande non envoyee : profil ou enumerations marche/arret incompatibles.'
      : error.operation === 'ventilation-initial-state'
        ? ' Commande non envoyee : essai limite a OFF/TRAVAIL, ventilation initiale 1..7, Auto et Powerful bruts a 0.'
      : error.operation === 'power-level-initial-state'
        ? ' Commande non envoyee : essai limite a OFF/TRAVAIL, Auto et Powerful bruts a 0.'
      : error.operation === 'auto-initial-state'
        ? ' Commande non envoyee : essai Auto limite a OFF/TRAVAIL/ECO STOP et Powerful OFF.'
      : error.operation === 'auto-preview' || error.operation === 'auto-unchanged'
        ? ' Commande non envoyee : profil Auto incompatible ou cible identique.'
      : error.operation === 'powerful-initial-state'
        ? ' Commande non envoyee : essai Powerful limite a OFF/TRAVAIL/ECO STOP et Auto OFF.'
      : error.operation === 'powerful-preview' || error.operation === 'powerful-unchanged'
        ? ' Commande non envoyee : profil Powerful incompatible ou cible identique ; CRONO exclu.'
      : error.operation === 'power-level-preview' || error.operation === 'power-level-unchanged'
        ? ' Commande non envoyee : profil puissance incompatible, niveau invalide, special ou identique.'
      : error.operation === 'ventilation-preview' || error.operation === 'ventilation-unchanged'
        ? ' Commande non envoyee : profil incompatible, niveau invalide ou identique ; OFF et PS exclus de cet essai.'
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
      || !['/discover', '/buffer-configuration', '/buffer-id', '/buffer-one', '/ambient-temperature', '/settings-read', '/status-read', '/power-test', '/setpoint-read', '/setpoint-test', '/ventilation-test', '/power-level-test', '/auto-test', '/powerful-test'].includes(request.url ?? '')) {
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
      const writeInput = request.url === '/setpoint-test' ? record(input, 'setpoint-test') : undefined;
      const powerInput = request.url === '/power-test' ? record(input, 'power-test') : undefined;
      const ventilationInput = request.url === '/ventilation-test' ? record(input, 'ventilation-test') : undefined;
      const powerLevelInput = request.url === '/power-level-test' ? record(input, 'power-level-test') : undefined;
      const autoInput = request.url === '/auto-test' ? record(input, 'auto-test') : undefined;
      const powerfulInput = request.url === '/powerful-test' ? record(input, 'powerful-test') : undefined;
      if (powerfulInput !== undefined
        && (powerfulInput.confirmPowerfulChange !== true || typeof powerfulInput.enabled !== 'boolean')) {
        throw new RequestError(400, 'Choisissez explicitement Powerful ON/OFF et confirmez la modification reelle.');
      }
      if (autoInput !== undefined && (autoInput.confirmAutoChange !== true || typeof autoInput.enabled !== 'boolean')) {
        throw new RequestError(400, 'Choisissez explicitement Auto ON/OFF et confirmez la modification reelle.');
      }
      if (powerLevelInput !== undefined
        && (powerLevelInput.confirmPowerLevelChange !== true || typeof powerLevelInput.level !== 'number'
          || !Number.isSafeInteger(powerLevelInput.level) || powerLevelInput.level < 1 || powerLevelInput.level > 7)) {
        throw new RequestError(400, 'Confirmez la puissance reelle et choisissez un niveau entier 1 a 7.');
      }
      if (ventilationInput !== undefined
        && (ventilationInput.confirmVentilationChange !== true || typeof ventilationInput.level !== 'number'
          || !Number.isSafeInteger(ventilationInput.level) || ventilationInput.level < 1 || ventilationInput.level > 7)) {
        throw new RequestError(400, 'Confirmez la ventilation reelle et choisissez un niveau entier 1 a 7. OFF et PS exclus.');
      }
      if (powerInput !== undefined
        && (powerInput.confirmPowerChange !== true || (powerInput.action !== 'on' && powerInput.action !== 'off'))) {
        throw new RequestError(400, 'Confirmez la commande reelle et choisissez on ou off.');
      }
      if (writeInput !== undefined
        && (writeInput.confirmSetpointChange !== true || typeof writeInput.celsius !== 'number'
          || !Number.isSafeInteger(writeInput.celsius) || writeInput.celsius < 7 || writeInput.celsius > 40)) {
        throw new RequestError(400, 'Confirmez la modification reelle et choisissez une consigne entiere de 7 a 40.');
      }
      const appId = await loadAppIdentity(storagePath);
      if (deadline.signal.aborted || stopped) {
        throw new AguaError('closed', 'browser-discovery');
      }
      client = new AguaClient({ email: config.email, password: config.password, appId }, {
        ...options.clientOptions, enableExperimentalSetpoint: writeInput !== undefined,
        enableExperimentalPower: powerInput !== undefined,
        enableExperimentalVentilation: ventilationInput !== undefined,
        enableExperimentalPowerLevel: powerLevelInput !== undefined,
        enableExperimentalAuto: autoInput !== undefined,
        enableExperimentalPowerful: powerfulInput !== undefined,
      });
      let result: object;
      const confirmSettings = async (
        device: Parameters<AguaClient['readBuffer']>[0],
        map: Parameters<typeof observeOperatingSettings>[0],
        key: 'fun_auto_set' | 'fun_pwf_set' | 'power_set' | 'vent_front_set',
        target: number,
      ) => {
        const activeClient = client;
        if (activeClient === undefined) {
          throw new AguaError('closed', 'settings-confirmation');
        }
        const confirmation = await confirmReading(
          () => activeClient.readBuffer(device, 1),
          reading => observeOperatingSettings(map, reading),
          settings => settings.registers.some(entry => entry.key === key && entry.rawValue === target
            && (key === 'fun_auto_set' || key === 'fun_pwf_set'
              ? entry.label === (target === 1 ? 'ON' : 'OFF') : entry.label === null)),
          deadline.signal,
        );
        return { after: confirmation.value, readbackMatches: confirmation.readbackMatches,
          observations: confirmation.observations };
      };
      if (powerfulInput !== undefined && typeof powerfulInput.enabled === 'boolean') {
        const { device, map } = await discoverRegisterMap(client, config.deviceId);
        const initialReading = await client.readBuffer(device, 1);
        const preview = previewPowerful(device, map, initialReading, powerfulInput.enabled);
        await client.testPowerful(device, map, initialReading, powerfulInput.enabled);
        result = {
          originalEnabled: preview.originalEnabled, requestedEnabled: powerfulInput.enabled,
          before: preview.settings, ...await confirmSettings(device, map, 'fun_pwf_set', Number(powerfulInput.enabled)),
          physicalEffectVerified: false, freshnessVerified: false,
        };
      } else if (autoInput !== undefined && typeof autoInput.enabled === 'boolean') {
        const { device, map } = await discoverRegisterMap(client, config.deviceId);
        const initialReading = await client.readBuffer(device, 1);
        const preview = previewAuto(device, map, initialReading, autoInput.enabled);
        await client.testAuto(device, map, initialReading, autoInput.enabled);
        result = {
          originalEnabled: preview.originalEnabled, requestedEnabled: autoInput.enabled,
          before: preview.settings, ...await confirmSettings(device, map, 'fun_auto_set', Number(autoInput.enabled)),
          physicalEffectVerified: false, freshnessVerified: false,
        };
      } else if (powerLevelInput !== undefined && typeof powerLevelInput.level === 'number') {
        const { device, map } = await discoverRegisterMap(client, config.deviceId);
        const initialReading = await client.readBuffer(device, 1);
        const preview = previewPowerLevel(device, map, initialReading, powerLevelInput.level);
        await client.testPowerLevel(device, map, initialReading, powerLevelInput.level);
        result = {
          originalLevel: preview.originalLevel, requestedLevel: powerLevelInput.level,
          before: preview.settings, ...await confirmSettings(device, map, 'power_set', powerLevelInput.level),
          physicalEffectVerified: false, freshnessVerified: false,
        };
      } else if (ventilationInput !== undefined && typeof ventilationInput.level === 'number') {
        const { device, map } = await discoverRegisterMap(client, config.deviceId);
        const initialReading = await client.readBuffer(device, 1);
        const preview = previewFrontVentilation(device, map, initialReading, ventilationInput.level);
        await client.testFrontVentilation(device, map, initialReading, ventilationInput.level);
        result = {
          originalLevel: preview.originalLevel, requestedLevel: ventilationInput.level,
          before: preview.settings, ...await confirmSettings(device, map, 'vent_front_set', ventilationInput.level),
          physicalEffectVerified: false, freshnessVerified: false,
        };
      } else if (powerInput !== undefined && (powerInput.action === 'on' || powerInput.action === 'off')) {
        const { device, map } = await discoverRegisterMap(client, config.deviceId);
        const initialReading = await client.readBuffer(device, 1);
        const before = observeNobisStatus(map, initialReading);
        await client.testPower(device, map, initialReading, powerInput.action);
        const after = observeNobisStatus(map, await client.readBuffer(device, 1));
        result = {
          action: powerInput.action, mask: 255, before, after,
          physicalEffectVerified: false, freshnessVerified: false,
        };
      } else if (writeInput !== undefined && typeof writeInput.celsius === 'number') {
        const { device, map } = await discoverRegisterMap(client, config.deviceId);
        const before = await client.readBuffer(device, 1);
        const initial = decodeSetpoint(map, before);
        if (initial.mode !== 'temperature') {
          throw new AguaError('protocol', 'setpoint-original');
        }
        const original = initial.celsius;
        await client.testSetpoint(device, map, writeInput.celsius);
        const activeClient = client;
        const confirmation = await confirmSetpoint(
          () => activeClient.readBuffer(device, 1), writeInput.celsius, deadline.signal,
        );
        result = {
          originalCelsius: original, requestedCelsius: writeInput.celsius,
          ...confirmation, freshnessVerified: false,
        };
      } else if (request.url === '/settings-read') {
        const { device, map } = await discoverRegisterMap(client, config.deviceId);
        const reading = await client.readBuffer(device, 1);
        result = { bufferId: 1, settings: observeOperatingSettings(map, reading) };
      } else if (request.url === '/status-read') {
        const { device, map } = await discoverRegisterMap(client, config.deviceId);
        const reading = await client.readBuffer(device, 1);
        result = { bufferId: 1, status: observeNobisStatus(map, reading) };
      } else if (request.url === '/setpoint-read') {
        const { device, map } = await discoverRegisterMap(client, config.deviceId);
        const reading = await client.readBuffer(device, 1);
        result = { bufferId: 1, setpoint: decodeSetpoint(map, reading) };
      } else if (request.url === '/ambient-temperature') {
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
      if (request.url === '/auto-test' || request.url === '/powerful-test') {
        const failure = safeFailure(deadline.signal.aborted
          ? new AguaError('timeout', request.url === '/auto-test' ? 'auto-test' : 'powerful-test') : error);
        throw new RequestError(failure.status, `${failure.error}`
          + ' Verifiez Auto, Powerful, puissance et ventilation dans Nobis-Fi.'
          + ' Une commande peut avoir ete appliquee ; aucune repetition ni restauration automatiques.');
      }
      if (request.url === '/ventilation-test' || request.url === '/power-level-test') {
        const failure = safeFailure(deadline.signal.aborted
          ? new AguaError('timeout', request.url === '/ventilation-test' ? 'ventilation-test' : 'power-level-test') : error);
        throw new RequestError(failure.status, `${failure.error}`
          + ' Verifiez Nobis-Fi et restaurez le niveau initial si necessaire.'
          + ' Effet physique non confirme ; aucune repetition ni restauration automatiques.');
      }
      if (request.url === '/power-test') {
        const failure = safeFailure(deadline.signal.aborted ? new AguaError('timeout', 'power-test') : error);
        throw new RequestError(failure.status, `${failure.error}`
          + ' Effet physique non confirme : verifiez la telecommande et Nobis-Fi.'
          + ' Aucune repetition, commande inverse ni changement de masque automatiques.');
      }
      if (request.url === '/setpoint-test') {
        const failure = safeFailure(deadline.signal.aborted ? new AguaError('timeout', 'setpoint-test') : error);
        throw new RequestError(failure.status, `${failure.error}`
          + ' Le resultat physique peut etre indetermine : verifiez et restaurez la consigne dans Nobis-Fi.'
          + ' Aucune repetition ni restauration automatique.');
      }
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

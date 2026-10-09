import { setTimeout as delay } from 'node:timers/promises';

import { AguaAuth } from './auth.js';
import type { Credentials } from './auth.js';
import { AguaError, AguaJobUnavailableError } from './errors.js';
import { deviceReference, devices, integer, jobReading, list, record, registers, text } from './models.js';
import type { AguaDevice, DeviceReference, RawReading, RegisterMap } from './models.js';
import { AguaTransport } from './transport.js';
import type { AguaPath, TransportOptions } from './transport.js';

export interface ClientOptions extends TransportOptions {
  readonly jobTimeoutMs?: number;
  readonly jobPollIntervalMs?: number;
}

export class AguaClient {
  private readonly transport: AguaTransport;
  private readonly auth: AguaAuth;
  private readonly shutdown = new AbortController();
  private readonly pendingDevices = new Map<string, Promise<readonly AguaDevice[]>>();
  private readonly pendingMaps = new Map<string, Promise<RegisterMap>>();
  private readonly pendingBuffers = new Map<string, Promise<RawReading>>();
  private readonly pendingBufferConfigs = new Map<string, Promise<Record<string, unknown>>>();
  private readonly jobTimeoutMs: number;
  private readonly jobPollIntervalMs: number;

  constructor(credentials: Credentials, options: ClientOptions = {}) {
    this.jobTimeoutMs = options.jobTimeoutMs ?? 30_000;
    this.jobPollIntervalMs = options.jobPollIntervalMs ?? 1000;
    if (!Number.isSafeInteger(this.jobTimeoutMs) || this.jobTimeoutMs <= 0 || this.jobTimeoutMs > 2_147_483_647
      || !Number.isSafeInteger(this.jobPollIntervalMs) || this.jobPollIntervalMs <= 0 || this.jobPollIntervalMs > 2_147_483_647) {
      throw new AguaError('configuration', 'client');
    }
    this.transport = new AguaTransport(options);
    this.auth = new AguaAuth(this.transport, credentials);
  }

  close(): void {
    this.shutdown.abort();
    this.auth.close();
    this.transport.close();
  }

  getDevices(): Promise<readonly AguaDevice[]> {
    return this.shared(this.pendingDevices, 'devices', async () => devices(await this.request('/deviceList', {})));
  }

  getRegisterMap(device: DeviceReference): Promise<RegisterMap> {
    const reference = deviceReference(device);
    return this.shared(this.pendingMaps, JSON.stringify(reference), async () => {
      const info = await this.request('/deviceGetInfo', reference);
      if (info.Value === false || info.device_info === null) {
        throw new AguaError('unavailable', 'deviceGetInfo');
      }
      const entries = list(info.device_info, 'deviceGetInfo');
      // Multiple records cannot be associated reliably until their identity contract is validated.
      if (entries.length !== 1) {
        throw new AguaError('protocol', 'deviceGetInfo');
      }
      const mapId = text(record(entries[0], 'deviceGetInfo').id_registers_map, 'deviceGetInfo');
      return registers(await this.request('/deviceGetRegistersMap', reference), mapId);
    });
  }

  readBuffer(device: DeviceReference, bufferId?: number): Promise<RawReading> {
    const reference = deviceReference(device);
    if (bufferId !== undefined && integer(bufferId, 'buffer-id') < 0) {
      return Promise.reject(new AguaError('configuration', 'buffer-id'));
    }
    return this.shared(this.pendingBuffers, JSON.stringify([reference, bufferId]), () =>
      this.runJob('/deviceGetBufferReading', {
        ...reference, ...(bufferId === undefined ? {} : { BufferId: bufferId }),
      }, 'read-buffer', (response) => jobReading(response, Date.now())));
  }

  inspectBufferConfiguration(device: DeviceReference): Promise<Record<string, unknown>> {
    return this.inspectBufferMetadata(device, '/deviceGetConfigBuffer');
  }

  inspectConfiguredBufferId(device: DeviceReference): Promise<Record<string, unknown>> {
    return this.inspectBufferMetadata(device, '/devicegetBufferId');
  }

  private inspectBufferMetadata(
    device: DeviceReference,
    path: '/deviceGetConfigBuffer' | '/devicegetBufferId',
  ): Promise<Record<string, unknown>> {
    const reference = deviceReference(device);
    return this.shared(this.pendingBufferConfigs, JSON.stringify([path, reference]), () =>
      this.runJob(path, reference, path.slice(1), (response) => {
        const state = text(response.jobAnswerStatus, 'deviceJobStatus');
        if (state === 'waiting') {
          return undefined;
        }
        if (state === 'terminated' || state === 'Missing job' || state === 'Missing job answer') {
          throw new AguaJobUnavailableError(state);
        }
        if (state !== 'completed') {
          throw new AguaError('protocol', 'deviceJobStatus');
        }
        // A completed job is not a validated buffer configuration.
        return response;
      }));
  }

  private async runJob<T>(
    path: '/deviceGetBufferReading' | '/deviceGetConfigBuffer' | '/devicegetBufferId',
    body: object,
    operation: string,
    parse: (response: Record<string, unknown>) => T | undefined,
  ): Promise<T> {
    const budget = new AbortController();
    const timer = setTimeout(() => budget.abort(), this.jobTimeoutMs);
    const signal = AbortSignal.any([this.shutdown.signal, budget.signal]);
    try {
      const response = await this.request(path, body, signal);
      const id = text(response.idRequest, path.slice(1));
      if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new AguaError('protocol', path.slice(1));
      }
      for (;;) {
        await delay(this.jobPollIntervalMs, undefined, { signal });
        const result = parse(await this.request(`/deviceJobStatus/${id}`, undefined, signal));
        if (result !== undefined) {
          return result;
        }
      }
    } catch (error) {
      if (this.shutdown.signal.aborted) {
        throw new AguaError('closed', operation);
      }
      if (budget.signal.aborted) {
        throw new AguaError('job-timeout', operation);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(path: AguaPath, body?: object, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const token = await this.waitForToken(this.auth.token(), signal);
    const send = (authorization: string) => this.transport.request(path, {
      authorization, local: false,
      ...(body === undefined ? {} : { body }),
      ...(signal === undefined ? {} : { signal }),
    });
    try {
      return await send(token);
    } catch (error) {
      if (!(error instanceof AguaError) || error.kind !== 'http' || error.status !== 401
        || signal?.aborted || this.shutdown.signal.aborted) {
        throw error;
      }
      return send(await this.waitForToken(this.auth.token(token), signal));
    }
  }

  private waitForToken(pending: Promise<string>, signal?: AbortSignal): Promise<string> {
    if (signal === undefined) {
      return pending;
    }
    return new Promise((resolve, reject) => {
      const aborted = () => reject(new AguaError('closed', 'session'));
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) {
        aborted();
      }
      void pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
    });
  }

  private shared<T>(cache: Map<string, Promise<T>>, key: string, operation: () => Promise<T>): Promise<T> {
    if (this.shutdown.signal.aborted) {
      return Promise.reject(new AguaError('closed', 'client'));
    }
    const existing = cache.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const pending = operation();
    cache.set(key, pending);
    void pending.then(
      () => { cache.delete(key); },
      () => { cache.delete(key); },
    );
    return pending;
  }
}

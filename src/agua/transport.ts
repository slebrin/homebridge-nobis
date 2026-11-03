import { AguaError } from './errors.js';
import { record } from './models.js';

export type AguaPath =
  | '/appSignup' | '/userLogin' | '/refreshToken' | '/deviceList'
  | '/deviceGetInfo' | '/deviceGetRegistersMap' | '/deviceGetBufferReading'
  | '/deviceGetConfigBuffer'
  | '/devicegetBufferId'
  | '/deviceRequestWriting'
  | `/deviceJobStatus/${string}`;

export interface RequestOptions {
  readonly body?: object;
  readonly authorization?: string;
  readonly local?: boolean;
  readonly status?: number;
  readonly signal?: AbortSignal;
}

export interface Diagnostic {
  readonly operation: string;
  readonly durationMs: number;
  readonly status?: number;
  readonly errorKind?: string;
}

export interface TransportOptions {
  readonly enableExperimentalSetpoint?: boolean;
  readonly enableExperimentalPower?: boolean;
  readonly enableExperimentalVentilation?: boolean;
  readonly enableExperimentalPowerLevel?: boolean;
  readonly enableExperimentalAuto?: boolean;
  readonly enableExperimentalChrono?: boolean;
  readonly enableExperimentalPowerful?: boolean;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly diagnostic?: (event: Diagnostic) => void;
}

const ORIGIN = 'https://nobis.agua-iot.com';
const PATHS = new Set([
  '/appSignup', '/userLogin', '/refreshToken', '/deviceList',
  '/deviceGetInfo', '/deviceGetRegistersMap', '/deviceGetBufferReading',
  '/deviceGetConfigBuffer',
  '/devicegetBufferId',
]);

function retryAfter(header: string | null): number | undefined {
  if (header === null) {
    return undefined;
  }
  const seconds = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export class AguaTransport {
  private readonly shutdown = new AbortController();
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(private readonly options: TransportOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 2_000_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 2_147_483_647
      || !Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes <= 0) {
      throw new AguaError('configuration', 'transport');
    }
  }

  close(): void {
    this.shutdown.abort();
  }

  async request(path: AguaPath, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    const isJob = /^\/deviceJobStatus\/[A-Za-z0-9_-]+$/.test(path);
    if (!PATHS.has(path) && !isJob
      && !(path === '/deviceRequestWriting'
        && (this.options.enableExperimentalSetpoint === true || this.options.enableExperimentalPower === true
          || this.options.enableExperimentalVentilation === true || this.options.enableExperimentalPowerLevel === true
          || this.options.enableExperimentalAuto === true || this.options.enableExperimentalPowerful === true
          || this.options.enableExperimentalChrono === true))) {
      throw new AguaError('configuration', 'path');
    }
    const operation = isJob ? 'deviceJobStatus' : path.slice(1);
    if (this.shutdown.signal.aborted) {
      throw new AguaError('closed', operation);
    }
    const startedAt = Date.now();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const signal = AbortSignal.any([
      this.shutdown.signal, timeout.signal, ...(options.signal === undefined ? [] : [options.signal]),
    ]);
    let status: number | undefined;
    let failure: AguaError | undefined;
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/json',
        'customer_code': '700700',
        'id_brand': '1',
      };
      if (options.authorization !== undefined) {
        headers.Authorization = options.authorization;
      }
      if (options.local !== undefined) {
        headers.local = String(options.local);
      }
      signal.throwIfAborted();
      const response = await this.fetcher(`${ORIGIN}${path}`, {
        method: isJob ? 'GET' : 'POST',
        headers,
        redirect: 'error',
        signal,
        ...(isJob ? {} : { body: JSON.stringify(options.body ?? {}) }),
      });
      status = response.status;
      const delay = retryAfter(response.headers.get('retry-after'));
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader !== undefined) {
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) {
              break;
            }
            size += chunk.value.byteLength;
            if (size > this.maxResponseBytes) {
              await reader.cancel();
              throw new AguaError('protocol', operation, status);
            }
            chunks.push(chunk.value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      signal.throwIfAborted();
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new AguaError(status === (options.status ?? 200) ? 'protocol' : 'http', operation, status, undefined, delay);
      }
      const data = record(parsed, operation);
      const code = typeof data.Error === 'string' && /^\d{1,10}$/.test(data.Error) ? data.Error : undefined;
      if (status !== (options.status ?? 200)) {
        throw new AguaError('http', operation, status, code, delay);
      }
      if (data.Success === false) {
        throw new AguaError('api', operation, status, code, delay);
      }
      if (data.Success !== true) {
        throw new AguaError('protocol', operation, status);
      }
      return data;
    } catch (error) {
      failure = this.shutdown.signal.aborted || options.signal?.aborted
        ? new AguaError('closed', operation)
        : timeout.signal.aborted
          ? new AguaError('timeout', operation)
          : error instanceof AguaError ? error : new AguaError('network', operation);
      throw failure;
    } finally {
      clearTimeout(timer);
      this.options.diagnostic?.({
        operation,
        durationMs: Date.now() - startedAt,
        ...(status === undefined ? {} : { status }),
        ...(failure === undefined ? {} : { errorKind: failure.kind }),
      });
    }
  }
}

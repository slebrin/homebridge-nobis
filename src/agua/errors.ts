export type AguaErrorKind =
  | 'http' | 'api' | 'network' | 'timeout' | 'closed' | 'protocol'
  | 'unavailable' | 'job-timeout' | 'configuration' | 'storage';

export class AguaError extends Error {
  constructor(
    public readonly kind: AguaErrorKind,
    public readonly operation: string,
    public readonly status?: number,
    public readonly apiCode?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(`Agua-IoT ${operation}: ${kind}`
      + (status === undefined ? '' : ` (HTTP ${status})`)
      + (apiCode === undefined ? '' : ` [code ${apiCode}]`));
    this.name = 'AguaError';
  }

}

export class AguaJobUnavailableError extends AguaError {
  constructor(public readonly jobStatus: 'terminated' | 'Missing job' | 'Missing job answer') {
    super('unavailable', 'deviceJobStatus');
    this.message += ` [job status: ${jobStatus}]`;
  }

}

export interface ReadingStructure {
  readonly dataType: string;
  readonly payloadType: string;
  readonly itemsType: string;
  readonly valuesType: string;
  readonly itemCount?: number;
  readonly valueCount?: number;
}

export class AguaReadingProtocolError extends AguaError {
  constructor(
    readonly reason: 'unsupported-envelope' | 'invalid-values',
    readonly readingStructure: ReadingStructure,
  ) {
    super('protocol', 'deviceJobStatus');
    this.message += ` [reading: ${reason}]`;
  }
}

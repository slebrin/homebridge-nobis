import { AguaError } from './errors.js';
import { record, text } from './models.js';
import type { AguaTransport } from './transport.js';

export interface Credentials {
  readonly email: string;
  readonly password: string;
  readonly appId: string;
}

interface Session {
  readonly token: string;
  readonly refreshToken: string;
  readonly expiresAt?: number;
}

function expiration(token: string): number | undefined {
  try {
    const payload = token.split('.')[1];
    if (payload === undefined) {
      return undefined;
    }
    const claims = record(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')), 'jwt-exp');
    return typeof claims.exp === 'number' && Number.isFinite(claims.exp * 1000) && claims.exp >= 0
      ? claims.exp * 1000 : undefined;
  } catch {
    // Tokens without a usable exp are kept opaque; the server's 401 remains authoritative.
    return undefined;
  }
}

function session(data: Record<string, unknown>, previousRefreshToken?: string): Session {
  const operation = 'session';
  const token = text(data.token, operation);
  const snake = data.refresh_token;
  const camel = data.refreshToken;
  if (snake !== undefined) {
    text(snake, operation);
  }
  if (camel !== undefined) {
    text(camel, operation);
  }
  if (snake !== undefined && camel !== undefined && snake !== camel) {
    throw new AguaError('protocol', operation);
  }
  const refreshToken = text(snake ?? camel ?? previousRefreshToken, operation);
  const expiresAt = expiration(token);
  return { token, refreshToken, ...(expiresAt === undefined ? {} : { expiresAt }) };
}

function rejectedSession(error: unknown): boolean {
  return error instanceof AguaError && error.kind === 'http'
    && (error.status === 401 || error.status === 403 || error.status === 422);
}

export class AguaAuth {
  private current: Session | undefined;
  private pending: Promise<string> | undefined;
  private registered = false;
  private closed = false;

  constructor(private readonly transport: AguaTransport, private readonly credentials: Credentials) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(credentials.appId)
      || credentials.email.trim().length === 0 || credentials.password.trim().length === 0) {
      throw new AguaError('configuration', 'credentials');
    }
  }

  close(): void {
    this.closed = true;
    this.current = undefined;
  }

  token(rejectedToken?: string): Promise<string> {
    if (this.closed) {
      return Promise.reject(new AguaError('closed', 'session'));
    }
    if (this.pending !== undefined) {
      return this.pending;
    }
    if (this.current !== undefined && this.current.token !== rejectedToken
      && (this.current.expiresAt === undefined || this.current.expiresAt > Date.now() + 30_000)) {
      return Promise.resolve(this.current.token);
    }
    const pending = this.renew();
    this.pending = pending;
    void pending.then(
      () => { this.pending = undefined; },
      () => { this.pending = undefined; },
    );
    return pending;
  }

  private async renew(): Promise<string> {
    if (!this.registered) {
      const uuid = this.credentials.appId;
      const response = await this.transport.request('/appSignup', {
        status: 201,
        body: {
          phone_type: 'Android', phone_id: uuid, phone_version: '1.0', language: 'en',
          id_app: uuid, push_notification_token: uuid, push_notification_active: false,
        },
      });
      if (response.id_app !== uuid) {
        throw new AguaError('protocol', 'appSignup');
      }
      this.registered = true;
    }
    if (this.current !== undefined) {
      const previous = this.current;
      try {
        const response = await this.transport.request('/refreshToken', {
          status: 201, body: { refresh_token: previous.refreshToken },
        });
        return this.install(session(response, previous.refreshToken));
      } catch (error) {
        if (!rejectedSession(error)) {
          throw error;
        }
        this.current = undefined;
      }
    }
    const response = await this.transport.request('/userLogin', {
      body: { email: this.credentials.email, password: this.credentials.password },
      authorization: this.credentials.appId,
      local: true,
    });
    return this.install(session(response));
  }

  private install(value: Session): string {
    if (this.closed) {
      throw new AguaError('closed', 'session');
    }
    this.current = value;
    return value.token;
  }
}

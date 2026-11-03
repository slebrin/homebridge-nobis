import {
  DEFAULT_POLL_INTERVAL_SECONDS,
  MAX_POLL_INTERVAL_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
  PLATFORM_NAME,
} from './settings.js';

export interface NobisConfig {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly stoveName?: string;
  readonly deviceId?: string;
  readonly pollIntervalSeconds: number;
  readonly diagnostic: boolean;
  readonly enableCloud: boolean;
  readonly enableTemperatureSensor: boolean;
  readonly enablePowerSwitch: boolean;
  readonly enableSetpointControl: boolean;
  readonly enableVentilationControl: boolean;
  readonly enablePowerfulControl: boolean;
  readonly enableAutoControl: boolean;
  readonly confirmAbandonPendingCommands: boolean;
  readonly useHeatingActivityIndicator: boolean;
  readonly enableChronoControl: boolean;
  readonly enableEcoStopSensor: boolean;
}

export class ConfigError extends Error {
  constructor(public readonly fields: readonly string[]) {
    super(`Invalid Nobis configuration: ${fields.join(', ')}. Check the plugin settings.`);
    this.name = 'ConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseConfig(input: unknown): NobisConfig {
  if (!isRecord(input)) {
    throw new ConfigError(['configuration']);
  }

  const fields: string[] = [];
  const email = input.email;
  const password = input.password;
  const name = input.name === undefined ? PLATFORM_NAME : input.name;
  const interval = input.pollIntervalSeconds === undefined ? DEFAULT_POLL_INTERVAL_SECONDS : input.pollIntervalSeconds;
  const diagnostic = input.diagnostic === undefined ? false : input.diagnostic;
  const enableCloud = input.enableCloud === undefined ? false : input.enableCloud;
  const enableTemperatureSensor = input.enableTemperatureSensor === undefined ? false : input.enableTemperatureSensor;
  const enablePowerSwitch = input.enablePowerSwitch === undefined ? false : input.enablePowerSwitch;
  const enableSetpointControl = input.enableSetpointControl === undefined ? false : input.enableSetpointControl;
  const enableVentilationControl = input.enableVentilationControl === undefined ? false : input.enableVentilationControl;
  const enablePowerfulControl = input.enablePowerfulControl === undefined ? false : input.enablePowerfulControl;
  const enableAutoControl = input.enableAutoControl === undefined ? false : input.enableAutoControl;
  const confirmAbandonPendingCommands = input.confirmAbandonPendingCommands === undefined ? false : input.confirmAbandonPendingCommands;
  const useHeatingActivityIndicator = input.useHeatingActivityIndicator === undefined ? false : input.useHeatingActivityIndicator;
  const enableChronoControl = input.enableChronoControl === undefined ? false : input.enableChronoControl;
  const enableEcoStopSensor = input.enableEcoStopSensor === undefined ? false : input.enableEcoStopSensor;

  if (!nonEmptyString(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    fields.push('email');
  }
  if (!nonEmptyString(password)) {
    fields.push('password');
  }
  if (!nonEmptyString(name)) {
    fields.push('name');
  }
  if (typeof interval !== 'number' || !Number.isInteger(interval)
    || interval < MIN_POLL_INTERVAL_SECONDS || interval > MAX_POLL_INTERVAL_SECONDS) {
    fields.push('pollIntervalSeconds');
  }
  if (typeof diagnostic !== 'boolean') {
    fields.push('diagnostic');
  }
  if (typeof enableCloud !== 'boolean') {
    fields.push('enableCloud');
  }
  if (typeof enableTemperatureSensor !== 'boolean'
    || (enableTemperatureSensor && !enableCloud)) {
    fields.push('enableTemperatureSensor');
  }
  if (typeof enablePowerSwitch !== 'boolean' || (enablePowerSwitch && (!enableCloud || !enableTemperatureSensor))) {
    fields.push('enablePowerSwitch');
  }
  if (typeof enableSetpointControl !== 'boolean' || (enableSetpointControl && !enablePowerSwitch)) {
    fields.push('enableSetpointControl');
  }
  if (typeof enableVentilationControl !== 'boolean' || (enableVentilationControl && !enableSetpointControl)) {
    fields.push('enableVentilationControl');
  }
  if (typeof enablePowerfulControl !== 'boolean' || (enablePowerfulControl && !enablePowerSwitch)) {
    fields.push('enablePowerfulControl');
  }
  if (typeof enableAutoControl !== 'boolean' || (enableAutoControl && !enablePowerSwitch)) {
    fields.push('enableAutoControl');
  }
  if (typeof confirmAbandonPendingCommands !== 'boolean' || (confirmAbandonPendingCommands && !enablePowerSwitch)) {
    fields.push('confirmAbandonPendingCommands');
  }
  if (typeof useHeatingActivityIndicator !== 'boolean' || (useHeatingActivityIndicator && !enableSetpointControl)) {
    fields.push('useHeatingActivityIndicator');
  }
  if (typeof enableChronoControl !== 'boolean' || (enableChronoControl && !enablePowerSwitch)) {
    fields.push('enableChronoControl');
  }
  if (typeof enableEcoStopSensor !== 'boolean' || (enableEcoStopSensor && !enableTemperatureSensor)) {
    fields.push('enableEcoStopSensor');
  }
  for (const field of ['stoveName', 'deviceId'] as const) {
    if (input[field] !== undefined && !nonEmptyString(input[field])) {
      fields.push(field);
    }
  }

  if (fields.length > 0 || !nonEmptyString(email) || !nonEmptyString(password)
    || !nonEmptyString(name) || typeof interval !== 'number' || typeof diagnostic !== 'boolean'
    || typeof enableCloud !== 'boolean' || typeof enableTemperatureSensor !== 'boolean'
    || typeof enablePowerSwitch !== 'boolean' || typeof enableSetpointControl !== 'boolean'
    || typeof enableVentilationControl !== 'boolean' || typeof enablePowerfulControl !== 'boolean'
    || typeof enableAutoControl !== 'boolean' || typeof confirmAbandonPendingCommands !== 'boolean'
    || typeof useHeatingActivityIndicator !== 'boolean' || typeof enableChronoControl !== 'boolean'
    || typeof enableEcoStopSensor !== 'boolean') {
    throw new ConfigError(fields);
  }

  return Object.freeze({
    name: name.trim(),
    email: email.trim(),
    password,
    pollIntervalSeconds: interval,
    diagnostic,
    enableCloud,
    enableTemperatureSensor,
    enablePowerSwitch,
    enableSetpointControl,
    enableVentilationControl,
    enablePowerfulControl,
    enableAutoControl,
    confirmAbandonPendingCommands,
    useHeatingActivityIndicator,
    enableChronoControl,
    enableEcoStopSensor,
    ...(nonEmptyString(input.stoveName) ? { stoveName: input.stoveName.trim() } : {}),
    ...(nonEmptyString(input.deviceId) ? { deviceId: input.deviceId.trim() } : {}),
  });
}

import { AguaError } from './errors.js';
import { deviceReference } from './models.js';
import type { DeviceReference, RawReading, RegisterMap } from './models.js';

export interface SetpointPreview {
  readonly hardwareValidated: false;
  readonly body: DeviceReference & {
    readonly Protocol: 'RWMSmaster';
    readonly BitData: 8;
    readonly Endianess: 'L';
    readonly Items: readonly [33122];
    readonly Masks: readonly [65535];
    readonly Values: readonly [number];
  };
}

function setpointRegister(map: RegisterMap) {
  const operation = 'setpoint-preview';
  const matches = map.registers.filter(register => register.reg_key === 'temp_air_set');
  const register = matches[0];
  if (matches.length !== 1 || register === undefined
    || register.reg_type !== 'SET' || register.readonly !== false
    || register.offset !== 33122 || register.mask !== 65535
    || register.formula !== '#' || register.formula_inverse !== '#'
    || register.set_min !== 7 || register.set_max !== 41 || register.step !== 1
    || register.is_word !== true || register.big_endian !== false || register.with_sign !== false) {
    throw new AguaError('protocol', operation);
  }
  return register;
}

export type SetpointReading =
  | { readonly mode: 'temperature'; readonly celsius: number; readonly receivedAt: number; readonly freshness: 'unknown' }
  | { readonly mode: 'manual'; readonly receivedAt: number; readonly freshness: 'unknown' };

export function readSetpointValue(reading: RawReading): number {
  const value = reading.values.get(33122);
  if (value === undefined || !Number.isSafeInteger(value) || value < 7 || value > 41
    || !Number.isSafeInteger(reading.receivedAt) || reading.receivedAt < 0
    || !Number.isFinite(new Date(reading.receivedAt).getTime())) {
    throw new AguaError('protocol', 'setpoint-readback');
  }
  return value;
}

export function decodeSetpoint(map: RegisterMap, reading: RawReading): SetpointReading {
  const register = setpointRegister(map);
  const value = readSetpointValue(reading);
  if (value === 41) {
    if (!register.enc_val?.some(entry => entry.value === 41 && entry.lang === 'FRE' && entry.description === 'MAN')) {
      throw new AguaError('protocol', 'setpoint-readback');
    }
    return Object.freeze({ mode: 'manual', receivedAt: reading.receivedAt, freshness: 'unknown' });
  }
  if (register.enc_val?.some(entry => entry.value === value)) {
    throw new AguaError('protocol', 'setpoint-readback');
  }
  return Object.freeze({ mode: 'temperature', celsius: value, receivedAt: reading.receivedAt, freshness: 'unknown' });
}

/** Offline protocol candidate only; this function never sends a command. */
export function previewSetpoint(
  device: DeviceReference,
  map: RegisterMap,
  celsius: number,
): SetpointPreview {
  const register = setpointRegister(map);
  const operation = 'setpoint-preview';
  // 41 is the observed MAN sentinel, not a temperature target.
  if (!Number.isSafeInteger(celsius) || celsius < 7 || celsius >= 41
    || register.enc_val?.some(entry => entry.value === celsius)) {
    throw new AguaError('configuration', operation);
  }
  return Object.freeze({
    hardwareValidated: false,
    body: Object.freeze({
      ...deviceReference(device),
      Protocol: 'RWMSmaster',
      BitData: 8,
      Endianess: 'L',
      Items: Object.freeze([33122] as const),
      Masks: Object.freeze([65535] as const),
      Values: Object.freeze([celsius] as const),
    }),
  });
}

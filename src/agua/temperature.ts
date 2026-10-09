import { AguaError } from './errors.js';
import type { RawReading, RegisterMap } from './models.js';

export interface AmbientTemperature {
  readonly registerKey: 'temp_air2_get';
  readonly celsius: number;
  readonly receivedAt: number;
  readonly freshness: 'unknown';
}

export function decodeNobisAmbientTemperature(
  map: RegisterMap,
  reading: RawReading,
  bufferId: number,
): AmbientTemperature {
  const operation = 'ambient-temperature';
  const matches = map.registers.filter(register => register.reg_key === 'temp_air2_get');
  const register = matches[0];
  if (bufferId !== 1 || matches.length !== 1 || register === undefined
    || register.reg_type !== 'GET' || register.offset !== 103 || register.mask !== 65535
    || register.formula !== '#' || register.is_word !== true
    || register.big_endian !== false || register.with_sign !== false) {
    throw new AguaError('protocol', operation);
  }
  const value = reading.values.get(register.offset);
  if (value === undefined) {
    throw new AguaError('unavailable', operation);
  }
  if (!Number.isSafeInteger(value) || value < 0 || value > 65535
    || !Number.isSafeInteger(reading.receivedAt) || reading.receivedAt < 0
    || !Number.isFinite(new Date(reading.receivedAt).getTime())) {
    throw new AguaError('protocol', operation);
  }
  // The API supplies the word value; do not assemble neighbouring offsets.
  return Object.freeze({
    registerKey: 'temp_air2_get',
    celsius: value,
    receivedAt: reading.receivedAt,
    freshness: 'unknown',
  });
}

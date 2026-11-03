import { AguaError } from './errors.js';
import type { RawReading, RegisterMap } from './models.js';

const profiles = [
  { key: 'power_set', offset: 33120, min: 1, max: 7 },
  { key: 'vent_front_set', offset: 33132, min: 0, max: 8 },
  { key: 'fun_auto_set', offset: 33128, min: 0, max: 1 },
  { key: 'fun_pwf_set', offset: 33154, min: 0, max: 1 },
] as const;

/** Read-only candidates: matched once with Nobis-Fi, not validated control capabilities. */
export function observeOperatingSettings(map: RegisterMap, reading: RawReading) {
  const operation = 'operating-settings';
  if (!Number.isSafeInteger(reading.receivedAt) || reading.receivedAt < 0
    || !Number.isFinite(new Date(reading.receivedAt).getTime())) {
    throw new AguaError('protocol', operation);
  }
  const registers = profiles.map(profile => {
    const matches = map.registers.filter(register => register.reg_key === profile.key);
    const register = matches[0];
    if (matches.length !== 1 || register === undefined || register.reg_type !== 'SET'
      || register.readonly !== false || register.offset !== profile.offset || register.mask !== 65535
      || register.formula !== '#' || register.formula_inverse !== '#'
      || register.set_min !== profile.min || register.set_max !== profile.max || register.step !== 1
      || register.is_word !== true || register.big_endian !== false || register.with_sign !== false) {
      throw new AguaError('protocol', operation);
    }
    const rawValue = reading.values.get(profile.offset);
    if (rawValue === undefined || !Number.isSafeInteger(rawValue)
      || rawValue < profile.min || rawValue > profile.max) {
      throw new AguaError('protocol', operation);
    }
    const labels = register.enc_val?.filter(entry => entry.lang === 'FRE' && entry.value === rawValue) ?? [];
    if (labels.length > 1 || labels.some(entry => entry.description.trim().length === 0)) {
      throw new AguaError('protocol', operation);
    }
    return Object.freeze({
      key: profile.key, offset: profile.offset, rawValue, label: labels[0]?.description ?? null,
    });
  });
  return Object.freeze({
    receivedAt: reading.receivedAt, freshness: 'unknown' as const,
    controlValidated: false as const, registers: Object.freeze(registers),
  });
}

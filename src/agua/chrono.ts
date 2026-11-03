import { AguaError } from './errors.js';
import { deviceReference } from './models.js';
import type { DeviceReference, RawReading, RegisterMap } from './models.js';
import { observeNobisStatus } from './status-observation.js';

export function observeChrono(map: RegisterMap, reading: RawReading) {
  const matches = map.registers.filter(register => register.reg_key === 'chrono_week_enable_set');
  const register = matches[0];
  const value = reading.values.get(33162);
  if (matches.length !== 1 || register === undefined || register.reg_type !== 'SET'
    || register.readonly !== false || register.offset !== 33162 || register.mask !== 65535
    || register.formula !== '#' || register.formula_inverse !== '#' || register.set_min !== 0
    || register.set_max !== 1 || register.step !== 1 || register.is_word !== false
    || register.big_endian !== false || register.with_sign !== false
    || (value !== 0 && value !== 1) || !Number.isSafeInteger(reading.receivedAt)
    || reading.receivedAt < 0 || !Number.isFinite(new Date(reading.receivedAt).getTime())) {
    throw new AguaError('protocol', 'chrono-observation');
  }
  const labels = register.enc_val?.filter(entry => entry.value === value && entry.lang === 'FRE') ?? [];
  if (labels.length !== 0) {
    throw new AguaError('protocol', 'chrono-observation');
  }
  return Object.freeze({
    receivedAt: reading.receivedAt, freshness: 'unknown' as const,
    registers: Object.freeze([Object.freeze({
      key: 'chrono_week_enable_set' as const, offset: 33162, rawValue: value, label: null,
    })]),
  });
}

export function previewChrono(device: DeviceReference, map: RegisterMap, reading: RawReading, enabled: boolean) {
  const observation = observeChrono(map, reading);
  if (typeof enabled !== 'boolean') {
    throw new AguaError('configuration', 'chrono-preview');
  }
  const phase = observeNobisStatus(map, reading).phase.kind;
  if (phase !== 'off' && phase !== 'eco-stop') {
    throw new AguaError('configuration', 'chrono-initial-state');
  }
  if (observation.registers[0]?.rawValue === Number(enabled)) {
    throw new AguaError('configuration', 'chrono-unchanged');
  }
  return Object.freeze({
    hardwareValidated: false as const,
    body: Object.freeze({
      ...deviceReference(device), Protocol: 'RWMSmaster' as const, BitData: 8 as const, Endianess: 'L' as const,
      Items: Object.freeze([33162]), Masks: Object.freeze([65535]), Values: Object.freeze([Number(enabled)]),
    }),
  });
}

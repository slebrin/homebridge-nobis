import { AguaError } from './errors.js';
import { deviceReference } from './models.js';
import type { DeviceReference, RawReading, RegisterMap } from './models.js';
import { observeOperatingSettings } from './operating-settings.js';
import { observeNobisStatus } from './status-observation.js';

/** Strict manual candidate; no power-level write has been validated on hardware yet. */
export function previewPowerLevel(device: DeviceReference, map: RegisterMap, reading: RawReading, level: number) {
  if (!Number.isSafeInteger(level) || level < 1 || level > 7) {
    throw new AguaError('configuration', 'power-level-preview');
  }
  const phase = observeNobisStatus(map, reading).phase.kind;
  const settings = observeOperatingSettings(map, reading);
  const original = settings.registers.find(entry => entry.key === 'power_set');
  // Conservative test policy, not a claimed manufacturer restriction.
  if ((phase !== 'off' && phase !== 'working') || original === undefined
    || reading.values.get(33128) !== 0 || reading.values.get(33154) !== 0) {
    throw new AguaError('configuration', 'power-level-initial-state');
  }
  const register = map.registers.find(entry => entry.reg_key === 'power_set');
  if (register?.enc_val?.some(entry => entry.value === level || entry.value === original.rawValue)) {
    throw new AguaError('protocol', 'power-level-preview');
  }
  return Object.freeze({
    hardwareValidated: false as const,
    originalLevel: original.rawValue,
    settings,
    body: Object.freeze({
      ...deviceReference(device), Protocol: 'RWMSmaster' as const, BitData: 8 as const, Endianess: 'L' as const,
      Items: Object.freeze([33120] as const), Masks: Object.freeze([65535] as const), Values: Object.freeze([level]),
    }),
  });
}

import { AguaError } from './errors.js';
import { deviceReference } from './models.js';
import type { DeviceReference, RawReading, RegisterMap } from './models.js';
import { observeOperatingSettings } from './operating-settings.js';
import { observeNobisStatus } from './status-observation.js';

/** Manual protocol candidate only. OFF and PS are excluded from this initial test. */
export function previewFrontVentilation(device: DeviceReference, map: RegisterMap, reading: RawReading, level: number) {
  const operation = 'ventilation-preview';
  if (!Number.isSafeInteger(level) || level < 1 || level > 7) {
    throw new AguaError('configuration', operation);
  }
  const phase = observeNobisStatus(map, reading).phase.kind;
  const settings = observeOperatingSettings(map, reading);
  const original = reading.values.get(33132);
  // Experimental policy, not a claimed manufacturer/API prohibition.
  if ((phase !== 'off' && phase !== 'working') || original === undefined || original < 1 || original > 7
    || reading.values.get(33128) !== 0 || reading.values.get(33154) !== 0) {
    throw new AguaError('configuration', 'ventilation-initial-state');
  }
  const register = map.registers.find(entry => entry.reg_key === 'vent_front_set');
  for (const [value, description] of [[0, 'OFF'], [8, 'PS']] as const) {
    const labels = register?.enc_val?.filter(entry => entry.value === value && entry.lang === 'FRE') ?? [];
    if (labels.length !== 1 || labels[0]?.description !== description) {
      throw new AguaError('protocol', operation);
    }
  }
  if (register?.enc_val?.some(entry => entry.value === level || entry.value === original)) {
    throw new AguaError('protocol', operation);
  }
  return Object.freeze({
    hardwareValidated: false as const,
    originalLevel: original,
    settings,
    body: Object.freeze({
      ...deviceReference(device), Protocol: 'RWMSmaster' as const, BitData: 8 as const, Endianess: 'L' as const,
      Items: Object.freeze([33132] as const), Masks: Object.freeze([65535] as const),
      Values: Object.freeze([level]),
    }),
  });
}

import { AguaError } from './errors.js';
import { deviceReference } from './models.js';
import type { DeviceReference, RawReading, RegisterMap } from './models.js';
import { observeOperatingSettings } from './operating-settings.js';
import { observeNobisStatus } from './status-observation.js';

/** Manual candidate, based on the observed Auto OFF/ON/OFF register cycle. */
export function previewAuto(device: DeviceReference, map: RegisterMap, reading: RawReading, enabled: boolean) {
  return previewOperatingMode(device, map, reading, enabled, 'auto');
}

/** Powerful remains a map-derived candidate until its ON/OFF readbacks are validated on hardware. */
export function previewPowerful(device: DeviceReference, map: RegisterMap, reading: RawReading, enabled: boolean) {
  return previewOperatingMode(device, map, reading, enabled, 'powerful');
}

function previewOperatingMode(
  device: DeviceReference, map: RegisterMap, reading: RawReading, enabled: boolean, mode: 'auto' | 'powerful',
) {
  const offset = mode === 'auto' ? 33128 : 33154;
  const otherOffset = mode === 'auto' ? 33154 : 33128;
  const key = mode === 'auto' ? 'fun_auto_set' : 'fun_pwf_set';
  if (typeof enabled !== 'boolean') {
    throw new AguaError('configuration', `${mode}-preview`);
  }
  const settings = observeOperatingSettings(map, reading);
  const phase = observeNobisStatus(map, reading).phase.kind;
  if ((phase !== 'off' && phase !== 'working' && phase !== 'eco-stop') || reading.values.get(otherOffset) !== 0) {
    throw new AguaError('configuration', `${mode}-initial-state`);
  }
  const register = map.registers.find(entry => entry.reg_key === key);
  for (const [value, description] of [[0, 'OFF'], [1, 'ON']] as const) {
    const labels = register?.enc_val?.filter(entry => entry.value === value && entry.lang === 'FRE') ?? [];
    if (labels.length !== 1 || labels[0]?.description !== description) {
      throw new AguaError('protocol', `${mode}-preview`);
    }
  }
  const originalEnabled = reading.values.get(offset) === 1;
  if (originalEnabled === enabled) {
    throw new AguaError('configuration', `${mode}-unchanged`);
  }
  return Object.freeze({
    originalEnabled, settings, hardwareValidated: false as const,
    body: Object.freeze({
      ...deviceReference(device), Protocol: 'RWMSmaster' as const, BitData: 8 as const, Endianess: 'L' as const,
      Items: Object.freeze([offset]), Masks: Object.freeze([65535] as const),
      Values: Object.freeze([enabled ? 1 : 0]),
    }),
  });
}

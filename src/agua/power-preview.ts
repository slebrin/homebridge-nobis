import { AguaError } from './errors.js';
import { deviceReference } from './models.js';
import type { DeviceReference, RawReading, RegisterMap } from './models.js';
import { observeNobisStatus } from './status-observation.js';

export type PowerAction = 'on' | 'off';

/** Offline candidate: map-derived mask, no automatic trial of other encodings. */
export function previewPower(device: DeviceReference, map: RegisterMap, reading: RawReading, action: PowerAction) {
  const operation = 'power-preview';
  if (action !== 'on' && action !== 'off') {
    throw new AguaError('configuration', operation);
  }
  const observation = observeNobisStatus(map, reading);
  const { kind } = observation.phase;
  if (action === 'on' ? kind !== 'off' : kind !== 'working' && kind !== 'eco-stop') {
    throw new AguaError('configuration', 'power-initial-phase');
  }
  const register = map.registers.find(entry => entry.reg_key === 'status_managed_get');
  if (register === undefined || register.readonly !== false
    || register.formula_inverse !== '#' || register.set_min !== 0 || register.set_max !== 255
    || register.step !== 1 || register.is_word !== false
    || register.big_endian !== false || register.with_sign !== false) {
    throw new AguaError('protocol', operation);
  }
  for (const [value, description] of [[85, 'ON'], [170, 'OFF']] as const) {
    const matches = register.enc_val?.filter(entry => entry.value === value && entry.lang === 'FRE') ?? [];
    if (matches.length !== 1 || matches[0]?.description !== description) {
      throw new AguaError('protocol', operation);
    }
  }
  return Object.freeze({
    hardwareValidated: false as const,
    body: Object.freeze({
      ...deviceReference(device), Protocol: 'RWMSmaster' as const,
      BitData: 8 as const, Endianess: 'L' as const,
      Items: Object.freeze([232] as const), Masks: Object.freeze([255] as const),
      Values: Object.freeze([action === 'on' ? 85 : 170]),
    }),
  });
}

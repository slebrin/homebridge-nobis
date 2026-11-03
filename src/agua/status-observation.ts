import { AguaError } from './errors.js';
import type { RawReading, RegisterMap } from './models.js';

export type ObservedPhase =
  | { readonly kind: 'off'; readonly code: 0 }
  | { readonly kind: 'starting'; readonly code: 2 }
  | { readonly kind: 'working'; readonly code: 5 }
  | { readonly kind: 'stopping'; readonly code: 7 }
  | { readonly kind: 'eco-stop'; readonly code: 8 }
  | { readonly kind: 'unknown'; readonly code: number; readonly reason: 'unvalidated-code' | 'label-mismatch' };

export interface StatusObservation {
  readonly receivedAt: number;
  readonly freshness: 'unknown';
  readonly phase: ObservedPhase;
  readonly registers: readonly {
    readonly key: 'status_get' | 'status_managed_get';
    readonly offset: number;
    readonly rawValue: number;
    readonly label: string | null;
  }[];
}

function observedPhase(code: number, label: string | null): ObservedPhase {
  // Only these exact code/label pairs have been compared with the target stove.
  switch (code) {
    case 0:
      if (label === 'OFF') {
        return Object.freeze({ kind: 'off', code });
      }
      break;
    case 2:
      if (label === 'D\u00c9BUT') {
        return Object.freeze({ kind: 'starting', code });
      }
      break;
    case 5:
      if (label === 'TRAVAIL') {
        return Object.freeze({ kind: 'working', code });
      }
      break;
    case 7:
      if (label === 'ARR\u00caT') {
        return Object.freeze({ kind: 'stopping', code });
      }
      break;
    case 8:
      if (label === 'ECO STOP') {
        return Object.freeze({ kind: 'eco-stop', code });
      }
      break;
    default:
      return Object.freeze({ kind: 'unknown', code, reason: 'unvalidated-code' });
  }
  return Object.freeze({ kind: 'unknown', code, reason: 'label-mismatch' });
}

/** Observes validated phase pairs without inferring Active or a HomeKit heating state. */
export function observeNobisStatus(map: RegisterMap, reading: RawReading): StatusObservation {
  const operation = 'status-observation';
  if (!Number.isSafeInteger(reading.receivedAt) || reading.receivedAt < 0
    || !Number.isFinite(new Date(reading.receivedAt).getTime())) {
    throw new AguaError('protocol', operation);
  }
  const profiles = [
    { key: 'status_get', offset: 8, mask: 65535 },
    { key: 'status_managed_get', offset: 232, mask: 255 },
  ] as const;
  const registers = profiles.map(profile => {
    const matches = map.registers.filter(register => register.reg_key === profile.key);
    const register = matches[0];
    if (matches.length !== 1 || register === undefined || register.reg_type !== 'GET'
      || register.offset !== profile.offset || register.mask !== profile.mask || register.formula !== '#') {
      throw new AguaError('protocol', operation);
    }
    const rawValue = reading.values.get(profile.offset);
    if (rawValue === undefined || !Number.isSafeInteger(rawValue) || rawValue < 0 || rawValue > profile.mask) {
      throw new AguaError('protocol', operation);
    }
    const labels = register.enc_val?.filter(entry => entry.value === rawValue && entry.lang === 'FRE') ?? [];
    if (labels.length > 1 || labels.some(entry => entry.description.trim().length === 0)) {
      throw new AguaError('protocol', operation);
    }
    return Object.freeze({
      key: profile.key, offset: profile.offset, rawValue, label: labels[0]?.description ?? null,
    });
  });
  const status = registers[0];
  if (status === undefined) {
    throw new AguaError('protocol', operation);
  }
  return Object.freeze({
    receivedAt: reading.receivedAt, freshness: 'unknown',
    phase: observedPhase(status.rawValue, status.label), registers: Object.freeze(registers),
  });
}

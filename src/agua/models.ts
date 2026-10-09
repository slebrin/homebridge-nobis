import { AguaError, AguaJobUnavailableError, AguaReadingProtocolError } from './errors.js';

export interface DeviceReference {
  readonly id_device: string;
  readonly id_product: string;
}

export interface AguaDevice extends DeviceReference {
  readonly name: string;
  readonly is_online: boolean;
  readonly deleted?: boolean;
}

export interface Register {
  readonly reg_key: string;
  readonly reg_type: string;
  readonly offset: number;
  readonly mask: number;
  readonly formula: string;
  readonly readonly?: boolean;
  readonly formula_inverse?: string;
  readonly set_min?: number;
  readonly set_max?: number;
  readonly step?: number;
  readonly is_word?: boolean;
  readonly big_endian?: boolean;
  readonly with_sign?: boolean;
  readonly enc_val?: readonly {
    readonly value: number;
    readonly lang: string;
    readonly description: string;
  }[];
}

export interface RegisterMap {
  readonly id: string;
  readonly registers: readonly Register[];
}

export interface RawReading {
  readonly values: ReadonlyMap<number, number>;
  readonly receivedAt: number;
}

export function record(value: unknown, operation: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AguaError('protocol', operation);
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, operation: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AguaError('protocol', operation);
  }
  return value;
}

export function list(value: unknown, operation: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new AguaError('protocol', operation);
  }
  return value;
}

export function integer(value: unknown, operation: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new AguaError('protocol', operation);
  }
  return value;
}

export function deviceReference(value: DeviceReference): DeviceReference {
  return {
    id_device: text(value.id_device, 'device-reference'),
    id_product: text(value.id_product, 'device-reference'),
  };
}

export function devices(value: unknown): readonly AguaDevice[] {
  const operation = 'deviceList';
  return list(record(value, operation).device, operation).map((item) => {
    const device = record(item, operation);
    if (typeof device.is_online !== 'boolean'
      || (device.deleted !== undefined && typeof device.deleted !== 'boolean')) {
      throw new AguaError('protocol', operation);
    }
    return Object.freeze({
      id_device: text(device.id_device, operation),
      id_product: text(device.id_product, operation),
      name: text(device.name, operation),
      is_online: device.is_online,
      ...(typeof device.deleted === 'boolean' ? { deleted: device.deleted } : {}),
    });
  });
}

export function registers(value: unknown, mapId: string): RegisterMap {
  const operation = 'deviceGetRegistersMap';
  const maps = record(value, operation).device_registers_map;
  if (maps === null) {
    throw new AguaError('unavailable', operation);
  }
  const matches = list(record(maps, operation).registers_map, operation)
    .map((item) => record(item, operation))
    .filter((item) => item.id === mapId);
  const selected = matches[0];
  if (matches.length !== 1 || selected === undefined) {
    throw new AguaError('protocol', operation);
  }
  const keys = new Set<string>();
  const parsed = list(selected.registers, operation).map((item) => {
    const register = record(item, operation);
    const key = text(register.reg_key, operation);
    if (keys.has(key) || (register.readonly !== undefined && typeof register.readonly !== 'boolean')) {
      throw new AguaError('protocol', operation);
    }
    keys.add(key);
    const offset = integer(register.offset, operation);
    const mask = integer(register.mask, operation);
    if (offset < 0 || mask < 0 || typeof register.formula !== 'string') {
      throw new AguaError('protocol', operation);
    }
    for (const field of ['set_min', 'set_max', 'step'] as const) {
      if (register[field] !== undefined
        && (typeof register[field] !== 'number' || !Number.isFinite(register[field]))) {
        throw new AguaError('protocol', operation);
      }
    }
    for (const field of ['is_word', 'big_endian', 'with_sign'] as const) {
      if (register[field] !== undefined && typeof register[field] !== 'boolean') {
        throw new AguaError('protocol', operation);
      }
    }
    if (register.formula_inverse !== undefined && typeof register.formula_inverse !== 'string') {
      throw new AguaError('protocol', operation);
    }
    const encVal = register.enc_val === undefined ? undefined : list(register.enc_val, operation).map((item) => {
      const entry = record(item, operation);
      if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
        throw new AguaError('protocol', operation);
      }
      return Object.freeze({
        value: entry.value, lang: text(entry.lang, operation), description: text(entry.description, operation),
      });
    });
    return Object.freeze({
      reg_key: key,
      reg_type: text(register.reg_type, operation),
      offset,
      mask,
      formula: register.formula,
      ...(typeof register.readonly === 'boolean' ? { readonly: register.readonly } : {}),
      ...(typeof register.formula_inverse === 'string' ? { formula_inverse: register.formula_inverse } : {}),
      ...(typeof register.set_min === 'number' ? { set_min: register.set_min } : {}),
      ...(typeof register.set_max === 'number' ? { set_max: register.set_max } : {}),
      ...(typeof register.step === 'number' ? { step: register.step } : {}),
      ...(typeof register.is_word === 'boolean' ? { is_word: register.is_word } : {}),
      ...(typeof register.big_endian === 'boolean' ? { big_endian: register.big_endian } : {}),
      ...(typeof register.with_sign === 'boolean' ? { with_sign: register.with_sign } : {}),
      ...(encVal === undefined ? {} : { enc_val: Object.freeze(encVal) }),
    });
  });
  return Object.freeze({ id: mapId, registers: Object.freeze(parsed) });
}

export function jobReading(value: unknown, receivedAt: number): RawReading | undefined {
  const operation = 'deviceJobStatus';
  const response = record(value, operation);
  const state = text(response.jobAnswerStatus, operation);
  if (state === 'waiting') {
    return undefined;
  }
  if (state === 'terminated' || state === 'Missing job' || state === 'Missing job answer') {
    throw new AguaJobUnavailableError(state);
  }
  if (state !== 'completed') {
    throw new AguaError('protocol', operation);
  }
  const typeOf = (input: unknown): string => input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input;
  const rawData = response.jobAnswerData;
  const details = typeof rawData === 'object' && rawData !== null && !Array.isArray(rawData)
    ? record(rawData, operation) : {};
  const structure = {
    dataType: typeOf(rawData),
    payloadType: typeOf(response.jobAnswerPayload),
    itemsType: typeOf(details.Items),
    valuesType: typeOf(details.Values),
    ...(Array.isArray(details.Items) ? { itemCount: details.Items.length } : {}),
    ...(Array.isArray(details.Values) ? { valueCount: details.Values.length } : {}),
  };
  // The additional payload stays opaque; only jobAnswerData supplies reading values.
  if (response.jobAnswerData === undefined) {
    throw new AguaReadingProtocolError('unsupported-envelope', structure);
  }
  try {
    return parseReadingData(rawData, receivedAt);
  } catch (error) {
    if (error instanceof AguaError && error.kind === 'protocol') {
      throw new AguaReadingProtocolError('invalid-values', structure);
    }
    throw error;
  }
}

function parseReadingData(input: unknown, receivedAt: number): RawReading {
  const operation = 'deviceJobStatus';
  const data = record(input, operation);
  const items = list(data.Items, operation);
  const values = list(data.Values, operation);
  if (items.length !== values.length || items.length === 0) {
    throw new AguaError('protocol', operation);
  }
  const result = new Map<number, number>();
  for (let index = 0; index < items.length; index++) {
    const offset = integer(items[index], operation);
    const value = integer(values[index], operation);
    if (offset < 0 || result.has(offset)) {
      throw new AguaError('protocol', operation);
    }
    result.set(offset, value);
  }
  return Object.freeze({ values: result, receivedAt });
}

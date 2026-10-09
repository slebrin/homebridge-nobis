export interface ShapeEntry {
  readonly path: string;
  readonly type: string;
}

export type BufferIndexesObservation =
  | { readonly status: 'absent' | 'invalid' }
  | { readonly status: 'observed'; readonly bufferCount: number; readonly indexes: readonly number[] };

export function observeBufferIndexes(input: Record<string, unknown>): BufferIndexesObservation {
  const data = input.jobAnswerData;
  if (typeof data !== 'object' || data === null || Array.isArray(data)
    || (!('BufferCnt' in data) && !('Indexes' in data))) {
    return { status: 'absent' };
  }
  const count = 'BufferCnt' in data ? data.BufferCnt : undefined;
  const indexes = 'Indexes' in data ? data.Indexes : undefined;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0
    || !Array.isArray(indexes) || indexes.length > 256
    || !indexes.every((value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    || count !== indexes.length || new Set(indexes).size !== indexes.length) {
    return { status: 'invalid' };
  }
  return { status: 'observed', bufferCount: count, indexes };
}

export type NackObservation =
  | { readonly status: 'absent' | 'invalid' }
  | { readonly status: 'observed'; readonly value: number };

export function observeNackCode(input: Record<string, unknown>): NackObservation {
  const data = input.jobAnswerData;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { status: 'absent' };
  }
  if (!('NackErrCode' in data)) {
    return { status: 'absent' };
  }
  const value = data.NackErrCode;
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? { status: 'observed', value } : { status: 'invalid' };
}

export function describeResponseShape(input: unknown): { fields: ShapeEntry[]; truncated: boolean } {
  const fields: ShapeEntry[] = [];
  let truncated = false;
  const visit = (value: unknown, path: string, depth: number): void => {
    if (fields.length >= 200 || depth > 8) {
      truncated = true;
      return;
    }
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    fields.push({ path, type });
    if (Array.isArray(value)) {
      // Inspect a bounded sample, never disclose scalar values.
      for (const entry of value.slice(0, 3)) {
        visit(entry, `${path}[]`, depth + 1);
      }
      if (value.length > 3) {
        truncated = true;
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, entry] of Object.entries(value)) {
        if (/password|token|email|cookie|authorization|security|serial|mac|id_device|id_product|id_app|idRequest/i.test(key)) {
          continue;
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) {
          truncated = true;
          continue;
        }
        visit(entry, `${path}.${key}`, depth + 1);
      }
    }
  };
  visit(input, '$', 0);
  return { fields, truncated };
}

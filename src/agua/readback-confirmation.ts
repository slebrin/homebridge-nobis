import { setTimeout as delay } from 'node:timers/promises';
import type { RawReading } from './models.js';

export async function confirmReading<T>(
  read: () => Promise<RawReading>,
  decode: (reading: RawReading) => T,
  matches: (value: T) => boolean,
  signal: AbortSignal,
  wait: (signal: AbortSignal) => Promise<void> = async signal => {
    await delay(5000, undefined, { signal });
  },
) {
  const observations: T[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    if (attempt > 0) {
      await wait(signal);
      signal.throwIfAborted();
    }
    const reading = await read();
    signal.throwIfAborted();
    const value = decode(reading);
    observations.push(value);
    const readbackMatches = matches(value);
    if (readbackMatches || attempt === 2) {
      return { value, readbackMatches, observations };
    }
  }
  throw new Error('Unreachable confirmation state');
}

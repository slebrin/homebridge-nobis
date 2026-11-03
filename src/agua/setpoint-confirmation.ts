import { AguaError } from './errors.js';
import type { RawReading } from './models.js';
import { readSetpointValue } from './command-preview.js';
import { confirmReading } from './readback-confirmation.js';

export async function confirmSetpoint(
  read: () => Promise<RawReading>,
  target: number,
  signal: AbortSignal,
  wait?: (signal: AbortSignal) => Promise<void>,
) {
  if (!Number.isSafeInteger(target) || target < 7 || target > 40) {
    throw new AguaError('configuration', 'setpoint-confirmation');
  }
  const confirmation = await confirmReading(read, reading => {
    const celsius = readSetpointValue(reading);
    if (celsius === 41) {
      throw new AguaError('protocol', 'setpoint-readback');
    }
    return { celsius, receivedAt: reading.receivedAt };
  }, value => value.celsius === target, signal, wait);
  return {
    observedCelsius: confirmation.value.celsius,
    receivedAt: confirmation.value.receivedAt,
    readbackMatches: confirmation.readbackMatches,
    observations: confirmation.observations,
  };
}

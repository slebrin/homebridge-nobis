import { AguaError } from './errors.js';

export const VENTILATION_PERCENTAGES = Object.freeze([14, 29, 43, 57, 71, 86, 100]);

export function ventilationPercentage(level: number): number {
  const value = VENTILATION_PERCENTAGES[level - 1];
  if (!Number.isSafeInteger(level) || value === undefined) {
    throw new AguaError('configuration', 'ventilation-scale');
  }
  return value;
}

export function ventilationLevel(percentage: number): number {
  if (!Number.isFinite(percentage) || percentage < 1 || percentage > 100) {
    throw new AguaError('configuration', 'ventilation-scale');
  }
  return Math.max(1, Math.round(percentage * 7 / 100));
}

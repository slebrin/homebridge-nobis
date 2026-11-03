import assert from 'node:assert/strict';
import test from 'node:test';
import { observeOperatingSettings } from '../dist/agua/operating-settings.js';

const settingsRegisters = [
  ['power_set', 33120, 1, 7, []],
  ['vent_front_set', 33132, 0, 8, [[0, 'OFF'], [8, 'PS']]],
  ['fun_auto_set', 33128, 0, 1, [[0, 'OFF'], [1, 'ON']]],
  ['fun_pwf_set', 33154, 0, 1, [[0, 'OFF'], [1, 'ON'], [2, 'CRONO']]],
].map(([reg_key, offset, set_min, set_max, labels]) => ({
  reg_key, offset, set_min, set_max, reg_type: 'SET', readonly: false,
  mask: 65535, formula: '#', formula_inverse: '#', step: 1,
  is_word: true, big_endian: false, with_sign: false,
  enc_val: labels.map(([value, description]) => ({ value, description, lang: 'FRE' })),
}));
const map = { id: 'fictional', registers: settingsRegisters };
const reading = { receivedAt: 123, values: new Map([[33120, 5], [33132, 4], [33128, 0], [33154, 0], [16, 0], [11, 5]]) };

test('observes only four actual setpoints, not effective fan/power or control capabilities', () => {
  const result = observeOperatingSettings(map, reading);
  assert.equal(result.freshness, 'unknown');
  assert.equal(result.controlValidated, false);
  assert.deepEqual(result.registers.map(x => [x.offset, x.rawValue, x.label]), [
    [33120, 5, null], [33132, 4, null], [33128, 0, 'OFF'], [33154, 0, 'OFF'],
  ]);
  assert(Object.isFrozen(result.registers));
  assert.equal('active' in result, false);
  const sample = { ...reading, values: new Map([[33120, 7], [33132, 8], [33128, 1], [33154, 1]]) };
  assert.equal(observeOperatingSettings(map, sample).registers[1].label, 'PS');
});

test('rejects changed profiles, ambiguous labels and absent registers without guessing', () => {
  for (const registers of [
    settingsRegisters.slice(1), [...settingsRegisters, settingsRegisters[0]],
    ...[{ mask: 255 }, { offset: 33121 }, { reg_type: 'GET' }, { formula: '#/2' },
      { formula_inverse: '#*2' }, { readonly: true }, { set_min: 0 }, { set_max: 8 },
      { step: 0.5 }, { is_word: false }, { big_endian: true }, { with_sign: true }]
      .map(change => [{ ...settingsRegisters[0], ...change }, ...settingsRegisters.slice(1)]),
    [settingsRegisters[0], settingsRegisters[1], { ...settingsRegisters[2],
      enc_val: [{ value: 0, lang: 'FRE', description: 'OFF' }, { value: 0, lang: 'FRE', description: 'ON' }] }, settingsRegisters[3]],
  ]) {
    assert.throws(() => observeOperatingSettings({ ...map, registers }, reading), { operation: 'operating-settings' });
  }
});

test('rejects Powerful CRONO, missing/out-of-range values and invalid dates explicitly', () => {
  for (const [offset, value] of [[33120, 0], [33120, 8], [33132, -1], [33132, 9],
    [33128, 2], [33154, 2], [33154, 0.5], [33120, NaN], [33120, undefined]]) {
    assert.throws(() => observeOperatingSettings(map, { ...reading, values: new Map(reading.values).set(offset, value) }),
      { operation: 'operating-settings' });
  }
  for (const receivedAt of [-1, NaN, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => observeOperatingSettings(map, { ...reading, receivedAt }), { operation: 'operating-settings' });
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { observeNobisStatus } from '../dist/agua/status-observation.js';

const phase = {
  reg_key: 'status_get', reg_type: 'GET', offset: 8, mask: 65535, formula: '#',
  is_word: false,
  enc_val: [{ value: 0, lang: 'FRE', description: 'OFF' }, { value: 5, lang: 'FRE', description: 'TRAVAIL' }],
};
const managed = {
  reg_key: 'status_managed_get', reg_type: 'GET', offset: 232, mask: 255, formula: '#',
  enc_val: [{ value: 85, lang: 'FRE', description: 'ON' }, { value: 170, lang: 'FRE', description: 'OFF' }],
};
const map = { id: 'fictional', registers: [phase, managed] };
const reading = (status = 0, requested = 0) => ({
  receivedAt: 123, values: new Map([[8, status], [232, requested], [103, 20]]),
});

test('status observations retain raw codes, exact FRE labels and unknown managed zero without a heating state', () => {
  const result = observeNobisStatus(map, reading());
  assert.deepEqual(result, {
    receivedAt: 123, freshness: 'unknown',
    phase: { kind: 'off', code: 0 },
    registers: [
      { key: 'status_get', offset: 8, rawValue: 0, label: 'OFF' },
      { key: 'status_managed_get', offset: 232, rawValue: 0, label: null },
    ],
  });
  assert.equal('active' in result, false);
  assert.equal(observeNobisStatus(map, reading(5, 85)).registers[0].label, 'TRAVAIL');
  assert.equal(observeNobisStatus(map, reading(5, 170)).registers[1].label, 'OFF');
  assert.equal(observeNobisStatus(map, reading(255)).registers[0].label, null);
  const foreign = { ...phase, enc_val: [{ value: 0, lang: 'ENG', description: 'Off' }] };
  assert.equal(observeNobisStatus({ ...map, registers: [foreign, managed] }, reading()).registers[0].label, null);
});

test('only the five physically compared exact pairs produce typed phases, stopping and eco-stop are never off', () => {
  const entries = [
    [0, 'OFF', 'off'],
    [2, 'D\u00c9BUT', 'starting'],
    [5, 'TRAVAIL', 'working'],
    [7, 'ARR\u00caT', 'stopping'],
    [8, 'ECO STOP', 'eco-stop'],
  ];
  const comparedMap = { ...map, registers: [
    { ...phase, enc_val: entries.map(([value, description]) => ({ value, description, lang: 'FRE' })) },
    managed,
  ] };
  for (const [code, , kind] of entries) {
    const result = observeNobisStatus(comparedMap, reading(code, 0));
    assert.deepEqual(result.phase, { kind, code });
    assert.equal(Object.isFrozen(result.phase), true);
    assert.equal('active' in result.phase, false);
    assert.equal('heating' in result.phase, false);
    assert.equal(result.registers[1].label, null);
  }
});

test('unobserved phases and missing, foreign or changed labels remain explicitly unknown', () => {
  for (const code of [1, 3, 4, 6, 9, 10, 11, 255]) {
    const candidate = { ...phase, enc_val: [{ value: code, lang: 'FRE', description: 'OFF' }] };
    assert.deepEqual(observeNobisStatus({ ...map, registers: [candidate, managed] }, reading(code)).phase,
      { kind: 'unknown', code, reason: 'unvalidated-code' });
  }
  for (const [code, description, lang] of [
    [0, 'Off', 'FRE'], [2, 'DEBUT', 'FRE'], [5, 'OFF', 'FRE'], [7, 'ARRET', 'FRE'], [0, 'OFF', 'ENG'],
    [8, 'Eco Stop', 'FRE'], [8, 'ECO STOP', 'ENG'],
  ]) {
    const candidate = { ...phase, enc_val: [{ value: code, lang, description }] };
    assert.deepEqual(observeNobisStatus({ ...map, registers: [candidate, managed] }, reading(code)).phase,
      { kind: 'unknown', code, reason: 'label-mismatch' });
  }
  assert.equal(observeNobisStatus(map, reading(2)).phase.reason, 'label-mismatch');
});

test('status observations reject missing, duplicate or incompatible profiles without correcting masks', () => {
  for (const registers of [
    [phase], [phase, managed, phase],
    [{ ...phase, offset: 9 }, managed],
    [{ ...phase, formula: '#/10' }, managed],
    [phase, { ...managed, mask: 65535 }],
    [{ ...phase, reg_type: 'SET' }, managed],
    [{ ...phase, enc_val: [...phase.enc_val, { value: 0, lang: 'FRE', description: 'OTHER' }] }, managed],
  ]) {
    assert.throws(() => observeNobisStatus({ ...map, registers }, reading()), { operation: 'status-observation' });
  }
});

test('status observations reject missing, invalid or out-of-range integers and invalid reception times', () => {
  for (const sample of [
    { ...reading(), values: new Map([[8, 0]]) },
    reading(-1), reading(65536), reading(0, 256), reading(0, 0.5),
    { ...reading(), receivedAt: NaN }, { ...reading(), receivedAt: -1 },
    { ...reading(), receivedAt: Number.MAX_SAFE_INTEGER },
  ]) {
    assert.throws(() => observeNobisStatus(map, sample), { operation: 'status-observation' });
  }
});

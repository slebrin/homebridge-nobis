import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePack } from '../scripts/check-package.js';

const manifest = {
  name: 'homebridge-nobis', version: '0.1.0-beta.13',
  main: 'dist/index.js', types: 'dist/index.d.ts',
};
const expected = ['package.json', 'dist/index.js', 'dist/index.d.ts'];

function fixture() {
  return [{
    name: manifest.name, version: manifest.version,
    files: expected.map(path => ({ path, size: 100 })),
  }];
}

test('package validation accepts exactly the expected non-empty files', () => {
  assert.equal(validatePack(fixture(), manifest, expected), expected.length);
});

test('package validation rejects private, development and stale compiled files', () => {
  for (const path of [
    '.env', '.npmrc', 'config.json', 'homebridge-nobis/appid',
    'dist/power-pending-private', 'dist/obsolete.js',
    'docs/private.md', 'test/config.test.js', 'node_modules/example/index.js',
    '../config.json',
  ]) {
    const pack = fixture();
    pack[0].files.push({ path, size: 100 });
    assert.throws(() => validatePack(pack, manifest, expected), /Unexpected file/);
  }
});

test('package validation rejects every missing required file', () => {
  for (const missing of expected) {
    const pack = fixture();
    pack[0].files = pack[0].files.filter(file => file.path !== missing);
    assert.throws(() => validatePack(pack, manifest, expected), /Missing required/);
  }
});

test('package validation rejects duplicates, empty files and malformed sizes', () => {
  const duplicate = fixture();
  duplicate[0].files.push(duplicate[0].files[0]);
  assert.throws(() => validatePack(duplicate, manifest, expected), /Duplicate or empty/);
  for (const size of [0, -1, 1.5, null, '100']) {
    const pack = fixture();
    pack[0].files[0].size = size;
    assert.throws(() => validatePack(pack, manifest, expected), /Duplicate or empty/);
  }
});

test('package validation rejects malformed metadata and unsynchronized versions', () => {
  for (const pack of [null, [], [null], [fixture()[0], fixture()[0]], [{}]]) {
    assert.throws(() => validatePack(pack, manifest, expected));
  }
  for (const [key, value] of [['name', 'another-package'], ['version', '0.0.0'], ['files', null]]) {
    const pack = fixture();
    pack[0][key] = value;
    assert.throws(() => validatePack(pack, manifest, expected), /metadata or version/);
  }
});

test('package validation requires the declared runtime and type entry points', () => {
  for (const key of ['main', 'types']) {
    assert.throws(() => validatePack(fixture(), {
      ...manifest, [key]: 'dist/missing.js',
    }, expected), /entry points/);
  }
});

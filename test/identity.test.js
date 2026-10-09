import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadAppIdentity } from '../dist/agua/identity.js';
import { AguaError } from '../dist/agua/errors.js';

async function storage(context) {
  const directory = await mkdtemp(join(tmpdir(), 'homebridge-nobis-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('application UUID is private, persisted and stable across restarts', async (context) => {
  const root = await storage(context);
  const id = await loadAppIdentity(root);
  assert.equal(await loadAppIdentity(root), id);
  assert.match(id, /^[a-f0-9-]{36}$/);
  const directory = join(root, 'homebridge-nobis');
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(directory, 'app-id'))).mode & 0o777, 0o600);
  assert.equal(await readFile(join(directory, 'app-id'), 'utf8'), id);
});

test('corrupt stored identity is not silently replaced', async (context) => {
  const root = await storage(context);
  const directory = join(root, 'homebridge-nobis');
  await mkdir(directory);
  await writeFile(join(directory, 'app-id'), 'invalid');
  await assert.rejects(loadAppIdentity(root), AguaError);
  assert.equal(await readFile(join(directory, 'app-id'), 'utf8'), 'invalid');
});

test('identity directory and file symlinks are refused', async (context) => {
  const root = await storage(context);
  const outside = join(root, 'outside');
  await mkdir(outside);
  const directory = join(root, 'homebridge-nobis');
  await symlink(outside, directory);
  await assert.rejects(loadAppIdentity(root), AguaError);
  await rm(directory);
  await mkdir(directory);
  const outsideFile = join(outside, 'app-id');
  await writeFile(outsideFile, 'unchanged');
  await symlink(outsideFile, join(directory, 'app-id'));
  await assert.rejects(loadAppIdentity(root), AguaError);
  assert.equal(await readFile(outsideFile, 'utf8'), 'unchanged');
});

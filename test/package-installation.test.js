import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

import { HomebridgeAPI, PluginManager } from './homebridge-api.js';

test('actual npm archive loads with Homebridge and stays offline until configured and enabled', async context => {
  const root = await mkdtemp(join(tmpdir(), 'nobis-package-installation-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const project = fileURLToPath(new URL('../', import.meta.url));
  const output = execFileSync('npm', [
    'pack', '--ignore-scripts', '--json', '--pack-destination', root,
  ], { cwd: project, encoding: 'utf8', timeout: 120_000 });
  const [pack] = JSON.parse(output);
  assert.match(pack.filename, /^homebridge-nobis-[\w.-]+\.tgz$/);
  execFileSync('tar', ['-xzf', join(root, pack.filename), '-C', root], { timeout: 30_000 });
  const installed = join(root, 'package');
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'homebridge-nobis');
  assert.equal((await readdir(installed)).includes('node_modules'), false);
  assert.equal((await readdir(installed)).includes('src'), false);
  const requests = [];
  context.mock.method(globalThis, 'fetch', async (...args) => {
    requests.push(args);
    assert.fail('An unconfigured or disabled installed plugin must not contact the cloud.');
  });

  for (const [name, config, warning] of [
    ['unconfigured', { platform: 'Nobis' }, true],
    ['cloud disabled', {
      platform: 'Nobis', email: 'reader@example.invalid', password: 'fictional-password',
      enableCloud: false,
    }, false],
    ['invalid dependencies', {
      platform: 'Nobis', email: 'reader@example.invalid', password: 'fictional-password',
      enableCloud: false, enablePowerSwitch: true,
    }, true],
  ]) {
    await context.test(name, async () => {
      const storage = join(root, name);
      await mkdir(storage);
      const api = new HomebridgeAPI();
      api.user = { storagePath: () => storage };
      const manager = new PluginManager(api, {
        customPluginPath: installed, strictPluginResolution: true,
        activePlugins: [manifest.name],
      });
      await manager.initializeInstalledPlugins();
      const plugin = manager.getPlugin(manifest.name);
      assert(plugin, 'Homebridge must discover the extracted npm package');
      assert.equal(plugin.getPluginPath(), installed);
      const Platform = plugin.getPlatformConstructor('Nobis');
      const logs = [];
      const warnings = [];
      const log = {
        info: message => logs.push(message), warn: message => warnings.push(message),
        debug: () => assert.fail('No cloud diagnostics expected'),
      };
      const platform = new Platform(log, config, api);
      assert.equal(typeof platform.configureAccessory, 'function');
      context.after(() => api.emit('shutdown'));
      api.emit('didFinishLaunching');
      api.emit('didFinishLaunching');
      await setImmediate();
      api.emit('shutdown');
      api.emit('didFinishLaunching');
      await setImmediate();
      assert.equal(requests.length, 0);
      assert.deepEqual(await readdir(storage), []);
      assert.equal(warnings.length, warning ? 1 : 0);
      assert.equal(logs.length, warning ? 0 : 1);
      if (!warning) {
        assert.match(logs[0], /cloud discovery is disabled/);
      }
      assert.equal(JSON.stringify([...logs, ...warnings]).includes('fictional-password'), false);
    });
  }
});

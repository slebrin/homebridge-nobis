import { createRequire } from 'node:module';
import { pathToFileURL, URL } from 'node:url';

const require = createRequire(import.meta.url);
// The API constructor is internal: lib/api.js in v1, dist/api.js in v2.
const entry = pathToFileURL(require.resolve('homebridge'));
export const { HomebridgeAPI } = await import(new URL('./api.js', entry).href);
export const { PluginManager } = await import(new URL('./pluginManager.js', entry).href);

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';

import { AguaError } from './errors.js';

export async function loadAppIdentity(homebridgeStoragePath: string): Promise<string> {
  if (homebridgeStoragePath.trim().length === 0) {
    throw new AguaError('configuration', 'identity');
  }
  const directory = join(homebridgeStoragePath, 'homebridge-nobis');
  const file = join(directory, 'app-id');
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new AguaError('storage', 'identity');
    }
    await chmod(directory, 0o700);
    let created = false;
    let handle;
    try {
      handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created = true;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
        throw error;
      }
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 100) {
        throw new AguaError('storage', 'identity');
      }
      await handle.chmod(0o600);
      if (created) {
        const id = randomUUID();
        await handle.writeFile(id, 'utf8');
        await handle.sync();
        return id;
      }
      const id = await handle.readFile('utf8');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new AguaError('storage', 'identity');
      }
      return id;
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw error instanceof AguaError ? error : new AguaError('storage', 'identity');
  }
}

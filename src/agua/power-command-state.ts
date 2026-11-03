import { constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { AguaError } from './errors.js';
import type { PowerAction } from './power-preview.js';

export function hasPendingCommand(context: Record<string, unknown>): boolean {
  return ['pendingPowerAction', 'pendingSetpoint', 'pendingVentilation', 'pendingPowerful', 'pendingAuto', 'pendingChrono']
    .some(key => context[key] !== undefined);
}

class CommandState<T extends string | number> {
  constructor(
    private readonly storagePath: string,
    private readonly prefix: string,
    private readonly parse: (value: string) => T,
  ) {}

  private async path(uuid: string): Promise<string> {
    if (!/^[0-9a-f-]{36}$/i.test(uuid)) {
      throw new AguaError('storage', 'power-command-state');
    }
    const directory = join(this.storagePath, 'homebridge-nobis');
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new AguaError('storage', 'power-command-state');
    }
    return join(directory, `${this.prefix}-pending-${uuid}`);
  }

  async load(uuid: string): Promise<T | undefined> {
    try {
      const path = await this.path(uuid);
      let handle;
      try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 3) {
          throw new AguaError('storage', 'power-command-state');
        }
        return this.parse(await handle.readFile('utf8'));
      } finally {
        await handle.close();
      }
    } catch {
      throw new AguaError('storage', 'power-command-state');
    }
  }

  async begin(uuid: string, action: T): Promise<void> {
    try {
      const value = String(action);
      this.parse(value);
      const handle = await open(await this.path(uuid),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await handle.writeFile(value, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.syncDirectory();
    } catch {
      throw new AguaError('storage', 'power-command-state');
    }
  }

  async complete(uuid: string): Promise<void> {
    try {
      await unlink(await this.path(uuid));
      await this.syncDirectory();
    } catch {
      throw new AguaError('storage', 'power-command-state');
    }
  }

  private async syncDirectory(): Promise<void> {
    const handle = await open(join(this.storagePath, 'homebridge-nobis'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

}

export class PowerCommandState extends CommandState<PowerAction> {
    constructor(storagePath: string) {
      super(storagePath, 'power', value => {
        if (value !== 'on' && value !== 'off') {
          throw new AguaError('storage', 'power-command-state');
        }
        return value;
      });
    }
  }

export class SetpointCommandState extends CommandState<number> {
    constructor(storagePath: string) {
      super(storagePath, 'setpoint', value => {
        const celsius = Number(value);
        if (!/^\d{1,2}$/.test(value) || String(celsius) !== value
          || !Number.isSafeInteger(celsius) || celsius < 7 || celsius > 40) {
          throw new AguaError('storage', 'power-command-state');
        }
        return celsius;
      });
    }
}

export class VentilationCommandState extends CommandState<number> {
  constructor(storagePath: string) {
    super(storagePath, 'ventilation', value => {
      if (!/^[1-7]$/.test(value)) {
        throw new AguaError('storage', 'power-command-state');
      }

      return Number(value);
    });
  }
}

export class PowerfulCommandState extends CommandState<number> {
  constructor(storagePath: string) {
    super(storagePath, 'powerful', parseModeTarget);
  }
}

export class AutoCommandState extends CommandState<number> {
  constructor(storagePath: string) {
    super(storagePath, 'auto', parseModeTarget);
  }
}

export class AbandonConfirmationState extends CommandState<1> {
  constructor(storagePath: string) {
    super(storagePath, 'abandon-confirmation', value => {
      if (value !== '1') {
        throw new AguaError('storage', 'power-command-state');
      }
      return 1;
    });
  }
}

export class ChronoCommandState extends CommandState<number> {
  constructor(storagePath: string) {
    super(storagePath, 'chrono', parseModeTarget);
  }
}

function parseModeTarget(value: string): number {
  if (value !== '0' && value !== '1') {
    throw new AguaError('storage', 'power-command-state');
  }
  return Number(value);
}

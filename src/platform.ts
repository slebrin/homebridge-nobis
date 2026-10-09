import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import { AguaClient } from './agua/client.js';
import { AguaError } from './agua/errors.js';
import { loadAppIdentity } from './agua/identity.js';
import { ConfigError, parseConfig } from './config.js';
import type { NobisConfig } from './config.js';
import { decodeNobisAmbientTemperature } from './agua/temperature.js';
import type { AguaDevice } from './agua/models.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { TemperatureAccessory } from './temperature-accessory.js';

export function reconnectDelay(intervalMs: number, failures: number, random = Math.random()): number {
  return Math.max(intervalMs, Math.min(900_000, intervalMs * 2 ** Math.min(failures, 10) * (0.75 + random * 0.25)));
}

export class NobisPlatform implements DynamicPlatformPlugin {
  private readonly accessories = new Map<string, PlatformAccessory>();
  private client: AguaClient | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private started = false;
  private failures = 0;
  private readonly sensors = new Map<string, TemperatureAccessory>();

  constructor(
    private readonly log: Logging,
    config: PlatformConfig,
    private readonly api: API,
  ) {
    let settings: NobisConfig;
    try {
      settings = parseConfig(config);
    } catch (error) {
      if (error instanceof ConfigError) {
        this.log.warn(error.message);
        return;
      }
      throw error;
    }

    api.on('didFinishLaunching', () => {
      if (this.started || this.stopped) {
        return;
      }
      this.started = true;
      if (!settings.enableTemperatureSensor) {
        this.removeAccessories(api);
      } else {
        for (const accessory of this.accessories.values()) {
          this.sensors.set(accessory.UUID, new TemperatureAccessory(accessory, api, settings.stoveName ?? 'Nobis'));
          api.updatePlatformAccessories([accessory]);
        }
      }
      if (!settings.enableCloud) {
        this.log.info('Read-only cloud discovery is disabled. Enable it explicitly in plugin settings. No HomeKit accessory is exposed.');
        return;
      }
      void this.start(settings, api);
    });
    api.on('shutdown', () => {
      this.stopped = true;
      clearTimeout(this.timer);
      this.client?.close();
      this.markUnavailable();
      this.accessories.clear();
      this.sensors.clear();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
    if (accessory.getService(this.api.hap.Service.TemperatureSensor) !== undefined) {
      this.sensors.set(accessory.UUID, new TemperatureAccessory(accessory, this.api, accessory.displayName));
    }
  }

  private async start(settings: NobisConfig, api: API): Promise<void> {
    try {
      const appId = await loadAppIdentity(api.user.storagePath());
      if (this.stopped) {
        return;
      }
      this.client = new AguaClient({
        email: settings.email, password: settings.password, appId,
      }, settings.diagnostic ? {
        diagnostic: (event) => this.log.debug(
          `Agua-IoT ${event.operation}: ${event.durationMs}ms HTTP ${event.status ?? '-'} ${event.errorKind ?? ''}`,
        ),
      } : {});
      this.log.info(settings.enableTemperatureSensor
        ? 'Starting experimental read-only temperature sensor. Measurement freshness is unknown; no stove control or heating state.'
        : 'Starting read-only cloud discovery. No stove command, buffer configuration or HomeKit accessory will be sent.');
      await this.poll(settings, api);
    } catch (error) {
      this.report(error);
    }
  }

  private async poll(settings: NobisConfig, api: API): Promise<void> {
    if (this.stopped || this.client === undefined) {
      return;
    }
    let wait = settings.pollIntervalSeconds * 1000;
    try {
      const devices = (await this.client.getDevices()).filter((device) => !device.deleted);
      const selected = settings.deviceId === undefined
        ? devices : devices.filter((device) => device.id_device === settings.deviceId);
      if (selected.length !== 1 || selected[0] === undefined) {
        this.markUnavailable();
        this.log.warn('Cloud discovery requires exactly one stove. Check the account or select a device ID locally. No accessory is created.');
        return;
      }
      if (!selected[0].is_online) {
        throw new AguaError('unavailable', 'device-offline');
      }
      const map = await this.client.getRegisterMap(selected[0]);
      if (settings.enableTemperatureSensor) {
        const reading = await this.client.readBuffer(selected[0], 1);
        if (this.stopped) {
          return;
        }
        const temperature = decodeNobisAmbientTemperature(map, reading, 1);
        // Reject out-of-range values before registering a new accessory.
        TemperatureAccessory.validate(api, temperature);
        this.temperatureSensor(selected[0], settings, api).update(temperature);
      }
      if (this.stopped) {
        return;
      }
      if (this.failures > 0 || settings.diagnostic) {
        this.log.info(`Read-only discovery successful: ${map.registers.length} register definitions. No thermal state or command is exposed.`);
      }
      this.failures = 0;
    } catch (error) {
      if (this.stopped) {
        return;
      }
      this.report(error);
      this.markUnavailable();
      if (!(error instanceof AguaError)
        || error.kind === 'protocol' || error.kind === 'configuration' || error.kind === 'storage'
        || (error.status !== undefined && [401, 403, 404, 412, 422].includes(error.status))) {
        this.log.warn('Automatic discovery stopped. Resolve the configuration or protocol issue before restarting.');
        return;
      }
      wait = Math.max(reconnectDelay(wait, ++this.failures), error.retryAfterMs ?? 0);
    }
    if (!this.stopped) {
      if (wait > 2_147_483_647) {
        this.log.warn('Server retry delay exceeds the supported timer budget. Automatic discovery stopped rather than retrying early.');
        return;
      }
      this.timer = setTimeout(() => { void this.poll(settings, api); }, wait);
    }
  }

  private temperatureSensor(device: AguaDevice, settings: NobisConfig, api: API): TemperatureAccessory {
    const uuid = api.hap.uuid.generate(JSON.stringify([PLUGIN_NAME, device.id_product, device.id_device, 'temperature']));
    const existing = this.sensors.get(uuid);
    if (existing !== undefined) {
      this.removeAccessories(api, uuid);
      return existing;
    }
    const name = settings.stoveName ?? 'Nobis';
    const accessory = new api.platformAccessory(name, uuid);
    const sensor = new TemperatureAccessory(accessory, api, name);
    api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.accessories.set(uuid, accessory);
    this.sensors.set(uuid, sensor);
    this.removeAccessories(api, uuid);
    return sensor;
  }

  private removeAccessories(api: API, keep?: string): void {
    const stale = [...this.accessories.values()].filter(accessory => accessory.UUID !== keep);
    if (stale.length > 0) {
      api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      for (const accessory of stale) {
        this.accessories.delete(accessory.UUID);
        this.sensors.delete(accessory.UUID);
      }
    }
  }

  private markUnavailable(): void {
    for (const sensor of this.sensors.values()) {
      sensor.markUnavailable();
    }
  }

  private report(error: unknown): void {
    if (!this.stopped) {
      this.log.warn(error instanceof AguaError ? error.message : 'Nobis read-only discovery failed unexpectedly; no private error detail is logged.');
    }
  }
}

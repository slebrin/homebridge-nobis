import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import { AguaClient } from './agua/client.js';
import { AguaError } from './agua/errors.js';
import { loadAppIdentity } from './agua/identity.js';
import { ConfigError, parseConfig } from './config.js';
import type { NobisConfig } from './config.js';
import { decodeNobisAmbientTemperature } from './agua/temperature.js';
import { observeNobisStatus } from './agua/status-observation.js';
import type { AguaDevice, RawReading, RegisterMap } from './agua/models.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { TemperatureAccessory } from './temperature-accessory.js';
import { PowerAccessory } from './power-accessory.js';
import { previewPower } from './agua/power-preview.js';
import { AbandonConfirmationState, AutoCommandState, ChronoCommandState, hasPendingCommand, PowerCommandState, PowerfulCommandState, SetpointCommandState, VentilationCommandState } from './agua/power-command-state.js';
import { HeatingAccessory } from './heating-accessory.js';
import { decodeSetpoint, previewSetpoint } from './agua/command-preview.js';
import { observeOperatingSettings } from './agua/operating-settings.js';
import { previewFrontVentilation } from './agua/ventilation-preview.js';
import { previewAuto, previewPowerful } from './agua/auto-preview.js';
import { OperatingModeAccessory, PowerfulAccessory } from './powerful-accessory.js';
import { observeChrono, previewChrono } from './agua/chrono.js';
import { EcoStopAccessory } from './eco-stop-accessory.js';

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
  private lastStatusDiagnostic: string | undefined;
  private readonly sensors = new Map<string, TemperatureAccessory>();
  private readonly ecoStops = new Map<string, EcoStopAccessory>();
  private readonly powers = new Map<string, PowerAccessory>();
  private controlDevice: AguaDevice | undefined;
  private commandInProgress = false;
  private powerState: PowerCommandState | undefined;
  private setpointState: SetpointCommandState | undefined;
  private ventilationState: VentilationCommandState | undefined;
  private powerfulState: PowerfulCommandState | undefined;
  private readonly powerfuls = new Map<string, PowerfulAccessory>();
  private autoState: AutoCommandState | undefined;
  private readonly autos = new Map<string, OperatingModeAccessory>();
  private chronoState: ChronoCommandState | undefined;
  private readonly chronos = new Map<string, OperatingModeAccessory>();
  private readonly heaters = new Map<string, HeatingAccessory>();
  private readonly resolvingPower = new Set<string>();
  private settings: NobisConfig | undefined;
  private polling = false;
  private quickReadsRemaining = 0;
  private abandonConfirmation: AbandonConfirmationState | undefined;
  private readonly checkedAbandonConfirmation = new Set<string>();

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
          this.sensors.set(accessory.UUID, new TemperatureAccessory(accessory, api, settings.stoveName ?? 'Nobis',
            !settings.enableSetpointControl));
          this.configurePower(accessory, settings);
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
      this.ecoStops.clear();
      this.powers.clear();
      this.heaters.clear();
      this.powerfuls.clear();
      this.autos.clear();
      this.chronos.clear();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
    if (accessory.getServiceById(this.api.hap.Service.ContactSensor, 'eco-stop') !== undefined) {
      this.ecoStops.set(accessory.UUID, new EcoStopAccessory(accessory, this.api, accessory.displayName));
    }
    if (accessory.getService(this.api.hap.Service.TemperatureSensor) !== undefined) {
      this.sensors.set(accessory.UUID, new TemperatureAccessory(accessory, this.api, accessory.displayName));
    }
    if (accessory.getServiceById(this.api.hap.Service.Switch, 'power') !== undefined) {
      this.powers.set(accessory.UUID, new PowerAccessory(accessory, this.api, accessory.displayName,
        async () => { throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); }));
    }
    if (accessory.getServiceById(this.api.hap.Service.Switch, 'powerful') !== undefined) {
      this.powerfuls.set(accessory.UUID, new PowerfulAccessory(accessory, this.api, accessory.displayName,
        async () => { throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); }));
    }
    if (accessory.getServiceById(this.api.hap.Service.Switch, 'auto') !== undefined) {
      this.autos.set(accessory.UUID, new OperatingModeAccessory(accessory, this.api, accessory.displayName,
        async () => { throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); }, 'auto'));
    }
    if (accessory.getServiceById(this.api.hap.Service.HeaterCooler, 'heating') !== undefined
      || accessory.getServiceById(this.api.hap.Service.Thermostat, 'heating') !== undefined) {
      const unavailable = async () => {
        throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      };
      this.heaters.set(accessory.UUID, new HeatingAccessory(accessory, this.api, accessory.displayName, unavailable, unavailable,
        accessory.getServiceById(this.api.hap.Service.HeaterCooler, 'heating')?.testCharacteristic(this.api.hap.Characteristic.RotationSpeed)
          ? unavailable : undefined));
    }
    if (accessory.getServiceById(this.api.hap.Service.Switch, 'chrono') !== undefined) {
      this.chronos.set(accessory.UUID, new OperatingModeAccessory(accessory, this.api, accessory.displayName,
        async () => { throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); }, 'chrono'));
    }
  }

  private async start(settings: NobisConfig, api: API): Promise<void> {
    this.settings = settings;
    try {
      const appId = await loadAppIdentity(api.user.storagePath());
      if (this.stopped) {
        return;
      }
      if (settings.enablePowerSwitch) {
        this.powerState = new PowerCommandState(api.user.storagePath());
      }
      if (settings.enablePowerSwitch) {
        this.setpointState = new SetpointCommandState(api.user.storagePath());
        this.ventilationState = new VentilationCommandState(api.user.storagePath());
        this.powerfulState = new PowerfulCommandState(api.user.storagePath());
        this.autoState = new AutoCommandState(api.user.storagePath());
        this.chronoState = new ChronoCommandState(api.user.storagePath());
        this.abandonConfirmation = new AbandonConfirmationState(api.user.storagePath());
      }
      this.client = new AguaClient({
        email: settings.email, password: settings.password, appId,
      }, {
        enableExperimentalPower: settings.enablePowerSwitch,
        enableExperimentalSetpoint: settings.enableSetpointControl,
        enableExperimentalVentilation: settings.enableVentilationControl,
        enableExperimentalPowerful: settings.enablePowerfulControl,
        enableExperimentalAuto: settings.enableAutoControl,
        enableExperimentalChrono: settings.enableChronoControl,
        ...(settings.diagnostic ? { diagnostic: (event) => this.log.debug(
          `Agua-IoT ${event.operation}: ${event.durationMs}ms HTTP ${event.status ?? '-'} ${event.errorKind ?? ''}`,
        ) } : {}),
      });
      this.log.info(settings.enablePowerSwitch
        ? 'Experimental power control enabled: real commands, supervised use only. No automatic command retry; cloud freshness unknown.'
        : settings.enableTemperatureSensor
        ? 'Starting experimental read-only temperature sensor. Measurement freshness is unknown; no stove control or heating state.'
        : 'Starting read-only cloud discovery. No stove command, buffer configuration or HomeKit accessory will be sent.');
      await this.poll(settings, api);
    } catch (error) {
      this.report(error);
    }
  }

  private async poll(settings: NobisConfig, api: API): Promise<void> {
    if (this.stopped || this.polling) {
      return;
    }
    if (this.commandInProgress) {
      this.schedulePoll(settings, 5000);
      return;
    }
    this.polling = true;
    if (this.quickReadsRemaining > 0) {
      this.quickReadsRemaining--;
    }
    try {
      await this.refresh(settings, api);
    } finally {
      this.polling = false;
    }
  }

  private schedulePoll(settings: NobisConfig, delay: number): void {
    if (this.stopped) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.poll(settings, this.api); }, delay);
  }

  private requestReadback(accessory: PlatformAccessory): void {
    if (!this.stopped && hasPendingCommand(accessory.context) && this.settings !== undefined) {
      this.quickReadsRemaining = 3;
      if (!this.polling) {
        this.schedulePoll(this.settings, 5000);
      }
    }
  }

  private async refresh(settings: NobisConfig, api: API): Promise<void> {
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
        const sensor = this.temperatureSensor(selected[0], settings, api);
        sensor.update(temperature);
        this.updateEcoStop(sensor.accessory, map, reading);
        if (this.commandInProgress) {
          this.schedulePoll(settings, 5000);
          return;
        }
        if (settings.enablePowerSwitch) {
          this.controlDevice = selected[0];
          await this.updatePower(sensor.accessory, map, reading);
        }
        if (settings.diagnostic) {
          this.reportStatusDiagnostic(map, reading);
        }
      }
      if (this.stopped) {
        return;
      }
      if (this.failures > 0 || settings.diagnostic) {
        this.log.info(settings.enablePowerSwitch
          ? `Cloud refresh successful: ${map.registers.length} register definitions. Observations updated; measurement freshness unknown. Power control is opt-in.`
          : settings.enableTemperatureSensor
          ? `Read-only discovery successful: ${map.registers.length} register definitions. Temperature sensor updated; measurement freshness unknown. No heating state or command is exposed.`
          : `Read-only discovery successful: ${map.registers.length} register definitions. No thermal state or command is exposed.`);
      }
      this.failures = 0;
    } catch (error) {
      if (this.stopped) {
        return;
      }
      this.report(error);
      this.markUnavailable();
      const invalidHomeKitTemperatureSample = error instanceof AguaError
        && error.operation === 'homekit-temperature-range';
      if (!(error instanceof AguaError)
        || (error.kind === 'protocol' && !invalidHomeKitTemperatureSample)
        || error.kind === 'configuration' || error.kind === 'storage'
        || (error.status !== undefined && [401, 403, 404, 412, 422].includes(error.status))) {
        this.log.warn('Automatic discovery stopped. Resolve the configuration or protocol issue before restarting.');
        return;
      }
      wait = Math.max(reconnectDelay(wait, ++this.failures), error.retryAfterMs ?? 0);
      this.log.info(`Cloud refresh retry scheduled in ${Math.ceil(wait / 1000)} seconds.`
        + (invalidHomeKitTemperatureSample
          ? ' The received temperature is outside the HomeKit range; no value was clamped or published. A valid reading is required to recover.'
          : settings.enableTemperatureSensor ? ' Temperature sensor remains unavailable until a valid reading.' : ''));
    }
    if (!this.stopped) {
      if (wait > 2_147_483_647) {
        this.log.warn('Server retry delay exceeds the supported timer budget. Automatic discovery stopped rather than retrying early.');
        return;
      }
      const pending = [...this.accessories.values()].some(accessory => hasPendingCommand(accessory.context));
      this.schedulePoll(settings, pending && this.quickReadsRemaining > 0 && this.failures === 0 ? 5000 : wait);
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
    const sensor = new TemperatureAccessory(accessory, api, name, !settings.enableSetpointControl);
    this.configurePower(accessory, settings);
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
        this.ecoStops.delete(accessory.UUID);
        this.powers.delete(accessory.UUID);
        this.heaters.delete(accessory.UUID);
        this.powerfuls.delete(accessory.UUID);
        this.autos.delete(accessory.UUID);
        this.chronos.delete(accessory.UUID);
      }
    }
  }

  private markUnavailable(): void {
    for (const ecoStop of this.ecoStops.values()) {
      ecoStop.markUnavailable();
    }
    this.lastStatusDiagnostic = undefined;
    this.controlDevice = undefined;
    for (const sensor of this.sensors.values()) {
      sensor.markUnavailable();
    }
    for (const power of this.powers.values()) {
      power.markUnavailable();
    }
    for (const heater of this.heaters.values()) {
      heater.markUnavailable();
    }
    for (const powerful of this.powerfuls.values()) {
      powerful.markUnavailable();
    }
    for (const auto of this.autos.values()) {
      auto.markUnavailable();
    }
    for (const chrono of this.chronos.values()) {
      chrono.markUnavailable();
    }
  }

  private configurePower(accessory: PlatformAccessory, settings: NobisConfig): void {
    if (settings.enableEcoStopSensor) {
      this.ecoStops.set(accessory.UUID, new EcoStopAccessory(accessory, this.api, settings.stoveName ?? 'Nobis'));
    } else {
      const service = accessory.getServiceById(this.api.hap.Service.ContactSensor, 'eco-stop');
      if (service !== undefined) {
        accessory.removeService(service);
      }
      this.ecoStops.delete(accessory.UUID);
    }
    if (settings.enableChronoControl) {
      this.chronos.set(accessory.UUID, new OperatingModeAccessory(accessory, this.api, settings.stoveName ?? 'Nobis',
        enabled => this.acceptCommand(accessory, 'Chrono', () => this.commandOperatingMode(accessory, enabled, 'chrono')),
        'chrono', message => this.log.warn(message)));
    } else {
      const service = accessory.getServiceById(this.api.hap.Service.Switch, 'chrono');
      if (service !== undefined) {
        accessory.removeService(service);
      }
      this.chronos.delete(accessory.UUID);
    }
    if (settings.enableAutoControl) {
      this.autos.set(accessory.UUID, new OperatingModeAccessory(accessory, this.api, settings.stoveName ?? 'Nobis',
        enabled => this.acceptCommand(accessory, 'Auto', () => this.commandOperatingMode(accessory, enabled, 'auto')),
        'auto', message => this.log.warn(message)));
    } else {
      const service = accessory.getServiceById(this.api.hap.Service.Switch, 'auto');
      if (service !== undefined) {
        accessory.removeService(service);
      }
      this.autos.delete(accessory.UUID);
    }
    if (settings.enablePowerfulControl) {
      this.powerfuls.set(accessory.UUID, new PowerfulAccessory(accessory, this.api, settings.stoveName ?? 'Nobis',
        enabled => this.acceptCommand(accessory, 'Powerful', () => this.commandOperatingMode(accessory, enabled, 'powerful')),
        'powerful', message => this.log.warn(message)));
    } else {
      const service = accessory.getServiceById(this.api.hap.Service.Switch, 'powerful');
      if (service !== undefined) {
        accessory.removeService(service);
      }
      this.powerfuls.delete(accessory.UUID);
    }
    if (settings.enableSetpointControl) {
      this.heaters.set(accessory.UUID, new HeatingAccessory(accessory, this.api, settings.stoveName ?? 'Nobis',
        on => this.acceptCommand(accessory, 'Power', () => this.commandPower(accessory, on)),
        celsius => this.acceptCommand(accessory, 'Setpoint', () => this.commandSetpoint(accessory, celsius)),
        settings.enableVentilationControl
          ? level => this.acceptCommand(accessory, 'Ventilation', () => this.commandVentilation(accessory, level)) : undefined,
        message => this.log.warn(message)));
    } else {
      for (const type of [this.api.hap.Service.HeaterCooler, this.api.hap.Service.Thermostat]) {
        const service = accessory.getServiceById(type, 'heating');
        if (service !== undefined) {
          accessory.removeService(service);
        }
      }
      this.heaters.delete(accessory.UUID);
    }
    if (settings.enablePowerSwitch) {
      this.powers.set(accessory.UUID, new PowerAccessory(accessory, this.api, settings.stoveName ?? 'Nobis',
        on => this.acceptCommand(accessory, 'Power', () => this.commandPower(accessory, on)),
        message => this.log.warn(message), settings.useHeatingActivityIndicator));
    } else {
      const service = accessory.getServiceById(this.api.hap.Service.Switch, 'power');
      if (service !== undefined) {
        accessory.removeService(service);
      }
      this.powers.delete(accessory.UUID);
    }
  }

  private async checkAbandonConfirmation(accessory: PlatformAccessory, map: RegisterMap, reading: RawReading): Promise<void> {
    const settings = this.settings;
    const confirmation = this.abandonConfirmation;
    if (settings === undefined || confirmation === undefined || this.checkedAbandonConfirmation.has(accessory.UUID)) {
      return;
    }
    const consumed = await confirmation.load(accessory.UUID);
    if (this.stopped) {
      return;
    }
    if (!settings.confirmAbandonPendingCommands) {
      if (consumed !== undefined) {
        await confirmation.complete(accessory.UUID);
        this.log.info('Pending-command abandonment confirmation reset. A new explicit confirmation requires enabling the option and restarting.');
      }
      this.checkedAbandonConfirmation.add(accessory.UUID);
      return;
    }
    if (consumed !== undefined) {
      this.checkedAbandonConfirmation.add(accessory.UUID);
      this.log.warn('Pending-command abandonment confirmation already consumed. No markers cleared. Disable the option, save and restart before confirming another abandonment.');
      return;
    }
    if (observeNobisStatus(map, reading).phase.kind !== 'off') {
      this.log.warn('Pending-command abandonment refused: API must report OFF. Stop the stove using Nobis-Fi or its remote, then restart the bridge. No marker cleared or command sent.');
      throw new AguaError('configuration', 'pending-command-abandon');
    }
    decodeSetpoint(map, reading);
    if (accessory.context.pendingChrono !== undefined) {
      observeChrono(map, reading);
    }
    const operating = observeOperatingSettings(map, reading);
    for (const mode of operating.registers.filter(entry => entry.key === 'fun_auto_set' || entry.key === 'fun_pwf_set')) {
      if (mode.label !== (mode.rawValue === 1 ? 'ON' : 'OFF')) {
        throw new AguaError('protocol', 'pending-command-abandon');
      }
    }
    const entries = [
      ['pendingPowerAction', this.powerState, ['on', 'off']],
      ['pendingSetpoint', this.setpointState, Array.from({ length: 34 }, (_, index) => index + 7)],
      ['pendingVentilation', this.ventilationState, [1, 2, 3, 4, 5, 6, 7]],
      ['pendingPowerful', this.powerfulState, [0, 1]],
      ['pendingAuto', this.autoState, [0, 1]],
      ['pendingChrono', this.chronoState, [0, 1]],
    ] as const;
    for (const [key, state, allowed] of entries) {
      const value: unknown = accessory.context[key];
      if (state === undefined || (value !== undefined && !allowed.some(candidate => candidate === value))) {
        throw new AguaError('configuration', 'pending-command-abandon');
      }
    }
    if (this.stopped) {
      return;
    }
    this.commandInProgress = true;
    try {
      // Consume durably before clearing anything: a crash must not re-arm this action.
      await confirmation.begin(accessory.UUID, 1);
      this.checkedAbandonConfirmation.add(accessory.UUID);
      let cleared = 0;
      for (const [key, state] of entries) {
        if (this.stopped) {
          return;
        }
        if (state === undefined) {
          throw new AguaError('configuration', 'pending-command-abandon');
        }
        if (accessory.context[key] !== undefined) {
          const persisted = await state.load(accessory.UUID);
          if (this.stopped) {
            return;
          }
          if (persisted !== undefined) {
            await state.complete(accessory.UUID);
          }
          delete accessory.context[key];
          this.api.updatePlatformAccessories([accessory]);
          this.log.warn(`Pending-command target explicitly abandoned: ${key}. No stove command sent; an earlier cloud command may still execute.`);
          cleared++;
        }
      }
      this.quickReadsRemaining = 0;
      this.log.warn(`Pending-command abandonment complete: ${cleared} target(s) cleared, API phase OFF. Current requested settings: `
        + operating.registers.map(entry => `${entry.key}=${entry.rawValue}`).join('; ')
        + '. Freshness unknown. Disable the confirmation option, save and restart; no automatic restoration or command sent.');
    } finally {
      this.commandInProgress = false;
    }
  }

  private updateEcoStop(accessory: PlatformAccessory, map: RegisterMap, reading: RawReading): void {
    const sensor = this.ecoStops.get(accessory.UUID);
    if (sensor === undefined) {
      return;
    }
    try {
      sensor.update(observeNobisStatus(map, reading));
    } catch (error) {
      sensor.markUnavailable();
      this.report(error);
      if (!(error instanceof AguaError) || error.operation !== 'status-observation') {
        throw error;
      }
    }
  }

  private async updatePower(accessory: PlatformAccessory, map: RegisterMap, reading: RawReading, commandReadback = false): Promise<void> {
    if (commandReadback) {
      this.updateEcoStop(accessory, map, reading);
    }
    const power = this.powers.get(accessory.UUID);
    if (power === undefined) {
      return;
    }
    try {
      const persisted = await this.powerState?.load(accessory.UUID);
      if (this.stopped) {
        return;
      }
      if (persisted !== undefined) {
        accessory.context.pendingPowerAction = persisted;
      }
      const pendingSetpoint = await this.setpointState?.load(accessory.UUID);
      if (this.stopped) {
        return;
      }
      if (pendingSetpoint !== undefined) {
        accessory.context.pendingSetpoint = pendingSetpoint;
      }
      const pendingVentilation = await this.ventilationState?.load(accessory.UUID);
      if (this.stopped) {
        return;
      }
      if (pendingVentilation !== undefined) {
        accessory.context.pendingVentilation = pendingVentilation;
      }
      const pendingPowerful = await this.powerfulState?.load(accessory.UUID);
      if (this.stopped) {
        return;
      }
      if (pendingPowerful !== undefined) {
        accessory.context.pendingPowerful = pendingPowerful;
      }
      const pendingAuto = await this.autoState?.load(accessory.UUID);
      if (this.stopped) {
        return;
      }
      if (pendingAuto !== undefined) {
        accessory.context.pendingAuto = pendingAuto;
      }
      const pendingChrono = await this.chronoState?.load(accessory.UUID);
      if (this.stopped) {
        return;
      }
      if (pendingChrono !== undefined) {
        accessory.context.pendingChrono = pendingChrono;
      }
      if (this.commandInProgress && !commandReadback) {
        return;
      }
      if (!commandReadback) {
        await this.checkAbandonConfirmation(accessory, map, reading);
        if (this.stopped) {
          return;
        }
      }
      const observation = observeNobisStatus(map, reading);
      if (this.chronos.has(accessory.UUID) || accessory.context.pendingChrono !== undefined) {
        try {
          const chrono = observeChrono(map, reading);
          const value = chrono.registers[0]?.rawValue;
          if (value !== undefined && accessory.context.pendingChrono === value) {
            if (pendingChrono !== undefined) {
              await this.chronoState?.complete(accessory.UUID);
            }
            if (this.stopped) {
              return;
            }
            delete accessory.context.pendingChrono;
            this.api.updatePlatformAccessories([accessory]);
            this.log.info('Pending Chrono resolved by API readback. Scheduled effects and cloud freshness remain unknown.');
          }
          this.chronos.get(accessory.UUID)?.update(chrono, observation);
        } catch (error) {
          if (!(error instanceof AguaError) || error.operation !== 'chrono-observation') {
            throw error;
          }
          this.chronos.get(accessory.UUID)?.markUnavailable();
          this.report(error);
        }
      }
      let operatingSettings: ReturnType<typeof observeOperatingSettings> | undefined;
      if (this.powerfuls.has(accessory.UUID) || this.autos.has(accessory.UUID)
        || accessory.context.pendingPowerful !== undefined || accessory.context.pendingAuto !== undefined) {
        try {
          operatingSettings = observeOperatingSettings(map, reading);
          for (const [key, contextKey, state, persisted, label] of [
            ['fun_pwf_set', 'pendingPowerful', this.powerfulState, pendingPowerful, 'Powerful'],
            ['fun_auto_set', 'pendingAuto', this.autoState, pendingAuto, 'Auto'],
          ] as const) {
            const mode = operatingSettings.registers.find(entry => entry.key === key);
            if ((!this.commandInProgress || commandReadback) && !this.resolvingPower.has(accessory.UUID)
              && mode !== undefined && mode.label === (mode.rawValue === 1 ? 'ON' : 'OFF')
              && accessory.context[contextKey] === mode.rawValue) {
              this.resolvingPower.add(accessory.UUID);
              try {
                if (persisted !== undefined) {
                  await state?.complete(accessory.UUID);
                }
                if (this.stopped) {
                  return;
                }
                delete accessory.context[contextKey];
                this.api.updatePlatformAccessories([accessory]);
                this.log.info(`Pending ${label} resolved by API mode readback. Physical effect and cloud freshness remain unknown.`);
              } finally {
                this.resolvingPower.delete(accessory.UUID);
              }
            }
          }
        } catch (error) {
          if (!(error instanceof AguaError) || error.operation !== 'operating-settings') {
            throw error;
          }
          this.powerfuls.get(accessory.UUID)?.markUnavailable();
          this.autos.get(accessory.UUID)?.markUnavailable();
          this.report(error);
        }
      }
      const pending: unknown = accessory.context.pendingPowerAction;
      if ((!this.commandInProgress || commandReadback)
        && ((pending === 'on' && (observation.phase.kind === 'working' || observation.phase.kind === 'eco-stop'))
          || (pending === 'off' && observation.phase.kind === 'off'))) {
        if (this.resolvingPower.has(accessory.UUID)) {
          return;
        }
        this.resolvingPower.add(accessory.UUID);
        try {
          if (persisted !== undefined) {
            await this.powerState?.complete(accessory.UUID);
          }
          if (this.stopped) {
            return;
          }
          delete accessory.context.pendingPowerAction;
          this.api.updatePlatformAccessories([accessory]);
          this.log.info('Pending power command resolved by a target phase read from the API. Cloud freshness remains unknown.');
        } finally {
          this.resolvingPower.delete(accessory.UUID);
        }
      }
      power.update(observation);
      const heater = this.heaters.get(accessory.UUID);
      if (heater !== undefined || accessory.context.pendingSetpoint !== undefined) {
        const setpoint = decodeSetpoint(map, reading);
        if ((!this.commandInProgress || commandReadback) && !this.resolvingPower.has(accessory.UUID)
          && setpoint.mode === 'temperature' && accessory.context.pendingSetpoint === setpoint.celsius) {
          this.resolvingPower.add(accessory.UUID);
          try {
            if (pendingSetpoint !== undefined) {
              await this.setpointState?.complete(accessory.UUID);
            }
            if (this.stopped) {
              return;
            }
            delete accessory.context.pendingSetpoint;
            this.api.updatePlatformAccessories([accessory]);
            this.log.info('Pending setpoint resolved by API readback. Measurement freshness remains unknown.');
          } finally {
            this.resolvingPower.delete(accessory.UUID);
          }
          power.update(observation);
        }
        heater?.update(decodeNobisAmbientTemperature(map, reading, 1), setpoint, observation);
      }
      if (heater?.hasVentilation || accessory.context.pendingVentilation !== undefined) {
        try {
          const settings = observeOperatingSettings(map, reading);
          const ventilation = settings.registers.find(entry => entry.key === 'vent_front_set');
          const level = ventilation?.label === null ? ventilation.rawValue : undefined;
          if ((!this.commandInProgress || commandReadback) && !this.resolvingPower.has(accessory.UUID)
            && level !== undefined && accessory.context.pendingVentilation === level) {
            this.resolvingPower.add(accessory.UUID);
            try {
              if (pendingVentilation !== undefined) {
                await this.ventilationState?.complete(accessory.UUID);
              }
              if (this.stopped) {
                return;
              }
              delete accessory.context.pendingVentilation;
              this.api.updatePlatformAccessories([accessory]);
              this.log.info('Pending ventilation resolved by API setpoint readback. Actual airflow and freshness remain unknown.');
            } finally {
              this.resolvingPower.delete(accessory.UUID);
            }
            power.update(observation);
            heater?.update(decodeNobisAmbientTemperature(map, reading, 1), decodeSetpoint(map, reading), observation);
          }
          heater?.updateVentilation(settings, observation);
        } catch (error) {
          if (!(error instanceof AguaError) || error.operation !== 'operating-settings') {
            throw error;
          }
          heater?.markVentilationUnavailable();
          this.report(error);
        }
      }
      if (operatingSettings !== undefined) {
        this.powerfuls.get(accessory.UUID)?.update(operatingSettings, observation);
        this.autos.get(accessory.UUID)?.update(operatingSettings, observation);
      }
    } catch (error) {
      if (!(error instanceof AguaError)
        || !['status-observation', 'power-command-state', 'setpoint-preview', 'setpoint-readback'].includes(error.operation)) {
        throw error;
      }
      power.markUnavailable();
      this.heaters.get(accessory.UUID)?.markUnavailable();
      this.powerfuls.get(accessory.UUID)?.markUnavailable();
      this.autos.get(accessory.UUID)?.markUnavailable();
      this.chronos.get(accessory.UUID)?.markUnavailable();
      this.report(error);
    }
  }

  private acceptCommand(accessory: PlatformAccessory, label: string, command: () => Promise<void>): Promise<void> {
    if (this.commandInProgress || hasPendingCommand(accessory.context)) {
      this.log.warn(`HomeKit ${label} refused locally: another command is in progress or awaiting API readback. No command sent.`);
      return Promise.reject(new this.api.hap.HapStatusError(this.api.hap.HAPStatus.RESOURCE_BUSY));
    }
    const device = this.controlDevice;
    if (this.stopped || this.client === undefined || device === undefined
      || accessory.UUID !== this.api.hap.uuid.generate(JSON.stringify(
        [PLUGIN_NAME, device.id_product, device.id_device, 'temperature']))) {
      this.log.warn(`HomeKit ${label} refused locally: stove control unavailable. No command sent.`);
      return Promise.reject(new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));
    }
    // Command methods acquire the global lock synchronously, before their first await.
    const processing = command();
    this.log.info(`HomeKit ${label} accepted locally; cloud processing continues. This is not cloud acceptance or stove confirmation.`
      + ' Last observed values retained; other writes locked.');
    void processing.then(() => {
      if (!this.stopped) {
        this.log.info(`HomeKit ${label} processing finished. Only API readback confirms the target; pending targets remain locked.`);
      }
    }, () => {
      if (!this.stopped) {
        this.log.warn(`HomeKit ${label} processing failed after the local response; the original HomeKit request cannot report this error.`
          + ' See preceding errors and check Nobis-Fi. No automatic write retry; any pending target remains locked.');
      }
    });
    return Promise.resolve();
  }

  private async commandPower(accessory: PlatformAccessory, on: boolean): Promise<void> {
    const client = this.client;
    const device = this.controlDevice;
    if (this.stopped || client === undefined || device === undefined || this.commandInProgress
      || this.powerState === undefined || hasPendingCommand(accessory.context)
      || accessory.UUID !== this.api.hap.uuid.generate(JSON.stringify(
        [PLUGIN_NAME, device.id_product, device.id_device, 'temperature']))) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    this.commandInProgress = true;
    const action = on ? 'on' : 'off';
    let after: { map: RegisterMap; reading: RawReading } | undefined;
    try {
      const devices = await client.getDevices();
      const selected = devices.find(candidate => candidate.id_device === device.id_device
        && candidate.id_product === device.id_product && !candidate.deleted && candidate.is_online);
      if (selected === undefined) {
        throw new AguaError('unavailable', 'device-offline');
      }
      const map = await client.getRegisterMap(selected);
      const before = await client.readBuffer(selected, 1);
      previewPower(selected, map, before, action);
      if (this.stopped) {
        throw new AguaError('closed', 'power-test');
      }
      accessory.context.pendingPowerAction = action;
      await this.powerState.begin(accessory.UUID, action);
      this.api.updatePlatformAccessories([accessory]);
      await client.testPower(selected, map, before, action);
      after = { map, reading: await client.readBuffer(selected, 1) };
      if (!this.stopped) {
        await this.updatePower(accessory, after.map, after.reading, true);
        if (accessory.context.pendingPowerAction !== undefined) {
          this.log.info('Power command accepted, awaiting target phase. Last confirmed values remain readable; writes locked, readback scheduled. No write retry.');
        }
      }
    } catch (error) {
      this.powers.get(accessory.UUID)?.markUnavailable();
      this.report(error);
      this.log.warn(accessory.context.pendingPowerAction === undefined
        ? 'Power command refused before sending. Check the physical phase and connection.'
        : 'Power command outcome pending or uncertain. Check Nobis-Fi and the remote; no automatic retry or inverse command. Further writes are blocked until the target phase is read.');
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    } finally {
      this.commandInProgress = false;
      this.requestReadback(accessory);
    }
  }

  private async commandSetpoint(accessory: PlatformAccessory, celsius: number): Promise<void> {
    const client = this.client;
    const device = this.controlDevice;
    if (this.stopped || client === undefined || device === undefined || this.setpointState === undefined
      || this.commandInProgress || hasPendingCommand(accessory.context)
      || accessory.UUID !== this.api.hap.uuid.generate(JSON.stringify(
        [PLUGIN_NAME, device.id_product, device.id_device, 'temperature']))) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    this.commandInProgress = true;
    let after: { map: RegisterMap; reading: RawReading } | undefined;
    try {
      const devices = await client.getDevices();
      const selected = devices.find(candidate => candidate.id_device === device.id_device
        && candidate.id_product === device.id_product && candidate.is_online && !candidate.deleted);
      if (selected === undefined) {
        throw new AguaError('unavailable', 'device-offline');
      }
      const map = await client.getRegisterMap(selected);
      const before = await client.readBuffer(selected, 1);
      const phase = observeNobisStatus(map, before).phase;
      const original = decodeSetpoint(map, before);
      if ((phase.kind !== 'off' && phase.kind !== 'working') || original.mode !== 'temperature') {
        throw new AguaError('configuration', 'setpoint-initial-state');
      }
      previewSetpoint(selected, map, celsius);
      if (original.celsius === celsius) {
        after = { map, reading: before };
      } else {
        if (this.stopped) {
          throw new AguaError('closed', 'setpoint-test');
        }
        accessory.context.pendingSetpoint = celsius;
        await this.setpointState.begin(accessory.UUID, celsius);
        this.api.updatePlatformAccessories([accessory]);
        await client.testSetpoint(selected, map, celsius);
        after = { map, reading: await client.readBuffer(selected, 1) };
      }
      if (!this.stopped) {
        await this.updatePower(accessory, after.map, after.reading, true);
        if (accessory.context.pendingSetpoint !== undefined) {
          this.log.info('Setpoint accepted, awaiting readback. Last confirmed values remain readable; writes locked. No write retry.');
        }
      }
    } catch (error) {
      this.heaters.get(accessory.UUID)?.markUnavailable();
      this.powers.get(accessory.UUID)?.markUnavailable();
      this.report(error);
      this.log.warn(accessory.context.pendingSetpoint === undefined
        ? 'Setpoint refused before sending. Check the physical mode and connection.'
        : 'Setpoint outcome uncertain or pending. Check Nobis-Fi and the remote. No retry or automatic restoration; all writes blocked until target readback.');
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    } finally {
      this.commandInProgress = false;
      this.requestReadback(accessory);
    }
  }

  private async commandVentilation(accessory: PlatformAccessory, level: number): Promise<void> {
    const client = this.client;
    const device = this.controlDevice;
    if (this.stopped || client === undefined || device === undefined || this.ventilationState === undefined
      || this.commandInProgress || hasPendingCommand(accessory.context)
      || accessory.UUID !== this.api.hap.uuid.generate(JSON.stringify(
        [PLUGIN_NAME, device.id_product, device.id_device, 'temperature']))) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    this.commandInProgress = true;
    let after: { map: RegisterMap; reading: RawReading } | undefined;
    try {
      const devices = await client.getDevices();
      const selected = devices.find(candidate => candidate.id_device === device.id_device
        && candidate.id_product === device.id_product && candidate.is_online && !candidate.deleted);
      if (selected === undefined) {
        throw new AguaError('unavailable', 'device-offline');
      }
      const map = await client.getRegisterMap(selected);
      const before = await client.readBuffer(selected, 1);
      const preview = previewFrontVentilation(selected, map, before, level);
      if (preview.originalLevel === level) {
        after = { map, reading: before };
      } else {
        if (this.stopped) {
          throw new AguaError('closed', 'ventilation-test');
        }
        accessory.context.pendingVentilation = level;
        await this.ventilationState.begin(accessory.UUID, level);
        this.api.updatePlatformAccessories([accessory]);
        await client.testFrontVentilation(selected, map, before, level);
        after = { map, reading: await client.readBuffer(selected, 1) };
      }
      if (!this.stopped) {
        await this.updatePower(accessory, after.map, after.reading, true);
        if (accessory.context.pendingVentilation !== undefined) {
          this.log.info('Ventilation accepted, awaiting readback. Last confirmed values remain readable; writes locked. No write retry.');
        }
      }
    } catch (error) {
      this.heaters.get(accessory.UUID)?.markUnavailable();
      this.powers.get(accessory.UUID)?.markUnavailable();
      this.report(error);
      this.log.warn(accessory.context.pendingVentilation === undefined
        ? 'Ventilation refused before sending. Check phase, levels and Auto/Powerful modes.'
        : 'Ventilation outcome uncertain or pending. No retry or restoration; all writes blocked until target readback. Check Nobis-Fi.');
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    } finally {
      this.commandInProgress = false;
      this.requestReadback(accessory);
    }
  }

  private async commandOperatingMode(accessory: PlatformAccessory, enabled: boolean, mode: 'powerful' | 'auto' | 'chrono'): Promise<void> {
    const client = this.client;
    const device = this.controlDevice;
    const state = mode === 'chrono' ? this.chronoState : mode === 'auto' ? this.autoState : this.powerfulState;
    const contextKey = mode === 'chrono' ? 'pendingChrono' : mode === 'auto' ? 'pendingAuto' : 'pendingPowerful';
    const label = mode === 'chrono' ? 'Chrono' : mode === 'auto' ? 'Auto' : 'Powerful';
    const switches = mode === 'chrono' ? this.chronos : mode === 'auto' ? this.autos : this.powerfuls;
    if (this.stopped || client === undefined || device === undefined || state === undefined
      || this.commandInProgress || hasPendingCommand(accessory.context)
      || accessory.UUID !== this.api.hap.uuid.generate(JSON.stringify(
        [PLUGIN_NAME, device.id_product, device.id_device, 'temperature']))) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    this.commandInProgress = true;
    let after: { map: RegisterMap; reading: RawReading } | undefined;
    try {
      const selected = (await client.getDevices()).find(candidate => candidate.id_device === device.id_device
        && candidate.id_product === device.id_product && candidate.is_online && !candidate.deleted);
      if (selected === undefined) {
        throw new AguaError('unavailable', 'device-offline');
      }
      const map = await client.getRegisterMap(selected);
      const before = await client.readBuffer(selected, 1);
      (mode === 'chrono' ? previewChrono : mode === 'auto' ? previewAuto : previewPowerful)(selected, map, before, enabled);
      if (this.stopped) {
        throw new AguaError('closed', `${mode}-test`);
      }
      accessory.context[contextKey] = Number(enabled);
      await state.begin(accessory.UUID, Number(enabled));
      this.api.updatePlatformAccessories([accessory]);
      if (mode === 'chrono') {
        await client.testChrono(selected, map, before, enabled);
      } else if (mode === 'auto') {
        await client.testAuto(selected, map, before, enabled);
      } else {
        await client.testPowerful(selected, map, before, enabled);
      }
      after = { map, reading: await client.readBuffer(selected, 1) };
      if (!this.stopped) {
        await this.updatePower(accessory, after.map, after.reading, true);
        if (accessory.context[contextKey] !== undefined) {
          this.log.info(`${label} accepted, awaiting readback. Last confirmed values remain readable; writes locked. No write retry.`);
        }
      }
    } catch (error) {
      switches.get(accessory.UUID)?.markUnavailable();
      if (accessory.context[contextKey] !== undefined) {
        this.powerfuls.get(accessory.UUID)?.markUnavailable();
        this.autos.get(accessory.UUID)?.markUnavailable();
        this.chronos.get(accessory.UUID)?.markUnavailable();
        this.powers.get(accessory.UUID)?.markUnavailable();
        this.heaters.get(accessory.UUID)?.markUnavailable();
      }
      this.report(error);
      this.log.warn(accessory.context[contextKey] === undefined
        ? `${label} refused before sending. Check phase, other mode and connection.`
        : `${label} outcome uncertain or pending. All writes blocked until target readback; no retry or restoration. Check Nobis-Fi.`);
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    } finally {
      this.commandInProgress = false;
      this.requestReadback(accessory);
    }
  }

  private reportStatusDiagnostic(map: RegisterMap, reading: RawReading): void {
    let message: string;
    let unavailable = false;
    try {
      const observation = observeNobisStatus(map, reading);
      message = 'Read-only status codes: ' + observation.registers.map(register =>
        `${register.key}=${register.rawValue} (${register.label === null ? 'no FRE label' : 'FRE label available'})`,
      ).join('; ') + `. Observed phase: ${observation.phase.kind}`
        + (observation.phase.kind === 'unknown' ? ` (${observation.phase.reason})` : '')
        + '. Measurement freshness unknown; no HomeKit heating state inferred.';
    } catch (error) {
      if (!(error instanceof AguaError) || error.kind !== 'protocol' || error.operation !== 'status-observation') {
        throw error;
      }
      unavailable = true;
      message = `${error.message}. Status diagnostic unavailable: profile or raw values unsupported.`
        + ' Valid ambient temperature is unaffected; no heating state inferred.';
    }
    if (message !== this.lastStatusDiagnostic) {
      if (unavailable) {
        this.log.warn(message);
      } else {
        this.log.debug(message);
      }
      this.lastStatusDiagnostic = message;
    }
  }

  private report(error: unknown): void {
    if (!this.stopped) {
      this.log.warn(error instanceof AguaError ? error.message : 'Nobis read-only discovery failed unexpectedly; no private error detail is logged.');
    }
  }
}

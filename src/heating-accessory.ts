import type { API, Characteristic, CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { AmbientTemperature } from './agua/temperature.js';
import type { SetpointReading } from './agua/command-preview.js';
import type { StatusObservation } from './agua/status-observation.js';
import { TemperatureAccessory } from './temperature-accessory.js';
import type { observeOperatingSettings } from './agua/operating-settings.js';
import { ventilationLevel, ventilationPercentage } from './agua/ventilation-scale.js';
import { hasPendingCommand } from './agua/power-command-state.js';

export class HeatingAccessory {
  private readonly service: Service;
  private active: number | undefined;
  private current: number | undefined;
  private temperature: number | undefined;
  private target: number | undefined;
  private writing = false;
  private activationAllowed = false;
  private setpointAllowed = false;
  private readonly mode: Characteristic;
  private readonly currentState: Characteristic;
  private readonly threshold: Characteristic;
  private rotation: number | undefined;
  private ventilationAllowed = false;

  get hasVentilation(): boolean {
    return this.ventilation !== undefined;
  }

  constructor(
    readonly accessory: PlatformAccessory,
    private readonly api: API,
    name: string,
    private readonly power: (on: boolean) => Promise<void>,
    private readonly setpoint: (celsius: number) => Promise<void>,
    private readonly ventilation?: (level: number) => Promise<void>,
    private readonly warn?: (message: string) => void,
  ) {
    const { Service, Characteristic: C } = api.hap;
    const previous = accessory.getServiceById(ventilation === undefined ? Service.HeaterCooler : Service.Thermostat, 'heating');
    if (previous !== undefined) {
      accessory.removeService(previous);
    }
    const type = ventilation === undefined ? Service.Thermostat : Service.HeaterCooler;
    this.service = accessory.getServiceById(type, 'heating')
      ?? accessory.addService(type, `${name} Chauffage`, 'heating');
    this.service.setCharacteristic(C.Name, `${name} Chauffage`);
    this.mode = this.service.getCharacteristic(ventilation === undefined ? C.TargetHeatingCoolingState : C.Active);
    this.currentState = this.service.getCharacteristic(ventilation === undefined ? C.CurrentHeatingCoolingState : C.CurrentHeaterCoolerState);
    this.threshold = this.service.getCharacteristic(ventilation === undefined ? C.TargetTemperature : C.HeatingThresholdTemperature);
    this.mode.updateValue(this.communicationError())
      .setProps({ validValues: [0, 1], perms: [...this.mode.props.perms, api.hap.Perms.WRITE_RESPONSE] })
      .onGet(() => this.required(this.active))
      .onSet(value => this.write(value, 'active'));
    this.currentState.onGet(() => this.required(this.current));
    if (ventilation !== undefined) {
      this.service.getCharacteristic(C.TargetHeaterCoolerState).updateValue(C.TargetHeaterCoolerState.HEAT)
        .setProps({ validValues: [C.TargetHeaterCoolerState.HEAT] })
        .onGet(() => C.TargetHeaterCoolerState.HEAT)
        .onSet(value => {
          if (value !== C.TargetHeaterCoolerState.HEAT) {
            throw new api.hap.HapStatusError(api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
          }
        });
      const rotation = this.service.getCharacteristic(C.RotationSpeed);
      rotation.updateValue(this.communicationError())
        .setProps({ minValue: 0, maxValue: 100, minStep: 1,
          perms: [...rotation.props.perms, api.hap.Perms.WRITE_RESPONSE] })
        .onGet(() => this.required(this.rotation)).onSet(value => this.writeVentilation(value));
    }
    this.service.getCharacteristic(C.CurrentTemperature).onGet(() => this.required(this.temperature));
    this.service.getCharacteristic(C.TemperatureDisplayUnits).updateValue(C.TemperatureDisplayUnits.CELSIUS)
      .onGet(() => C.TemperatureDisplayUnits.CELSIUS)
      .onSet(value => {
        if (value !== C.TemperatureDisplayUnits.CELSIUS) {
          throw new api.hap.HapStatusError(api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
        }
      });
    this.threshold
      .updateValue(this.communicationError())
      .setProps({ minValue: 7, maxValue: 40, minStep: 1,
        description: 'Consigne de temperature',
        perms: [...this.threshold.props.perms, api.hap.Perms.WRITE_RESPONSE] })
      .onGet(() => this.required(this.target)).onSet(value => this.write(value, 'target'));
    this.markUnavailable();
  }

  private required(value: number | undefined): number {
    if (value === undefined) {
      throw this.communicationError();
    }
    return value;
  }

  private async write(value: CharacteristicValue, field: 'active' | 'target'): Promise<number> {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)
      || (field === 'active' ? ![0, 1].includes(value) : value < 7 || value > 40)) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
    }
    if (this.writing || hasPendingCommand(this.accessory.context)) {
      const pending = ['pendingPowerAction', 'pendingSetpoint', 'pendingVentilation', 'pendingPowerful', 'pendingAuto', 'pendingChrono']
        .filter(key => this.accessory.context[key] !== undefined);
      this.warn?.(`Heating ${field} write blocked before cloud request: ${this.writing ? 'command in progress' : pending.join(', ')}. No command sent.`);
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.RESOURCE_BUSY);
    }
    if (this.active === undefined || (field === 'target' && this.target === undefined)) {
      this.warn?.(`Heating ${field} write refused: required API observation unavailable. No command sent.`);
    }
    this.required(this.active);
    if (field === 'target') {
      this.required(this.target);
    }
    if (value === (field === 'active' ? this.active : this.target)) {
      return this.required(field === 'active' ? this.active : this.target);
    }
    if (field === 'target' && !this.setpointAllowed) {
      this.warn?.('Heating setpoint write refused in the observed phase. No command sent.');
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
    }
    if (field === 'active' && !this.activationAllowed) {
      this.warn?.('Heating ON/OFF write refused in the observed transition or unknown phase. No command sent.');
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
    }
    this.writing = true;
    try {
      if (field === 'active') {
        this.warn?.(`Heating tile requested real stove ${value === 1 ? 'ON' : 'OFF'}. Checking API phase before sending.`);
        await this.power(value === 1);
      } else {
        await this.setpoint(value);
      }
      return this.required(field === 'active' ? this.active : this.target);
    } finally {
      this.writing = false;
    }
  }
  private async writeVentilation(value: CharacteristicValue): Promise<number> {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 100) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
    }
    if (this.writing || hasPendingCommand(this.accessory.context)) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.RESOURCE_BUSY);
    }
    const previous = this.required(this.rotation);
    const level = ventilationLevel(value);
    const canonical = ventilationPercentage(level);
    if (this.ventilation === undefined || !this.ventilationAllowed) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
    }
    this.writing = true;
    try {
      if (previous !== canonical) {
        await this.ventilation(level);
      }
      // Retain the last readback, including when the new target is still pending.
      return this.required(this.rotation);
    } finally {
      this.writing = false;
    }
  }

  updateVentilation(settings: ReturnType<typeof observeOperatingSettings>, status: StatusObservation): void {
    if (this.ventilation === undefined) {
      return;
    }
    const register = settings.registers.find(entry => entry.key === 'vent_front_set');
    const level = register?.label === null ? register.rawValue : undefined;
    const blocked = hasPendingCommand(this.accessory.context);
    this.ventilationAllowed = !blocked && level !== undefined && level >= 1 && level <= 7
      && (status.phase.kind === 'off' || status.phase.kind === 'working')
      && settings.registers.find(entry => entry.key === 'fun_auto_set')?.rawValue === 0
      && settings.registers.find(entry => entry.key === 'fun_pwf_set')?.rawValue === 0;
    this.rotation = register?.rawValue === 0 && register.label === 'OFF' ? 0
      : level !== undefined && level >= 1 && level <= 7 ? ventilationPercentage(level) : undefined;
    this.service.getCharacteristic(this.api.hap.Characteristic.RotationSpeed).updateValue(this.rotation ?? this.communicationError());
  }

  markVentilationUnavailable(): void {
    this.rotation = undefined;
    this.ventilationAllowed = false;
    if (this.ventilation !== undefined) {
      this.service.getCharacteristic(this.api.hap.Characteristic.RotationSpeed).updateValue(this.communicationError());
    }
  }

  update(temperature: AmbientTemperature, setpoint: SetpointReading, status: StatusObservation): void {
    TemperatureAccessory.validate(this.api, temperature);
    const { Characteristic: C } = this.api.hap;
    this.temperature = temperature.celsius;
    this.service.updateCharacteristic(C.CurrentTemperature, this.temperature);
    this.target = setpoint.mode === 'temperature' ? setpoint.celsius : undefined;
    this.threshold
      .updateValue(this.target ?? this.communicationError());
    const { kind } = status.phase;
    this.setpointAllowed = kind === 'off' || kind === 'working';
    const stable = this.setpointAllowed || kind === 'eco-stop';
    this.activationAllowed = stable;
    if (stable) {
      this.active = kind !== 'off' ? C.TargetHeatingCoolingState.HEAT : C.TargetHeatingCoolingState.OFF;
      this.current = this.ventilation === undefined
        ? kind === 'working' ? C.CurrentHeatingCoolingState.HEAT : C.CurrentHeatingCoolingState.OFF
        : kind === 'working' ? C.CurrentHeaterCoolerState.HEATING
          : kind === 'eco-stop' ? C.CurrentHeaterCoolerState.IDLE : C.CurrentHeaterCoolerState.INACTIVE;
    } else if (kind !== 'starting' && kind !== 'stopping') {
      this.active = this.current = undefined;
    }
    this.mode.updateValue(this.active ?? this.communicationError());
    this.currentState.updateValue(this.current ?? this.communicationError());
  }

  markUnavailable(): void {
    this.active = this.current = this.temperature = this.target = undefined;
    this.setpointAllowed = false;
    this.activationAllowed = false;
    this.markVentilationUnavailable();
    const { Characteristic: C } = this.api.hap;
    for (const characteristic of [this.mode, this.currentState, this.service.getCharacteristic(C.CurrentTemperature), this.threshold]) {
      characteristic.updateValue(this.communicationError());
    }
  }

  private communicationError(): Error {
    return new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
}

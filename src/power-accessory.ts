import type { API, PlatformAccessory, Service } from 'homebridge';
import type { StatusObservation } from './agua/status-observation.js';
import { hasPendingCommand } from './agua/power-command-state.js';

export class PowerAccessory {
  private readonly service: Service;
  private value: boolean | undefined;
  private allowed = false;
  private writing = false;
  private phase: StatusObservation['phase']['kind'] = 'unknown';

  constructor(
    readonly accessory: PlatformAccessory,
    private readonly api: API,
    name: string,
    private readonly command: (on: boolean) => Promise<void>,
    private readonly warn?: (message: string) => void,
    private readonly activityIndicator = false,
  ) {
    const { Service, Characteristic } = api.hap;
    const serviceName = `${name} ${activityIndicator ? 'En chauffe' : 'Marche'}`;
    this.service = accessory.getServiceById(Service.Switch, 'power')
      ?? accessory.addService(Service.Switch, serviceName, 'power');
    this.service.setCharacteristic(Characteristic.Name, serviceName);
    const on = this.service.getCharacteristic(Characteristic.On);
    on.setProps({ perms: [...on.props.perms, api.hap.Perms.WRITE_RESPONSE] })
      .onGet(() => {
        if (this.value === undefined) {
          throw this.communicationError();
        }
        return this.value;
      })
      .onSet(async value => {
        if (typeof value !== 'boolean') {
          throw new api.hap.HapStatusError(api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
        }
        if (this.activityIndicator) {
          this.warn?.('Heating activity indicator is observation-only. Use the heating tile for real ON/OFF commands; no command sent.');
          throw new api.hap.HapStatusError(api.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
        }
        if (this.writing || hasPendingCommand(accessory.context)) {
          const pending = ['pendingPowerAction', 'pendingSetpoint', 'pendingVentilation', 'pendingPowerful', 'pendingAuto', 'pendingChrono']
            .filter(key => accessory.context[key] !== undefined);
          this.warn?.(`Power write blocked before cloud request: ${this.writing ? 'command in progress' : pending.join(', ')}.`
            + ' Waiting for API target readback; no command sent.');
          throw new api.hap.HapStatusError(api.hap.HAPStatus.RESOURCE_BUSY);
        }
        if (this.value === undefined) {
          this.warn?.('Power write refused before cloud request: activation unavailable. Check cloud refresh errors; no command sent.');
          throw this.communicationError();
        }
        if (!this.allowed) {
          this.warn?.(`Power write refused before cloud request: observed phase ${this.phase}. No command sent.`);
          throw new api.hap.HapStatusError(api.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
        }
        if (value === this.value) {
          return this.value;
        }
        this.writing = true;
        try {
          await this.command(value);
          if (this.value === undefined) {
            throw this.communicationError();
          }
          // A completed job acknowledges the write, not the target state.
          return this.value;
        } finally {
          this.writing = false;
        }
      });
    this.markUnavailable();
  }

  update(observation: StatusObservation): void {
    const { kind } = observation.phase;
    this.phase = kind;
    if (this.activityIndicator) {
      if (kind === 'unknown') {
        this.markUnavailable();
        return;
      }
      this.allowed = false;
      this.value = kind === 'working';
      this.service.updateCharacteristic(this.api.hap.Characteristic.On, this.value);
      return;
    }
    this.allowed = kind === 'off' || kind === 'working' || kind === 'eco-stop';
    if (kind === 'starting' || kind === 'stopping') {
      // Keep the last API-confirmed activation through a known transition.
      return;
    }
    if (!this.allowed) {
      this.markUnavailable();
      return;
    }
    this.value = kind !== 'off';
    this.service.updateCharacteristic(this.api.hap.Characteristic.On, this.value);
  }

  markUnavailable(): void {
    this.value = undefined;
    this.allowed = false;
    this.service.getCharacteristic(this.api.hap.Characteristic.On).updateValue(this.communicationError());
  }

  private communicationError(): Error {
    return new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
}

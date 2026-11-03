import type { API, PlatformAccessory, Service } from 'homebridge';
import type { observeOperatingSettings } from './agua/operating-settings.js';
import { hasPendingCommand } from './agua/power-command-state.js';
import type { StatusObservation } from './agua/status-observation.js';
import type { observeChrono } from './agua/chrono.js';

export class OperatingModeAccessory {
  private readonly service: Service;
  private value: boolean | undefined;
  private allowed = false;
  private writing = false;
  private phase: StatusObservation['phase']['kind'] = 'unknown';

  constructor(
    readonly accessory: PlatformAccessory,
    private readonly api: API,
    name: string,
    private readonly command: (enabled: boolean) => Promise<void>,
    private readonly mode: 'powerful' | 'auto' | 'chrono' = 'powerful',
    private readonly warn?: (message: string) => void,
  ) {
    const { Service, Characteristic } = api.hap;
    const label = mode === 'chrono' ? 'Chrono' : mode === 'auto' ? 'Auto' : 'Powerful';
    this.service = accessory.getServiceById(Service.Switch, mode)
      ?? accessory.addService(Service.Switch, `${name} ${label}`, mode);
    this.service.setCharacteristic(Characteristic.Name, `${name} ${label}`);
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
        if (this.writing || hasPendingCommand(accessory.context)) {
          const pending = ['pendingPowerAction', 'pendingSetpoint', 'pendingVentilation', 'pendingPowerful', 'pendingAuto', 'pendingChrono']
            .filter(key => accessory.context[key] !== undefined);
          this.warn?.(`${label} write blocked before cloud request: ${this.writing ? 'command in progress' : pending.join(', ')}.`
            + ' Waiting for API target readback; no command sent.');
          throw new api.hap.HapStatusError(api.hap.HAPStatus.RESOURCE_BUSY);
        }
        if (this.value === undefined) {
          this.warn?.(`${label} write refused before cloud request: mode unavailable. Check cloud refresh errors; no command sent.`);
          throw this.communicationError();
        }
        if (!this.allowed) {
          this.warn?.(`${label} write refused before cloud request: observed phase ${this.phase}`
            + (this.mode === 'chrono'
              ? '. Chrono writes currently require OFF/ECO STOP; no command sent.'
              : ' or other mode active. Only OFF/TRAVAIL/ECO STOP with the other mode OFF are currently supported; no command sent.'));
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
          return this.value;
        } finally {
          this.writing = false;
        }
      });
    this.markUnavailable();
  }

  update(settings: ReturnType<typeof observeOperatingSettings> | ReturnType<typeof observeChrono>, status: StatusObservation): void {
    this.phase = status.phase.kind;
    const key = this.mode === 'chrono' ? 'chrono_week_enable_set' : this.mode === 'auto' ? 'fun_auto_set' : 'fun_pwf_set';
    const otherKey = this.mode === 'auto' ? 'fun_pwf_set' : 'fun_auto_set';
    const mode = settings.registers.find(entry => entry.key === key);
    if (mode === undefined
      || ![0, 1].includes(mode.rawValue)
      || (this.mode === 'chrono' ? mode.label !== null : mode.label !== (mode.rawValue === 1 ? 'ON' : 'OFF'))) {
      this.markUnavailable();
      return;
    }
    this.value = mode.rawValue === 1;
    this.allowed = this.mode === 'chrono' ? status.phase.kind === 'off' || status.phase.kind === 'eco-stop'
      : (status.phase.kind === 'off' || status.phase.kind === 'working' || status.phase.kind === 'eco-stop')
        && settings.registers.find(entry => entry.key === otherKey)?.rawValue === 0;
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

export { OperatingModeAccessory as PowerfulAccessory };

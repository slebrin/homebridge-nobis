import type { API, PlatformAccessory, Service } from 'homebridge';
import type { StatusObservation } from './agua/status-observation.js';

export class EcoStopAccessory {
  private readonly service: Service;
  private value: number | undefined;

  constructor(accessory: PlatformAccessory, private readonly api: API, name: string) {
    const { Service, Characteristic } = api.hap;
    this.service = accessory.getServiceById(Service.ContactSensor, 'eco-stop')
      ?? accessory.addService(Service.ContactSensor, `${name} Eco Stop`, 'eco-stop');
    this.service.setCharacteristic(Characteristic.Name, `${name} Eco Stop`);
    this.service.getCharacteristic(Characteristic.ContactSensorState).onGet(() => {
      if (this.value === undefined) {
        throw this.communicationError();
      }
      return this.value;
    });
    this.markUnavailable();
  }

  update(observation: StatusObservation): void {
    if (observation.phase.kind === 'unknown') {
      this.markUnavailable();
      return;
    }
    const C = this.api.hap.Characteristic;
    this.value = observation.phase.kind === 'eco-stop'
      ? C.ContactSensorState.CONTACT_NOT_DETECTED : C.ContactSensorState.CONTACT_DETECTED;
    this.service.updateCharacteristic(C.ContactSensorState, this.value);
    this.service.updateCharacteristic(C.StatusFault, C.StatusFault.NO_FAULT);
  }

  markUnavailable(): void {
    this.value = undefined;
    const C = this.api.hap.Characteristic;
    this.service.getCharacteristic(C.ContactSensorState).updateValue(this.communicationError());
    this.service.updateCharacteristic(C.StatusFault, C.StatusFault.GENERAL_FAULT);
  }

  private communicationError(): Error {
    return new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
}

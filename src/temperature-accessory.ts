import type { API, PlatformAccessory, Service } from 'homebridge';

import type { AmbientTemperature } from './agua/temperature.js';
import { AguaError } from './agua/errors.js';

export class TemperatureAccessory {
  private readonly service: Service | undefined;
  private value: number | undefined;

  static validate(api: API, temperature: AmbientTemperature): void {
    const { minValue, maxValue } = new api.hap.Characteristic.CurrentTemperature().props;
    if (!Number.isFinite(temperature.celsius)
      || (minValue !== undefined && temperature.celsius < minValue)
      || (maxValue !== undefined && temperature.celsius > maxValue)) {
      throw new AguaError('protocol', 'homekit-temperature-range');
    }
  }

  constructor(
    readonly accessory: PlatformAccessory,
    private readonly api: API,
    name: string,
    separateTile = true,
  ) {
    const { Service, Characteristic } = api.hap;
    accessory.displayName = name;
    accessory.getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'Nobis');
    if (!separateTile) {
      const previous = accessory.getService(Service.TemperatureSensor);
      if (previous !== undefined) {
        accessory.removeService(previous);
      }
      return;
    }
    this.service = accessory.getService(Service.TemperatureSensor)
      ?? accessory.addService(Service.TemperatureSensor, `${name} Ambiante`);
    this.service.setCharacteristic(Characteristic.Name, `${name} Ambiante`);
    this.service.getCharacteristic(Characteristic.CurrentTemperature).onGet(() => {
      if (this.value === undefined) {
        throw this.communicationError();
      }
      return this.value;
    });
    this.markUnavailable();
  }

  update(temperature: AmbientTemperature): void {
    TemperatureAccessory.validate(this.api, temperature);
    if (this.service === undefined) {
      return;
    }
    const characteristic = this.service.getCharacteristic(this.api.hap.Characteristic.CurrentTemperature);
    this.value = temperature.celsius;
    characteristic.updateValue(this.value);
    this.service.updateCharacteristic(this.api.hap.Characteristic.StatusFault, 0);
  }

  markUnavailable(): void {
    this.value = undefined;
    if (this.service === undefined) {
      return;
    }
    this.service.getCharacteristic(this.api.hap.Characteristic.CurrentTemperature)
      .updateValue(this.communicationError());
    this.service.updateCharacteristic(this.api.hap.Characteristic.StatusFault, 1);
  }

  private communicationError(): Error {
    return new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
}

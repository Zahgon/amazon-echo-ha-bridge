/** The request payload accepted by `DeviceResource`. */

import { bindString, readObject } from '../deps/jackson';

export class Device {
  name: string | null = null;
  deviceType: string | null = null;
  offUrl: string | null = null;
  onUrl: string | null = null;
  httpVerb: string | null = null;
  contentType: string | null = null;
  contentBody: string | null = null;

  /**
   * `@RequestBody Device`. Unknown properties are ignored, matching the
   * `FAIL_ON_UNKNOWN_PROPERTIES=false` Spring Boot configures on the MVC mapper.
   */
  static fromJson(text: string): Device | null {
    const source = readObject(text);
    if (source === null) {
      return null;
    }
    const device = new Device();
    device.name = bindString(source, 'name', null);
    device.deviceType = bindString(source, 'deviceType', null);
    device.offUrl = bindString(source, 'offUrl', null);
    device.onUrl = bindString(source, 'onUrl', null);
    device.httpVerb = bindString(source, 'httpVerb', null);
    device.contentType = bindString(source, 'contentType', null);
    device.contentBody = bindString(source, 'contentBody', null);
    return device;
  }
}

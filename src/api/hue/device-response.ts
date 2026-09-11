/** One light as the Echo expects to see it. */

import { DeviceState } from './device-state';

/**
 * `getPointsymbol()` ignores the stored field and rebuilds this map on every
 * call, so these eight entries are what always reaches the wire. (The
 * corresponding setter therefore had no observable effect and is not carried
 * over.)
 */
export function pointsymbol(): Record<string, string> {
  return { 1: 'none', 2: 'none', 3: 'none', 4: 'none', 5: 'none', 6: 'none', 7: 'none', 8: 'none' };
}

export class DeviceResponse {
  state: DeviceState | null = null;
  type: string | null = null;
  name: string | null = null;
  modelid: string | null = null;
  manufacturername: string | null = null;
  uniqueid: string | null = null;
  swversion: string | null = null;

  /** The constants that make the Echo believe it is talking to an LCT001. */
  static createResponse(name: string | null, id: string | null): DeviceResponse {
    const deviceState = new DeviceState();
    const response = new DeviceResponse();
    response.state = deviceState;
    deviceState.on = false;
    deviceState.reachable = true;
    deviceState.effect = 'none';
    deviceState.alert = 'none';
    deviceState.bri = 254;
    deviceState.hue = 15823;
    deviceState.sat = 88;
    deviceState.ct = 313;

    deviceState.xy = [0.4255, 0.3998];
    deviceState.colormode = 'ct';
    response.name = name;
    response.uniqueid = id;
    response.manufacturername = 'Philips';
    response.type = 'Extended color light';
    response.modelid = 'LCT001';
    response.swversion = '65003148';

    return response;
  }

  toJson(): Record<string, unknown> {
    return {
      state: this.state === null ? null : this.state.toJson(),
      type: this.type,
      name: this.name,
      modelid: this.modelid,
      manufacturername: this.manufacturername,
      uniqueid: this.uniqueid,
      swversion: this.swversion,
      pointsymbol: pointsymbol(),
    };
  }
}

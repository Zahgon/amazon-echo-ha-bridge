/** The document returned by `GET /api/{userId}`. */

import type { DeviceResponse } from './device-response';

export class HueApiResponse {
  lights: Map<string, DeviceResponse> | null = null;

  toJson(): Record<string, unknown> {
    const lights: Record<string, unknown> = {};
    for (const [id, response] of this.lights ?? []) {
      lights[id] = response.toJson();
    }
    return { lights };
  }
}

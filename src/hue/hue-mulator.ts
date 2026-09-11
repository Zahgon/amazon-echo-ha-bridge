/** The Philips Hue API the Amazon Echo speaks. */

import { DeviceResponse } from '../api/hue/device-response';
import { DeviceState } from '../api/hue/device-state';
import { HueApiResponse } from '../api/hue/hue-api-response';
import type { DeviceDescriptor } from '../dao/device-descriptor';
import { PageRequest, type DeviceRepository } from '../dao/device-repository';
import {
  HttpIOError,
  createDefaultHttpClient,
  httpGet,
  httpPost,
  httpPut,
  type HttpClient,
  type HttpUriRequest,
} from '../deps/http-client';
import { JsonParseError, MismatchedInputError } from '../deps/jackson';
import { NullPointerError, ResponseEntity, type Mapping, type ServletRequest } from '../deps/mvc';
import { getLogger } from '../logger';

const log = getLogger('com.armzilla.ha.hue.HueMulator');
const INTENSITY_PERCENT = '${intensity.percent}';
const INTENSITY_BYTE = '${intensity.byte}';

export class HueMulator {
  private readonly httpClient: HttpClient;

  constructor(
    private readonly repository: DeviceRepository,
    private readonly portBase: number,
    httpClient: HttpClient = createDefaultHttpClient(),
  ) {
    // patched for now, moving away from HueMulator doing work
    this.httpClient = httpClient;
  }

  /** `GET /api/{userId}/lights` */
  getUpnpConfiguration(userId: string, request: ServletRequest): ResponseEntity<Record<string, string>> {
    log.info(`hue lights list requested: ${userId} from ${request.remoteAddr}${String(request.localPort)}`);

    const pageNumber = request.localPort - this.portBase;
    const deviceList = this.repository.findByDeviceType('switch', new PageRequest(pageNumber, 25));
    const deviceResponseMap: Record<string, string> = {};
    for (const device of deviceList) {
      deviceResponseMap[device.id ?? ''] = device.name ?? '';
    }
    return new ResponseEntity(deviceResponseMap, null, 200);
  }

  /** `POST /api/*` — the Echo's bridge registration handshake. */
  postAPI(request: ServletRequest): ResponseEntity<string> {
    log.info(`registered device: ${request.description}`);
    return new ResponseEntity('[{"success":{"username":"lights"}}]', null, 200);
  }

  /** `GET /api/{userId}` */
  getApi(userId: string, request: ServletRequest): ResponseEntity<Record<string, unknown>> {
    log.info(`hue api root requested: ${userId} from ${request.remoteAddr}`);
    const pageNumber = request.localPort - this.portBase;
    const descriptorList = this.repository.findByDeviceType('switch', new PageRequest(pageNumber, 25));
    const deviceList = new Map<string, DeviceResponse>();

    descriptorList.forEach((descriptor: DeviceDescriptor) => {
      const deviceResponse = DeviceResponse.createResponse(descriptor.name, descriptor.id);
      deviceList.set(descriptor.id ?? '', deviceResponse);
    });
    const apiResponse = new HueApiResponse();
    apiResponse.lights = deviceList;

    return new ResponseEntity(apiResponse.toJson(), {}, 200);
  }

  /** `GET /api/{userId}/lights/{lightId}` */
  getLigth(lightId: string, request: ServletRequest): ResponseEntity<Record<string, unknown>> {
    log.info(`hue light requested: ${lightId} from ${request.remoteAddr}`);
    const device = this.repository.findOne(lightId);
    if (device === null) {
      return new ResponseEntity<Record<string, unknown>>(null, null, 404);
    } else {
      log.info(`found device named: ${device.name ?? 'null'}`);
    }
    const lightResponse = DeviceResponse.createResponse(device.name, device.id);

    return new ResponseEntity(lightResponse.toJson(), {}, 200);
  }

  /** `PUT /api/{userId}/lights/{lightId}/state` */
  async stateChange(
    lightId: string,
    userId: string,
    request: ServletRequest,
    requestString: string,
  ): Promise<ResponseEntity<string>> {
    /*
     * strangely enough the Echo sends a content type of
     * application/x-www-form-urlencoded even though it sends a json object
     */
    log.info(`hue state change requested: ${userId} from ${request.remoteAddr}`);
    log.info(`hue stage change body: ${requestString}`);

    let state: DeviceState | null;
    try {
      state = DeviceState.fromJson(requestString);
    } catch (error: unknown) {
      if (error instanceof JsonParseError || error instanceof MismatchedInputError) {
        log.info('object mapper barfed on input', error);
        return new ResponseEntity<string>(null, null, 400);
      }
      throw error;
    }

    const device = this.repository.findOne(lightId);
    if (device === null) {
      return new ResponseEntity<string>(null, null, 404);
    }

    if (state === null) {
      // The original dereferences the mapped state unconditionally here, so a
      // body of literal `null` surfaces as a 500. Reproduced, not repaired.
      throw new NullPointerError();
    }

    let responseString: string;
    let url: string | null;
    if (state.on) {
      responseString = `[{"success":{"/lights/${lightId}/state/on":true}}]`;
      url = device.onUrl;
    } else {
      responseString = `[{"success":{"/lights/${lightId}/state/on":false}}]`;
      url = device.offUrl;
    }

    // quick template
    const templatedUrl = HueMulator.replaceIntensityValue(url, state.bri);
    const body = HueMulator.replaceIntensityValue(device.contentBody, state.bri);
    // make call
    if (!(await this.doHttpRequest(templatedUrl, device.httpVerb, device.contentType, body))) {
      return new ResponseEntity<string>(null, null, 503);
    }

    return new ResponseEntity(responseString, {}, 200);
  }

  /**
   * Light-weight templating, was going to use free marker but it was a bit too
   * heavy for what we were trying to do.
   *
   * Currently provides only two variables:
   *   intensity.byte    : 0-255 brightness, raw from the Echo
   *   intensity.percent : 0-100, adjusted for the vera
   *
   * The two are mutually exclusive by construction: a string carrying both
   * keeps its literal `${intensity.percent}`.
   */
  static replaceIntensityValue(request: string | null, intensity: number): string {
    if (request === null) {
      return '';
    }
    if (request.includes(INTENSITY_BYTE)) {
      const intensityByte = String(intensity);
      return request.split(INTENSITY_BYTE).join(intensityByte);
    } else if (request.includes(INTENSITY_PERCENT)) {
      const percentBrightness = Math.round((intensity / 255.0) * 100);
      const intensityPercent = String(percentBrightness);
      return request.split(INTENSITY_PERCENT).join(intensityPercent);
    }
    return request;
  }

  /**
   * The outbound call to the home-automation gateway. Success is any status in
   * `[200, 300)` — "had complaints that some apps do not respond back with pure
   * 200".
   */
  async doHttpRequest(
    url: string,
    httpVerb: string | null,
    contentType: string | null,
    body: string,
  ): Promise<boolean> {
    let request: HttpUriRequest | null = null;
    if (httpVerb === null || httpVerb.toUpperCase() === 'GET') {
      request = httpGet(url);
    } else if (httpVerb.toUpperCase() === 'POST') {
      request = httpPost(url, body, contentType);
    } else if (httpVerb.toUpperCase() === 'PUT') {
      request = httpPut(url, body, contentType);
    }
    log.info(`Making outbound call: ${request === null ? 'null' : `${request.method} ${request.rawUrl} HTTP/1.1`}`);
    try {
      const httpResponseCode = await this.httpClient.execute(request);
      log.info(`GET on URL responded: ${String(httpResponseCode)}`);
      if (httpResponseCode >= 200 && httpResponseCode < 300) {
        return true;
      }
    } catch (error: unknown) {
      if (!(error instanceof HttpIOError)) {
        throw error;
      }
      log.error('Error calling out to HA gateway', error);
    }
    return false;
  }

  mappings(): Mapping[] {
    return [
      {
        pattern: '/api/{userId}/lights',
        method: 'GET',
        produces: 'application/json',
        handle: (request) =>
          this.getUpnpConfiguration(request.pathVariables['userId'] ?? '', request),
      },
      {
        pattern: '/api/*',
        method: 'POST',
        produces: 'application/json',
        handle: (request) => this.postAPI(request),
      },
      {
        pattern: '/api/{userId}',
        method: 'GET',
        produces: 'application/json',
        handle: (request) => this.getApi(request.pathVariables['userId'] ?? '', request),
      },
      {
        pattern: '/api/{userId}/lights/{lightId}',
        method: 'GET',
        produces: 'application/json',
        handle: (request) => this.getLigth(request.pathVariables['lightId'] ?? '', request),
      },
      {
        pattern: '/api/{userId}/lights/{lightId}/state',
        method: 'PUT',
        requestBody: 'string',
        handle: (request) =>
          this.stateChange(
            request.pathVariables['lightId'] ?? '',
            request.pathVariables['userId'] ?? '',
            request,
            request.body,
          ),
      },
    ];
  }
}

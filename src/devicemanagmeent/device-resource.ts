/** The POST/PUT REST API the README documents, plus the configurator's CRUD. */

import { randomUUID } from 'node:crypto';

import { Device } from '../api/device';
import { DeviceDescriptor } from '../dao/device-descriptor';
import type { DeviceRepository } from '../dao/device-repository';
import { JsonParseError, MismatchedInputError } from '../deps/jackson';
import {
  HttpMessageNotReadableError,
  MISSING_REQUEST_BODY,
  ResponseEntity,
  type Mapping,
} from '../deps/mvc';

const SUPPORTED_VERBS = new Set(['get', 'put', 'post']);

/**
 * `@RequestBody Device`, at the converter boundary.
 *
 * `AbstractJackson2HttpMessageConverter.read` rewraps every parser failure as
 * an `HttpMessageNotReadableException`, which is what turns a malformed body
 * into a `400` rather than a `500`. A converter that yields no object — a body
 * of literal `null` — is a missing-body failure, not a null argument.
 */
function requireBody(text: string): Device {
  let device: Device | null;
  try {
    device = Device.fromJson(text);
  } catch (error: unknown) {
    if (error instanceof JsonParseError || error instanceof MismatchedInputError) {
      throw new HttpMessageNotReadableError(
        `Could not read document: ${error.message}; nested exception is ${error.name}: ${error.message}`,
      );
    }
    throw error;
  }
  if (device === null) {
    throw new HttpMessageNotReadableError(MISSING_REQUEST_BODY);
  }
  return device;
}

export class DeviceResource {
  constructor(private readonly deviceRepository: DeviceRepository) {}

  /** `POST /api/devices` */
  createDevice(device: Device): ResponseEntity<Record<string, unknown>> {
    if (device.contentBody !== null) {
      if (
        device.contentType === null ||
        device.httpVerb === null ||
        !SUPPORTED_VERBS.has(device.httpVerb.toLowerCase())
      ) {
        return new ResponseEntity<Record<string, unknown>>(null, null, 400);
      }
    } // add more validation like content type
    const deviceEntry = new DeviceDescriptor();
    deviceEntry.id = randomUUID();
    deviceEntry.name = device.name;
    deviceEntry.deviceType = device.deviceType;
    deviceEntry.onUrl = device.onUrl;
    deviceEntry.offUrl = device.offUrl;
    deviceEntry.contentType = device.contentType;
    deviceEntry.contentBody = device.contentBody;
    deviceEntry.httpVerb = device.httpVerb;

    this.deviceRepository.save(deviceEntry);

    return new ResponseEntity(deviceEntry.toJson(), null, 201);
  }

  /**
   * `PUT /api/devices/{lightId}`. Only these four fields are copied — the verb,
   * content type and content body keep whatever was stored.
   */
  updateDevice(id: string, device: Device): ResponseEntity<Record<string, unknown>> {
    const deviceEntry = this.deviceRepository.findOne(id);
    if (deviceEntry === null) {
      return new ResponseEntity<Record<string, unknown>>(null, null, 404);
    }

    deviceEntry.name = device.name;
    deviceEntry.deviceType = device.deviceType;
    deviceEntry.onUrl = device.onUrl;
    deviceEntry.offUrl = device.offUrl;

    this.deviceRepository.save(deviceEntry);

    return new ResponseEntity(deviceEntry.toJson(), null, 200);
  }

  /** `GET /api/devices` */
  findAllDevices(): ResponseEntity<Record<string, unknown>[]> {
    const deviceList = this.deviceRepository.findAll();
    const plainList = deviceList.map((device) => device.toJson());
    return new ResponseEntity(plainList, null, 200);
  }

  /** `GET /api/devices/{lightId}` */
  findByDevicId(id: string): ResponseEntity<Record<string, unknown>> {
    const descriptor = this.deviceRepository.findOne(id);
    if (descriptor === null) {
      return new ResponseEntity<Record<string, unknown>>(null, null, 404);
    }
    return new ResponseEntity(descriptor.toJson(), null, 200);
  }

  /** `DELETE /api/devices/{lightId}` */
  deleteDeviceById(id: string): ResponseEntity<string> {
    const deleted = this.deviceRepository.findOne(id);
    if (deleted === null) {
      return new ResponseEntity<string>(null, null, 404);
    }
    this.deviceRepository.delete(deleted);
    return new ResponseEntity<string>(null, null, 204);
  }

  mappings(): Mapping[] {
    return [
      {
        pattern: '/api/devices',
        method: 'POST',
        produces: 'application/json',
        requestBody: 'json',
        handle: (request) => this.createDevice(requireBody(request.body)),
      },
      {
        pattern: '/api/devices/{lightId}',
        method: 'PUT',
        produces: 'application/json',
        requestBody: 'json',
        handle: (request) =>
          this.updateDevice(request.pathVariables['lightId'] ?? '', requireBody(request.body)),
      },
      {
        pattern: '/api/devices',
        method: 'GET',
        produces: 'application/json',
        handle: () => this.findAllDevices(),
      },
      {
        pattern: '/api/devices/{lightId}',
        method: 'GET',
        produces: 'application/json',
        handle: (request) => this.findByDevicId(request.pathVariables['lightId'] ?? ''),
      },
      {
        pattern: '/api/devices/{lightId}',
        method: 'DELETE',
        produces: 'application/json',
        handle: (request) => this.deleteDeviceById(request.pathVariables['lightId'] ?? ''),
      },
    ];
  }
}

/**
 * The persistence layer: `DeviceRepository extends CrudRepository`, backed in
 * the original by Spring Data JPA over an embedded H2 file database
 * (`jdbc:h2:file:./store`, table `devices`, `ddl-auto=update`).
 *
 * H2's file format has no TypeScript counterpart that does not drag in a native
 * dependency, so the store is a JSON document beside the working directory —
 * `./store.json` where the original wrote `./store.mv.db`. What matters is
 * reproduced exactly, because it is observable through `GET /api/devices` and
 * through which 25-device page a light lands on:
 *
 *  - `findAll()` returns devices in **insertion** order, not id order;
 *  - saving an existing device **moves it to the end** of that order, which is
 *    what H2's MVStore does with an updated row;
 *  - the store survives a restart.
 *
 * Entities are returned by reference, as JPA returns managed instances: the
 * update endpoint mutates what `findOne` handed it and then saves it.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { IllegalArgumentError } from '../deps/http-client';
import { DeviceDescriptor } from './device-descriptor';

/** `org.springframework.data.domain.Pageable`. */
export class PageRequest {
  constructor(
    readonly pageNumber: number,
    readonly pageSize: number,
  ) {
    if (pageNumber < 0) {
      throw new IllegalArgumentError('Page index must not be less than zero!');
    }
    if (pageSize < 1) {
      throw new IllegalArgumentError('Page size must not be less than one!');
    }
  }

  get offset(): number {
    return this.pageNumber * this.pageSize;
  }
}

/** `org.springframework.data.domain.Page`, which handlers iterate over. */
export class Page<T> implements Iterable<T> {
  constructor(
    readonly content: readonly T[],
    readonly totalElements: number,
  ) {}

  [Symbol.iterator](): Iterator<T> {
    return this.content[Symbol.iterator]();
  }

  forEach(visit: (element: T) => void): void {
    this.content.forEach(visit);
  }
}

export const DEFAULT_STORE_PATH = './store.json';

export class DeviceRepository {
  private readonly devices: DeviceDescriptor[];

  constructor(private readonly storePath: string = DEFAULT_STORE_PATH) {
    this.devices = DeviceRepository.read(storePath);
  }

  private static read(storePath: string): DeviceDescriptor[] {
    let text: string;
    try {
      text = readFileSync(storePath, 'utf8');
    } catch {
      return [];
    }
    const parsed = JSON.parse(text) as { devices?: Record<string, unknown>[] };
    return (parsed.devices ?? []).map((row) => DeviceDescriptor.fromJson(row));
  }

  /** Commit. Written through a temporary file so a crash cannot truncate it. */
  private flush(): void {
    const payload = JSON.stringify({ devices: this.devices.map((device) => device.toJson()) });
    mkdirSync(dirname(this.storePath), { recursive: true });
    const temporary = `${this.storePath}.tmp`;
    writeFileSync(temporary, payload, 'utf8');
    renameSync(temporary, this.storePath);
  }

  /**
   * `CrudRepository.save`. An id that is already present is an update, and an
   * update moves the row to the end of the scan order.
   */
  save(entity: DeviceDescriptor): DeviceDescriptor {
    const existing = this.devices.findIndex((device) => device.id === entity.id);
    if (existing >= 0) {
      this.devices.splice(existing, 1);
    }
    this.devices.push(entity);
    this.flush();
    return entity;
  }

  /** `DeviceRepository.findAll()`. */
  findAll(): DeviceDescriptor[] {
    return [...this.devices];
  }

  /** `DeviceRepository.findOne(String id)` — null when the id is unknown. */
  findOne(id: string): DeviceDescriptor | null {
    return this.devices.find((device) => device.id === id) ?? null;
  }

  /** `CrudRepository.delete(T entity)`. */
  delete(entity: DeviceDescriptor): void {
    const existing = this.devices.findIndex((device) => device.id === entity.id);
    if (existing >= 0) {
      this.devices.splice(existing, 1);
      this.flush();
    }
  }

  /** `DeviceRepository.findByDeviceType(String type, Pageable request)`. */
  findByDeviceType(type: string, request: PageRequest): Page<DeviceDescriptor> {
    const matching = this.devices.filter((device) => device.deviceType === type);
    const window = matching.slice(request.offset, request.offset + request.pageSize);
    return new Page(window, matching.length);
  }
}

/** Paging, ordering and durability — what Spring Data over H2 used to supply. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DeviceDescriptor } from '../src/dao/device-descriptor';
import { DeviceRepository, Page, PageRequest } from '../src/dao/device-repository';
import { IllegalArgumentError } from '../src/deps/http-client';
import { scratchStore } from './support';

function descriptor(id: string, name: string, deviceType = 'switch'): DeviceDescriptor {
  const device = new DeviceDescriptor();
  device.id = id;
  device.name = name;
  device.deviceType = deviceType;
  return device;
}

describe('PageRequest', () => {
  it('computes the offset', () => {
    expect(new PageRequest(2, 25).offset).toBe(50);
  });

  it('rejects a negative page and a zero page size', () => {
    expect(() => new PageRequest(-1, 25)).toThrow(IllegalArgumentError);
    expect(() => new PageRequest(0, 0)).toThrow(IllegalArgumentError);
  });
});

describe('Page', () => {
  it('is iterable and for-each-able', () => {
    const page = new Page(['a', 'b'], 2);
    expect([...page]).toEqual(['a', 'b']);
    const seen: string[] = [];
    page.forEach((element) => seen.push(element));
    expect(seen).toEqual(['a', 'b']);
    expect(page.totalElements).toBe(2);
  });
});

describe('DeviceRepository', () => {
  let store: ReturnType<typeof scratchStore>;
  let repository: DeviceRepository;

  beforeEach(() => {
    store = scratchStore();
    repository = new DeviceRepository(store.path);
  });

  afterEach(() => {
    store.remove();
  });

  it('starts empty when there is no store file', () => {
    expect(repository.findAll()).toEqual([]);
    expect(repository.findOne('anything')).toBeNull();
  });

  it('saves and reads back by id', () => {
    const device = descriptor('a', 'first');
    expect(repository.save(device)).toBe(device);
    expect(repository.findOne('a')).toBe(device);
  });

  it('keeps insertion order in findAll', () => {
    repository.save(descriptor('a', 'first'));
    repository.save(descriptor('b', 'second'));
    repository.save(descriptor('c', 'third'));
    expect(repository.findAll().map((device) => device.id)).toEqual(['a', 'b', 'c']);
  });

  it('moves an updated device to the end, as an H2 row move does', () => {
    const first = descriptor('a', 'first');
    repository.save(first);
    repository.save(descriptor('b', 'second'));

    first.name = 'renamed';
    repository.save(first);

    expect(repository.findAll().map((device) => device.id)).toEqual(['b', 'a']);
    expect(repository.findOne('a')?.name).toBe('renamed');
  });

  it('deletes, and ignores a delete of something already gone', () => {
    const device = descriptor('a', 'first');
    repository.save(device);
    repository.delete(device);
    expect(repository.findAll()).toEqual([]);
    repository.delete(device);
    expect(repository.findAll()).toEqual([]);
  });

  it('filters by deviceType and windows to 25 rows a page', () => {
    for (let i = 0; i < 60; i++) {
      repository.save(descriptor(`s${String(i)}`, `switch ${String(i)}`));
    }
    repository.save(descriptor('d1', 'dimmer', 'dimmer'));

    const page0 = repository.findByDeviceType('switch', new PageRequest(0, 25));
    const page1 = repository.findByDeviceType('switch', new PageRequest(1, 25));
    const page2 = repository.findByDeviceType('switch', new PageRequest(2, 25));

    expect(page0.content).toHaveLength(25);
    expect(page1.content).toHaveLength(25);
    expect(page2.content).toHaveLength(10);
    expect(page0.totalElements).toBe(60);
    expect(page0.content[0]?.id).toBe('s0');
    expect(page1.content[0]?.id).toBe('s25');
    expect(repository.findByDeviceType('dimmer', new PageRequest(0, 25)).content).toHaveLength(1);
  });

  it('survives a restart', () => {
    repository.save(descriptor('a', 'persisted'));
    const reopened = new DeviceRepository(store.path);
    expect(reopened.findOne('a')?.name).toBe('persisted');
  });

  it('hands out a copy of the list, not the backing array', () => {
    repository.save(descriptor('a', 'first'));
    repository.findAll().pop();
    expect(repository.findAll()).toHaveLength(1);
  });
});

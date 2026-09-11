/** The templating rule and the outbound call, driven directly. */

import { describe, expect, it, vi } from 'vitest';

import { DeviceDescriptor } from '../src/dao/device-descriptor';
import { DeviceRepository } from '../src/dao/device-repository';
import {
  HttpIOError,
  IllegalArgumentError,
  type HttpClient,
  type HttpUriRequest,
} from '../src/deps/http-client';
import { HueMulator } from '../src/hue/hue-mulator';
import { scratchStore } from './support';

function emulator(client: HttpClient): HueMulator {
  const store = scratchStore();
  const repository = new DeviceRepository(store.path);
  store.remove();
  return new HueMulator(repository, 8080, client);
}

const alwaysOk: HttpClient = { execute: () => Promise.resolve(200) };

describe('replaceIntensityValue', () => {
  it('returns the empty string for a null template', () => {
    expect(HueMulator.replaceIntensityValue(null, 128)).toBe('');
  });

  it('leaves a template with no placeholder alone', () => {
    expect(HueMulator.replaceIntensityValue('http://x/on', 128)).toBe('http://x/on');
  });

  it('substitutes every intensity.byte with the raw brightness', () => {
    expect(
      HueMulator.replaceIntensityValue('a=${intensity.byte}&b=${intensity.byte}', 77),
    ).toBe('a=77&b=77');
  });

  it('rounds intensity.percent to 0-100', () => {
    expect(HueMulator.replaceIntensityValue('p=${intensity.percent}', 0)).toBe('p=0');
    expect(HueMulator.replaceIntensityValue('p=${intensity.percent}', 128)).toBe('p=50');
    expect(HueMulator.replaceIntensityValue('p=${intensity.percent}', 191)).toBe('p=75');
    expect(HueMulator.replaceIntensityValue('p=${intensity.percent}', 255)).toBe('p=100');
  });

  it('rounds half up, as Math.round on a positive double does', () => {
    // 3/255*100 = 1.176…, 4/255*100 = 1.568…
    expect(HueMulator.replaceIntensityValue('p=${intensity.percent}', 3)).toBe('p=1');
    expect(HueMulator.replaceIntensityValue('p=${intensity.percent}', 4)).toBe('p=2');
  });

  it('substitutes only the byte placeholder when both are present', () => {
    expect(
      HueMulator.replaceIntensityValue('b=${intensity.byte}&p=${intensity.percent}', 200),
    ).toBe('b=200&p=${intensity.percent}');
  });
});

describe('doHttpRequest', () => {
  it('issues a GET when the verb is null or GET, in any case', async () => {
    const execute = vi.fn((_request: HttpUriRequest | null) => Promise.resolve(200));
    const hue = emulator({ execute });

    expect(await hue.doHttpRequest('http://host/a', null, null, '')).toBe(true);
    expect(await hue.doHttpRequest('http://host/a', 'get', null, '')).toBe(true);
    expect(await hue.doHttpRequest('http://host/a', 'GET', null, '')).toBe(true);
    expect(execute.mock.calls.map(([request]) => request?.method)).toEqual([
      'GET',
      'GET',
      'GET',
    ]);
  });

  it('issues POST and PUT with the stored content type and body', async () => {
    const execute = vi.fn((_request: HttpUriRequest | null) => Promise.resolve(201));
    const hue = emulator({ execute });

    await hue.doHttpRequest('http://host/a', 'post', 'application/json', '{"a":1}');
    await hue.doHttpRequest('http://host/a', 'PuT', 'text/plain', 'body');

    expect(execute.mock.calls.map(([request]) => request)).toMatchObject([
      { method: 'POST', contentType: 'application/json', body: '{"a":1}' },
      { method: 'PUT', contentType: 'text/plain', body: 'body' },
    ]);
  });

  it('accepts every 2xx and rejects everything else', async () => {
    for (const [code, expected] of [
      [200, true],
      [204, true],
      [299, true],
      [300, false],
      [199, false],
      [500, false],
    ] as const) {
      const hue = emulator({ execute: () => Promise.resolve(code) });
      expect(await hue.doHttpRequest('http://host/a', null, null, '')).toBe(expected);
    }
  });

  it('swallows an IOException and reports failure', async () => {
    const hue = emulator({ execute: () => Promise.reject(new HttpIOError('refused')) });
    expect(await hue.doHttpRequest('http://host/a', null, null, '')).toBe(false);
  });

  it('lets an IllegalArgumentException escape, so the handler 500s', async () => {
    const hue = emulator({
      execute: () => {
        throw new IllegalArgumentError('HTTP request may not be null');
      },
    });
    await expect(hue.doHttpRequest('http://host/a', null, null, '')).rejects.toBeInstanceOf(
      IllegalArgumentError,
    );
  });

  it('passes a null request through for an unsupported verb', async () => {
    const execute = vi.fn((_request: HttpUriRequest | null) => Promise.resolve(200));
    const hue = emulator({ execute });
    await hue.doHttpRequest('http://host/a', 'DELETE', null, '');
    expect(execute).toHaveBeenCalledWith(null);
  });
});

describe('mappings', () => {
  it('declares the five hue routes the Echo uses', () => {
    const hue = emulator(alwaysOk);
    expect(hue.mappings().map((mapping) => `${mapping.method} ${mapping.pattern}`)).toEqual([
      'GET /api/{userId}/lights',
      'POST /api/*',
      'GET /api/{userId}',
      'GET /api/{userId}/lights/{lightId}',
      'PUT /api/{userId}/lights/{lightId}/state',
    ]);
  });

  it('leaves the state route without a produces, so it answers text/plain', () => {
    const state = emulator(alwaysOk)
      .mappings()
      .find((mapping) => mapping.pattern.endsWith('/state'));
    expect(state?.produces).toBeUndefined();
  });
});

describe('page selection', () => {
  it('derives the page number from the port the request arrived on', () => {
    const store = scratchStore();
    const repository = new DeviceRepository(store.path);
    for (let i = 0; i < 30; i++) {
      const device = new DeviceDescriptor();
      device.id = `id-${String(i)}`;
      device.name = `light ${String(i)}`;
      device.deviceType = 'switch';
      repository.save(device);
    }
    const hue = new HueMulator(repository, 8080, alwaysOk);
    const request = {
      method: 'GET',
      path: '/api/u/lights',
      pathVariables: {},
      headers: {},
      body: '',
      remoteAddr: '127.0.0.1',
      localAddr: '127.0.0.1',
      localPort: 8081,
      description: 'GET /api/u/lights',
    };

    const page1 = hue.getUpnpConfiguration('u', request);
    expect(Object.keys(page1.body ?? {})).toHaveLength(5);

    const page0 = hue.getUpnpConfiguration('u', { ...request, localPort: 8080 });
    expect(Object.keys(page0.body ?? {})).toHaveLength(25);

    store.remove();
  });
});

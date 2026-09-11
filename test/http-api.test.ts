/**
 * End-to-end assertions over the running listeners, covering the surface that
 * Spring MVC, Jackson and Spring Data used to provide: status codes, headers,
 * key order, null inclusion, paging, and the framework error documents.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Application } from '../src/application';
import { Environment } from '../src/environment';
import { OPTIONS_ALLOW } from '../src/deps/mvc';
import {
  call,
  freePort,
  freeUdpPort,
  json,
  scratchStore,
  startStubGateway,
  TEST_PROPERTIES,
  type StubGateway,
} from './support';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('HTTP surface', () => {
  let application: Application;
  let gateway: StubGateway;
  let removeStore: () => void;
  let base: number;

  async function create(payload: Record<string, unknown>): Promise<string> {
    const response = await json(base, 'POST', '/api/devices', payload);
    expect(response.status).toBe(201);
    return (JSON.parse(response.body) as { id: string }).id;
  }

  beforeAll(async () => {
    const store = scratchStore();
    removeStore = store.remove;
    gateway = await startStubGateway();
    base = await freePort();
    const environment = Environment.load(
      [
        `--emulator.portbase=${String(base)}`,
        `--upnp.response.port=${String(await freeUdpPort())}`,
        '--upnp.disable=true',
      ],
      {},
      TEST_PROPERTIES,
    );
    application = await Application.run(environment, {
      storePath: store.path,
      discoveryPort: await freeUdpPort(),
    });
  });

  afterAll(async () => {
    await application.close();
    await gateway.close();
    removeStore();
  });

  describe('device management API', () => {
    it('creates a device with a generated uuid and echoes the descriptor', async () => {
      const response = await json(base, 'POST', '/api/devices', {
        name: 'office light',
        deviceType: 'switch',
        onUrl: gateway.url('/ok/200?state=on'),
        offUrl: gateway.url('/ok/200?state=off'),
      });

      expect(response.status).toBe(201);
      expect(response.headers['content-type']).toBe('application/json;charset=UTF-8');
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body['id']).toMatch(UUID);
      expect(Object.keys(body)).toEqual([
        'id',
        'name',
        'deviceType',
        'offUrl',
        'onUrl',
        'httpVerb',
        'contentType',
        'contentBody',
      ]);
      expect(body['httpVerb']).toBeNull();
      expect(body['contentType']).toBeNull();
      expect(body['contentBody']).toBeNull();
    });

    it('rejects a contentBody with no contentType with an empty 400', async () => {
      const response = await json(base, 'POST', '/api/devices', {
        name: 'bad',
        deviceType: 'switch',
        contentBody: '{}',
      });
      expect(response.status).toBe(400);
      expect(response.body).toBe('');
      expect(response.headers['content-type']).toBeUndefined();
      expect(response.headers['content-length']).toBe('0');
    });

    it('rejects a contentBody with an unsupported httpVerb', async () => {
      const response = await json(base, 'POST', '/api/devices', {
        name: 'bad',
        deviceType: 'switch',
        contentBody: '{}',
        contentType: 'application/json',
        httpVerb: 'DELETE',
      });
      expect(response.status).toBe(400);
      expect(response.body).toBe('');
    });

    it('accepts a contentBody whose verb differs only in case', async () => {
      const response = await json(base, 'POST', '/api/devices', {
        name: 'post device',
        deviceType: 'switch',
        onUrl: gateway.url('/ok/200'),
        offUrl: gateway.url('/ok/200'),
        contentBody: '{"fooBar":"baz"}',
        contentType: 'application/json',
        httpVerb: 'POST',
      });
      expect(response.status).toBe(201);
    });

    it('ignores unknown properties in the request body', async () => {
      const response = await json(base, 'POST', '/api/devices', {
        name: 'extra',
        deviceType: 'switch',
        totallyUnknown: 42,
      });
      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).not.toHaveProperty('totallyUnknown');
    });

    it('answers 400 with the framework error document for malformed json', async () => {
      const response = await call(base, 'POST', '/api/devices', '{not json', {
        'Content-Type': 'application/json',
      });
      expect(response.status).toBe(400);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body['status']).toBe(400);
      expect(body['error']).toBe('Bad Request');
      expect(body['path']).toBe('/api/devices');
      expect(typeof body['timestamp']).toBe('number');
    });

    it('answers 415 for a non-json content type, naming the forced charset', async () => {
      const response = await call(base, 'POST', '/api/devices', '{}', {
        'Content-Type': 'text/plain',
      });
      expect(response.status).toBe(415);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body['error']).toBe('Unsupported Media Type');
      expect(body['message']).toBe("Content type 'text/plain;charset=UTF-8' not supported");
    });

    it('answers 415 naming application/octet-stream when no content type is sent', async () => {
      // Verified against the running original, which reports exactly this.
      const response = await call(base, 'POST', '/api/devices', '{}');
      expect(response.status).toBe(415);
      expect((JSON.parse(response.body) as { message: string }).message).toBe(
        "Content type 'application/octet-stream' not supported",
      );
    });

    it('answers 400 when the request body is a literal null', async () => {
      const response = await call(base, 'POST', '/api/devices', 'null', {
        'Content-Type': 'application/json',
      });
      expect(response.status).toBe(400);
      expect((JSON.parse(response.body) as { message: string }).message).toContain(
        'Required request body content is missing',
      );
    });

    it('answers 400 when the request body is empty', async () => {
      const response = await call(base, 'POST', '/api/devices', '', {
        'Content-Type': 'application/json',
      });
      expect(response.status).toBe(400);
      expect((JSON.parse(response.body) as { message: string }).message).toContain(
        'Required request body content is missing',
      );
    });

    it('answers 406 when Accept cannot take application/json', async () => {
      const response = await json(
        base,
        'POST',
        '/api/devices',
        { name: 'x', deviceType: 'switch' },
        { Accept: 'text/plain' },
      );
      expect(response.status).toBe(406);
      expect(response.body).toBe('');
    });

    it('reads back a device by id and 404s an unknown one', async () => {
      const id = await create({ name: 'readable', deviceType: 'switch' });

      const found = await call(base, 'GET', `/api/devices/${id}`);
      expect(found.status).toBe(200);
      expect((JSON.parse(found.body) as { name: string }).name).toBe('readable');

      const missing = await call(base, 'GET', '/api/devices/does-not-exist');
      expect(missing.status).toBe(404);
      expect(missing.body).toBe('');
    });

    it('updates only name, deviceType, onUrl and offUrl', async () => {
      const id = await create({
        name: 'before',
        deviceType: 'switch',
        onUrl: 'http://example.invalid/on',
        offUrl: 'http://example.invalid/off',
        httpVerb: 'PUT',
        contentType: 'text/plain',
        contentBody: 'keep me',
      });

      const updated = await json(base, 'PUT', `/api/devices/${id}`, {
        name: 'after',
        deviceType: 'switch',
        onUrl: 'http://example.invalid/on2',
        offUrl: 'http://example.invalid/off2',
        httpVerb: 'GET',
        contentType: 'application/json',
        contentBody: 'replaced',
      });

      expect(updated.status).toBe(200);
      const body = JSON.parse(updated.body) as Record<string, unknown>;
      expect(body['name']).toBe('after');
      expect(body['onUrl']).toBe('http://example.invalid/on2');
      expect(body['httpVerb']).toBe('PUT');
      expect(body['contentType']).toBe('text/plain');
      expect(body['contentBody']).toBe('keep me');
    });

    it('404s an update of an unknown device', async () => {
      const response = await json(base, 'PUT', '/api/devices/nope', {
        name: 'x',
        deviceType: 'switch',
      });
      expect(response.status).toBe(404);
      expect(response.body).toBe('');
    });

    it('deletes with 204 and 404s a second delete', async () => {
      const id = await create({ name: 'transient', deviceType: 'switch' });

      const first = await call(base, 'DELETE', `/api/devices/${id}`);
      expect(first.status).toBe(204);
      expect(first.body).toBe('');

      const second = await call(base, 'DELETE', `/api/devices/${id}`);
      expect(second.status).toBe(404);
    });

    it('lists devices in insertion order and moves an updated device to the end', async () => {
      const first = await create({ name: 'order-1', deviceType: 'orderTest' });
      const second = await create({ name: 'order-2', deviceType: 'orderTest' });

      const before = await call(base, 'GET', '/api/devices');
      const ids = (JSON.parse(before.body) as { id: string }[]).map((device) => device.id);
      expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));

      await json(base, 'PUT', `/api/devices/${first}`, { name: 'order-1', deviceType: 'orderTest' });

      const after = await call(base, 'GET', '/api/devices');
      const reordered = (JSON.parse(after.body) as { id: string }[]).map((device) => device.id);
      expect(reordered[reordered.length - 1]).toBe(first);
    });
  });

  describe('hue emulation API', () => {
    it('answers the bridge registration handshake on any /api/* path', async () => {
      for (const path of ['/api/anything', '/api/']) {
        const response = await json(base, 'POST', path, { devicetype: 'Echo' });
        expect(response.status).toBe(200);
        expect(response.body).toBe('[{"success":{"username":"lights"}}]');
        expect(response.byteLength).toBe(35);
        expect(response.headers['content-type']).toBe('application/json;charset=UTF-8');
      }
    });

    it('renders a light with the LCT001 constants in Jackson field order', async () => {
      const id = await create({ name: 'hue light', deviceType: 'switch' });

      const response = await call(base, 'GET', `/api/testuser/lights/${id}`);
      expect(response.status).toBe(200);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual([
        'state',
        'type',
        'name',
        'modelid',
        'manufacturername',
        'uniqueid',
        'swversion',
        'pointsymbol',
      ]);
      expect(body['state']).toEqual({
        on: false,
        bri: 254,
        hue: 15823,
        sat: 88,
        effect: 'none',
        ct: 313,
        alert: 'none',
        colormode: 'ct',
        reachable: true,
        xy: [0.4255, 0.3998],
      });
      expect(body['type']).toBe('Extended color light');
      expect(body['modelid']).toBe('LCT001');
      expect(body['manufacturername']).toBe('Philips');
      expect(body['swversion']).toBe('65003148');
      expect(body['uniqueid']).toBe(id);
      expect(body['pointsymbol']).toEqual({
        1: 'none',
        2: 'none',
        3: 'none',
        4: 'none',
        5: 'none',
        6: 'none',
        7: 'none',
        8: 'none',
      });
    });

    it('404s a light that is not registered', async () => {
      const response = await call(base, 'GET', '/api/testuser/lights/nope');
      expect(response.status).toBe(404);
      expect(response.body).toBe('');
    });

    it('lists only switches, keyed by id, on the page the port selects', async () => {
      const id = await create({ name: 'switchy', deviceType: 'switch' });
      const other = await create({ name: 'not a switch', deviceType: 'dimmer' });

      const page0 = await call(base, 'GET', '/api/testuser/lights');
      const listed = JSON.parse(page0.body) as Record<string, string>;
      expect(listed[id]).toBe('switchy');
      expect(listed).not.toHaveProperty(other);

      const page1 = await call(base + 1, 'GET', '/api/testuser/lights');
      expect(JSON.parse(page1.body)).toEqual({});
    });

    it('wraps the page in a lights object at the api root', async () => {
      const id = await create({ name: 'rooted', deviceType: 'switch' });

      const response = await call(base, 'GET', '/api/testuser');
      expect(response.status).toBe(200);
      const body = JSON.parse(response.body) as { lights: Record<string, { name: string }> };
      expect(body.lights[id]?.name).toBe('rooted');

      const page1 = await call(base + 1, 'GET', '/api/testuser');
      expect(JSON.parse(page1.body)).toEqual({ lights: {} });
    });

    it('routes /api/devices to the device resource, not the hue emulator', async () => {
      const response = await call(base, 'GET', '/api/devices');
      expect(response.status).toBe(200);
      expect(Array.isArray(JSON.parse(response.body))).toBe(true);
    });
  });

  describe('state change', () => {
    it('calls the on url and answers the hue success document as text/plain', async () => {
      const id = await create({
        name: 'switchable',
        deviceType: 'switch',
        onUrl: gateway.url('/ok/200?state=on'),
        offUrl: gateway.url('/ok/200?state=off'),
      });
      const before = gateway.calls.length;

      const response = await json(base, 'PUT', `/api/u/lights/${id}/state`, { on: true });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/plain;charset=UTF-8');
      expect(response.body).toBe(`[{"success":{"/lights/${id}/state/on":true}}]`);
      expect(gateway.calls.slice(before).map((c) => c.path)).toEqual(['/ok/200?state=on']);
    });

    it('calls the off url when the body says off, and when it says nothing', async () => {
      const id = await create({
        name: 'switchable-off',
        deviceType: 'switch',
        onUrl: gateway.url('/ok/200?state=on'),
        offUrl: gateway.url('/ok/200?state=off'),
      });

      const explicit = await json(base, 'PUT', `/api/u/lights/${id}/state`, { on: false });
      expect(explicit.body).toBe(`[{"success":{"/lights/${id}/state/on":false}}]`);

      const implicit = await json(base, 'PUT', `/api/u/lights/${id}/state`, { whatever: 1 });
      expect(implicit.status).toBe(200);
      expect(implicit.body).toBe(`[{"success":{"/lights/${id}/state/on":false}}]`);
    });

    it('accepts the form-encoded content type the Echo actually sends', async () => {
      const id = await create({
        name: 'form encoded',
        deviceType: 'switch',
        onUrl: gateway.url('/ok/200'),
        offUrl: gateway.url('/ok/200'),
      });
      const response = await call(base, 'PUT', `/api/u/lights/${id}/state`, '{"on":true}', {
        'Content-Type': 'application/x-www-form-urlencoded',
      });
      expect(response.status).toBe(200);
    });

    it('substitutes intensity.percent with a rounded 0-100 value', async () => {
      const id = await create({
        name: 'dimmer pct',
        deviceType: 'switch',
        onUrl: gateway.url('/ok/200?level=${intensity.percent}'),
        offUrl: gateway.url('/ok/200?level=0'),
      });

      let before = gateway.calls.length;
      await json(base, 'PUT', `/api/u/lights/${id}/state`, { on: true, bri: 128 });
      expect(gateway.calls[before]?.path).toBe('/ok/200?level=50');

      before = gateway.calls.length;
      await json(base, 'PUT', `/api/u/lights/${id}/state`, { on: true });
      expect(gateway.calls[before]?.path).toBe('/ok/200?level=100');
    });

    it('substitutes every occurrence of intensity.byte with the raw value', async () => {
      const id = await create({
        name: 'dimmer byte',
        deviceType: 'switch',
        onUrl: gateway.url('/ok/200?level=${intensity.byte}&again=${intensity.byte}'),
        offUrl: gateway.url('/ok/200?level=0'),
      });

      const before = gateway.calls.length;
      await json(base, 'PUT', `/api/u/lights/${id}/state`, { on: true, bri: 77 });
      expect(gateway.calls[before]?.path).toBe('/ok/200?level=77&again=77');
    });

    it('sends the stored verb, content type and templated body', async () => {
      const id = await create({
        name: 'poster',
        deviceType: 'switch',
        onUrl: gateway.url('/ok/200?p=on'),
        offUrl: gateway.url('/ok/200?p=off'),
        httpVerb: 'POST',
        contentType: 'application/json',
        contentBody: '{"level":${intensity.byte}}',
      });

      const before = gateway.calls.length;
      await json(base, 'PUT', `/api/u/lights/${id}/state`, { on: true, bri: 10 });

      expect(gateway.calls[before]).toMatchObject({
        method: 'POST',
        path: '/ok/200?p=on',
        contentType: 'application/json',
        body: '{"level":10}',
      });
    });

    it('treats any 2xx as success and anything else as 503', async () => {
      const ok = await create({
        name: 'no content gateway',
        deviceType: 'switch',
        onUrl: gateway.url('/ok/204'),
        offUrl: gateway.url('/ok/204'),
      });
      expect((await json(base, 'PUT', `/api/u/lights/${ok}/state`, { on: true })).status).toBe(200);

      const broken = await create({
        name: 'broken gateway',
        deviceType: 'switch',
        onUrl: gateway.url('/ok/500'),
        offUrl: gateway.url('/ok/500'),
      });
      const failed = await json(base, 'PUT', `/api/u/lights/${broken}/state`, { on: true });
      expect(failed.status).toBe(503);
      expect(failed.body).toBe('');
      expect(failed.headers['content-type']).toBeUndefined();
    });

    it('answers 503 when the gateway cannot be reached', async () => {
      const id = await create({
        name: 'unreachable',
        deviceType: 'switch',
        onUrl: 'http://127.0.0.1:9/nope',
        offUrl: 'http://127.0.0.1:9/nope',
      });
      expect((await json(base, 'PUT', `/api/u/lights/${id}/state`, { on: true })).status).toBe(503);
    });

    it('answers 503 when the device has no url at all', async () => {
      const id = await create({ name: 'urlless', deviceType: 'switch' });
      expect((await json(base, 'PUT', `/api/u/lights/${id}/state`, { on: true })).status).toBe(503);
    });

    it('404s before parsing failures matter, for an unknown light', async () => {
      const response = await json(base, 'PUT', '/api/u/lights/nope/state', { on: true });
      expect(response.status).toBe(404);
      expect(response.body).toBe('');
    });

    it('answers the framework 400 document for a missing body', async () => {
      const id = await create({ name: 'empty body target', deviceType: 'switch' });
      const response = await call(base, 'PUT', `/api/u/lights/${id}/state`, '');
      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toBe('application/json;charset=UTF-8');
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body['exception']).toBe('HttpMessageNotReadableException');
      expect(body['message']).toContain('Required request body content is missing');
      expect(body['path']).toBe(`/api/u/lights/${id}/state`);
    });

    it('answers an empty 400 for an unparsable body', async () => {
      const id = await create({ name: 'parse target', deviceType: 'switch' });
      const response = await call(base, 'PUT', `/api/u/lights/${id}/state`, '{oops');
      expect(response.status).toBe(400);
      expect(response.body).toBe('');
      expect(response.headers['content-type']).toBeUndefined();
    });

    describe('defects of the original that are reproduced, not repaired', () => {
      it('500s when intensity.byte substitution leaves intensity.percent behind', async () => {
        const id = await create({
          name: 'both placeholders',
          deviceType: 'switch',
          onUrl: gateway.url('/ok/200?b=${intensity.byte}&p=${intensity.percent}'),
          offUrl: gateway.url('/ok/200'),
        });
        const response = await json(base, 'PUT', `/api/u/lights/${id}/state`, { on: true, bri: 200 });
        expect(response.status).toBe(500);
        const body = JSON.parse(response.body) as Record<string, unknown>;
        expect(body['exception']).toBe('IllegalArgumentException');
        expect(body['message']).toBe(
          `Illegal character in query at index ${String(
            gateway.url('/ok/200?b=200&p=$').length,
          )}: ${gateway.url('/ok/200?b=200&p=${intensity.percent}')}`,
        );
      });

      it('500s for a stored verb that is neither GET, POST nor PUT', async () => {
        const id = await create({
          name: 'verb delete',
          deviceType: 'switch',
          onUrl: gateway.url('/ok/200'),
          offUrl: gateway.url('/ok/200'),
          httpVerb: 'DELETE',
        });
        const response = await json(base, 'PUT', `/api/u/lights/${id}/state`, { on: true });
        expect(response.status).toBe(500);
        expect((JSON.parse(response.body) as { message: string }).message).toBe(
          'HTTP request may not be null',
        );
      });

      it('500s for a POST device stored without a content type', async () => {
        const id = await create({
          name: 'post no content type',
          deviceType: 'switch',
          onUrl: gateway.url('/ok/200'),
          offUrl: gateway.url('/ok/200'),
          httpVerb: 'POST',
        });
        const response = await json(base, 'PUT', `/api/u/lights/${id}/state`, { on: true });
        expect(response.status).toBe(500);
        expect((JSON.parse(response.body) as { message: string }).message).toBe(
          'Content type may not be null',
        );
      });

      it('500s for a request body of literal null', async () => {
        const id = await create({ name: 'null body', deviceType: 'switch' });
        const response = await call(base, 'PUT', `/api/u/lights/${id}/state`, 'null');
        expect(response.status).toBe(500);
        const body = JSON.parse(response.body) as Record<string, unknown>;
        expect(body['exception']).toBe('NullPointerException');
        expect(body['message']).toBe('No message available');
      });
    });
  });

  describe('upnp device description', () => {
    it('renders setup.xml with the local address and port', async () => {
      const response = await call(base, 'GET', '/upnp/amazon-ha-bridge0/setup.xml');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/xml;charset=UTF-8');
      expect(response.body).toContain(`<URLBase>http://127.0.0.1:${String(base)}/</URLBase>`);
      expect(response.body).toContain('<friendlyName>Amazon-Echo-HA-Bridge (127.0.0.1)</friendlyName>');
      expect(response.body).toContain('<serialNumber>amazon-ha-bridge0</serialNumber>');
      expect(response.body).toContain('<UDN>uuid:amazon-ha-bridge0</UDN>');
      expect(response.body).toContain('<manufacturerURL>http://www.armzilla..com</manufacturerURL>');
      expect(response.body).toContain('<serviceType>(null)</serviceType>');
      expect(response.body.endsWith('</root>\n')).toBe(true);
    });

    it('reports the port the request arrived on', async () => {
      const response = await call(base + 2, 'GET', '/upnp/amazon-ha-bridge2/setup.xml');
      expect(response.body).toContain(`<URLBase>http://127.0.0.1:${String(base + 2)}/</URLBase>`);
    });
  });

  describe('framework surface', () => {
    it('puts the CORS headers and the application context header on every response', async () => {
      for (const response of [
        await call(base, 'GET', '/api/devices'),
        await call(base, 'GET', '/definitely-not-here'),
        await call(base, 'GET', '/configurator.html'),
      ]) {
        expect(response.headers['access-control-allow-origin']).toBe('*');
        expect(response.headers['access-control-allow-methods']).toBe('POST, GET, OPTIONS, DELETE, PUT');
        expect(response.headers['access-control-max-age']).toBe('3600');
        expect(response.headers['access-control-allow-headers']).toBe(
          'Origin, X-Requested-With, Content-Type, Accept',
        );
        expect(response.headers['x-application-context']).toBe('application');
      }
    });

    it('answers OPTIONS from the container with the servlet Allow list', async () => {
      const response = await call(base, 'OPTIONS', '/api/devices');
      expect(response.status).toBe(200);
      expect(response.headers['allow']).toBe(OPTIONS_ALLOW);
      expect(response.headers['content-length']).toBe('0');
      expect(response.body).toBe('');
    });

    it('answers 405 with the methods mapped on the path', async () => {
      const response = await call(base, 'PATCH', '/api/devices');
      expect(response.status).toBe(405);
      expect(response.headers['allow']).toBe('GET, POST');
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body['error']).toBe('Method Not Allowed');
      expect(body['message']).toBe("Request method 'PATCH' not supported");
      expect(body['path']).toBe('/api/devices');
    });

    it('answers 404 with the error document and no exception key', async () => {
      const response = await call(base, 'GET', '/definitely-not-here');
      expect(response.status).toBe(404);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(['timestamp', 'status', 'error', 'message', 'path']);
      expect(body['message']).toBe('No message available');
      expect(body['path']).toBe('/definitely-not-here');
    });

    it('does not map the context root', async () => {
      expect((await call(base, 'GET', '/')).status).toBe(404);
    });

    it('serves the configurator and its script from the static resources', async () => {
      const page = await call(base, 'GET', '/configurator.html');
      expect(page.status).toBe(200);
      expect(page.headers['content-type']).toBe('text/html;charset=UTF-8');
      expect(page.body).toContain('Amazon Echo Bridge Configuration');

      const script = await call(base, 'GET', '/app.js');
      expect(script.status).toBe(200);
      expect(script.headers['content-type']).toBe('application/javascript;charset=UTF-8');
      expect(script.body).toContain("angular.module('configurator'");
    });

    it('refuses to escape the static root', async () => {
      expect((await call(base, 'GET', '/../package.json')).status).toBe(404);
    });

    it('answers the actuator health endpoint', async () => {
      const response = await call(base, 'GET', '/health');
      expect(response.status).toBe(200);
      expect(response.body).toBe('{"status":"UP"}');
    });
  });
});

/** The wire shape of every payload, and the constants inside it. */

import { describe, expect, it } from 'vitest';

import { Device } from '../src/api/device';
import { DeviceResponse, pointsymbol } from '../src/api/hue/device-response';
import { DeviceState } from '../src/api/hue/device-state';
import { HueApiResponse } from '../src/api/hue/hue-api-response';
import { DeviceDescriptor } from '../src/dao/device-descriptor';
import { MismatchedInputError } from '../src/deps/jackson';

describe('Device', () => {
  it('binds every documented field and ignores the rest', () => {
    const device = Device.fromJson(
      JSON.stringify({
        name: 'n',
        deviceType: 'switch',
        offUrl: 'off',
        onUrl: 'on',
        httpVerb: 'POST',
        contentType: 'application/json',
        contentBody: '{}',
        nonsense: true,
      }),
    );
    expect(device).toMatchObject({
      name: 'n',
      deviceType: 'switch',
      offUrl: 'off',
      onUrl: 'on',
      httpVerb: 'POST',
      contentType: 'application/json',
      contentBody: '{}',
    });
    expect(device).not.toHaveProperty('nonsense');
  });

  it('defaults every absent field to null', () => {
    const device = Device.fromJson('{}');
    expect(device).toEqual(new Device());
  });

  it('binds a literal null document to null', () => {
    expect(Device.fromJson('null')).toBeNull();
  });
});

describe('DeviceState', () => {
  it('defaults bri to 255 and everything else to the java field defaults', () => {
    const state = DeviceState.fromJson('{}');
    expect(state?.toJson()).toEqual({
      on: false,
      bri: 255,
      hue: 0,
      sat: 0,
      effect: null,
      ct: 0,
      alert: null,
      colormode: null,
      reachable: false,
      xy: null,
    });
  });

  it('serialises the fields in declaration order with nulls included', () => {
    expect(Object.keys(new DeviceState().toJson())).toEqual([
      'on',
      'bri',
      'hue',
      'sat',
      'effect',
      'ct',
      'alert',
      'colormode',
      'reachable',
      'xy',
    ]);
  });

  it('round-trips a full echo payload and ignores transitiontime', () => {
    const state = DeviceState.fromJson(
      JSON.stringify({
        on: true,
        bri: 254,
        hue: 15823,
        sat: 88,
        effect: 'none',
        ct: 313,
        alert: 'none',
        colormode: 'ct',
        reachable: true,
        xy: [0.4255, 0.3998],
        transitiontime: 4,
      }),
    );
    expect(state?.on).toBe(true);
    expect(state?.xy).toEqual([0.4255, 0.3998]);
    expect(JSON.stringify(state?.toJson())).not.toContain('transitiontime');
  });

  it('rejects a value it cannot coerce', () => {
    expect(() => DeviceState.fromJson('{"bri":"bright"}')).toThrow(MismatchedInputError);
  });

  it('renders toString the way the java override does', () => {
    const state = new DeviceState();
    state.on = true;
    state.bri = 12;
    expect(state.toString()).toBe('DeviceState{on=true, bri=12}');
  });
});

describe('DeviceResponse', () => {
  it('createResponse fills the LCT001 constants', () => {
    const response = DeviceResponse.createResponse('kitchen', 'abc');
    expect(response.toJson()).toEqual({
      state: {
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
      },
      type: 'Extended color light',
      name: 'kitchen',
      modelid: 'LCT001',
      manufacturername: 'Philips',
      uniqueid: 'abc',
      swversion: '65003148',
      pointsymbol: { 1: 'none', 2: 'none', 3: 'none', 4: 'none', 5: 'none', 6: 'none', 7: 'none', 8: 'none' },
    });
  });

  it('serialises a bare response with a null state', () => {
    expect(new DeviceResponse().toJson()['state']).toBeNull();
  });

  it('rebuilds the same eight-entry pointsymbol map every call', () => {
    const first = pointsymbol();
    const second = pointsymbol();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.keys(first)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });
});

describe('HueApiResponse', () => {
  it('wraps the lights map', () => {
    const response = new HueApiResponse();
    response.lights = new Map([['id', DeviceResponse.createResponse('n', 'id')]]);
    expect(Object.keys(response.toJson())).toEqual(['lights']);
    expect(JSON.parse(JSON.stringify(response.toJson()))).toHaveProperty('lights.id.name', 'n');
  });

  it('renders an absent map as an empty object', () => {
    expect(new HueApiResponse().toJson()).toEqual({ lights: {} });
  });
});

describe('DeviceDescriptor', () => {
  it('serialises in field-declaration order with nulls included', () => {
    expect(Object.keys(new DeviceDescriptor().toJson())).toEqual([
      'id',
      'name',
      'deviceType',
      'offUrl',
      'onUrl',
      'httpVerb',
      'contentType',
      'contentBody',
    ]);
  });

  it('round-trips through the store representation', () => {
    const descriptor = new DeviceDescriptor();
    descriptor.id = 'i';
    descriptor.name = 'n';
    descriptor.deviceType = 'switch';
    descriptor.offUrl = 'off';
    descriptor.onUrl = 'on';
    descriptor.httpVerb = 'PUT';
    descriptor.contentType = 'text/plain';
    descriptor.contentBody = 'body';
    expect(DeviceDescriptor.fromJson(descriptor.toJson())).toEqual(descriptor);
  });

  it('reads a row with fields missing', () => {
    expect(DeviceDescriptor.fromJson({ id: 'i' })).toEqual(
      Object.assign(new DeviceDescriptor(), { id: 'i' }),
    );
  });
});

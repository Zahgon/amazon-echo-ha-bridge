/** The setup.xml document, byte for byte. */

import { describe, expect, it } from 'vitest';

import { format, HUE_TEMPLATE, UpnpSettingsResource } from '../src/upnp/upnp-settings-resource';
import type { ServletRequest } from '../src/deps/mvc';

const request: ServletRequest = {
  method: 'GET',
  path: '/upnp/amazon-ha-bridge1/setup.xml',
  pathVariables: { deviceId: 'amazon-ha-bridge1' },
  headers: {},
  body: '',
  remoteAddr: '192.168.1.55',
  localAddr: '192.168.1.240',
  localPort: 8081,
  description: 'GET /upnp/amazon-ha-bridge1/setup.xml',
};

describe('format', () => {
  it('substitutes %s positionally and blanks a missing argument', () => {
    expect(format('%s-%s-%s', 'a', 'b')).toBe('a-b-');
  });
});

describe('UpnpSettingsResource', () => {
  it('renders the document the Echo fetches', () => {
    const entity = new UpnpSettingsResource().getUpnpConfiguration('amazon-ha-bridge1', request);
    expect(entity.status).toBe(200);
    expect(entity.body).toBe(
      format(HUE_TEMPLATE, '192.168.1.240', '8081', '192.168.1.240', 'amazon-ha-bridge1', 'amazon-ha-bridge1'),
    );
    expect(entity.body).toContain('<URLBase>http://192.168.1.240:8081/</URLBase>');
    expect(entity.body).toContain('<friendlyName>Amazon-Echo-HA-Bridge (192.168.1.240)</friendlyName>');
    expect(entity.body).toContain('<serialNumber>amazon-ha-bridge1</serialNumber>');
    expect(entity.body).toContain('<UDN>uuid:amazon-ha-bridge1</UDN>');
  });

  it('keeps the original typo and the literal (null) service fields', () => {
    expect(HUE_TEMPLATE).toContain('<manufacturerURL>http://www.armzilla..com</manufacturerURL>');
    expect(HUE_TEMPLATE).toContain('<modelNumber>929000226503</modelNumber>');
    expect((HUE_TEMPLATE.match(/\(null\)/g) ?? []).length).toBe(5);
  });

  it('maps GET /upnp/{deviceId}/setup.xml as application/xml', () => {
    const [mapping] = new UpnpSettingsResource().mappings();
    expect(mapping).toMatchObject({
      pattern: '/upnp/{deviceId}/setup.xml',
      method: 'GET',
      produces: 'application/xml',
    });
  });
});

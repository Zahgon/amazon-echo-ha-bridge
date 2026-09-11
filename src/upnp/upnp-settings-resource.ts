/** The UPnP device description the Echo fetches from the SSDP `LOCATION`. */

import { ResponseEntity, type Mapping, type ServletRequest } from '../deps/mvc';
import { getLogger } from '../logger';

const log = getLogger('com.armzilla.ha.upnp.UpnpSettingsResource');

/**
 * Interpolated with, in order: local address, local port, local address,
 * deviceId (serial number), deviceId (UDN). The `armzilla..com` typo and the
 * five literal `(null)` service fields are the original's, and are part of the
 * document the Echo parses.
 */
export const HUE_TEMPLATE =
  '<?xml version="1.0"?>\n' +
  '<root xmlns="urn:schemas-upnp-org:device-1-0">\n' +
  '<specVersion>\n' +
  '<major>1</major>\n' +
  '<minor>0</minor>\n' +
  '</specVersion>\n' +
  '<URLBase>http://%s:%s/</URLBase>\n' + // hostname string
  '<device>\n' +
  '<deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>\n' +
  '<friendlyName>Amazon-Echo-HA-Bridge (%s)</friendlyName>\n' +
  '<manufacturer>Royal Philips Electronics</manufacturer>\n' +
  '<manufacturerURL>http://www.armzilla..com</manufacturerURL>\n' +
  '<modelDescription>Hue Emulator for Amazon Echo bridge</modelDescription>\n' +
  '<modelName>Philips hue bridge 2012</modelName>\n' +
  '<modelNumber>929000226503</modelNumber>\n' +
  '<modelURL>http://www.armzilla.com/amazon-echo-ha-bridge</modelURL>\n' +
  '<serialNumber>%s</serialNumber>\n' +
  '<UDN>uuid:%s</UDN>\n' +
  '<serviceList>\n' +
  '<service>\n' +
  '<serviceType>(null)</serviceType>\n' +
  '<serviceId>(null)</serviceId>\n' +
  '<controlURL>(null)</controlURL>\n' +
  '<eventSubURL>(null)</eventSubURL>\n' +
  '<SCPDURL>(null)</SCPDURL>\n' +
  '</service>\n' +
  '</serviceList>\n' +
  '<presentationURL>index.html</presentationURL>\n' +
  '<iconList>\n' +
  '<icon>\n' +
  '<mimetype>image/png</mimetype>\n' +
  '<height>48</height>\n' +
  '<width>48</width>\n' +
  '<depth>24</depth>\n' +
  '<url>hue_logo_0.png</url>\n' +
  '</icon>\n' +
  '<icon>\n' +
  '<mimetype>image/png</mimetype>\n' +
  '<height>120</height>\n' +
  '<width>120</width>\n' +
  '<depth>24</depth>\n' +
  '<url>hue_logo_3.png</url>\n' +
  '</icon>\n' +
  '</iconList>\n' +
  '</device>\n' +
  '</root>\n';

/** `String.format`, restricted to the positional `%s` this template uses. */
export function format(template: string, ...values: readonly string[]): string {
  let index = 0;
  return template.replace(/%s/g, () => values[index++] ?? '');
}

export class UpnpSettingsResource {
  /** `GET /upnp/{deviceId}/setup.xml` */
  getUpnpConfiguration(deviceId: string, request: ServletRequest): ResponseEntity<string> {
    log.info(`upnp device settings requested: ${deviceId} from ${request.remoteAddr}`);
    const hostName = request.localAddr;
    const filledTemplate = format(
      HUE_TEMPLATE,
      hostName,
      String(request.localPort),
      hostName,
      deviceId,
      deviceId,
    );

    return new ResponseEntity(filledTemplate, null, 200);
  }

  mappings(): Mapping[] {
    return [
      {
        pattern: '/upnp/{deviceId}/setup.xml',
        method: 'GET',
        produces: 'application/xml',
        handle: (request) =>
          this.getUpnpConfiguration(request.pathVariables['deviceId'] ?? '', request),
      },
    ];
  }
}

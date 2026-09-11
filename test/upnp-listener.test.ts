/**
 * SSDP discovery — the strictest interface in the project, because the peer is
 * an appliance that reports nothing when the bytes are wrong.
 */

import { createSocket, type Socket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DISCOVERY_TEMPLATE,
  multicastInterfaceAddresses,
  NLS,
  UPNP_DISCOVERY_PORT,
  UPNP_MULTICAST_ADDRESS,
  UpnpListener,
  type UpnpListenerConfig,
} from '../src/upnp/upnp-listener';
import { freeUdpPort } from './support';

const M_SEARCH =
  'M-SEARCH * HTTP/1.1\r\n' +
  'HOST: 239.255.255.250:1900\r\n' +
  'MAN: "ssdp:discover"\r\n' +
  'MX: 3\r\n' +
  'ST: urn:schemas-upnp-org:device:basic:1\r\n\r\n';

function baseConfig(overrides: Partial<UpnpListenerConfig> = {}): UpnpListenerConfig {
  return {
    upnpResponsePort: 0,
    responseAddress: '192.168.1.240',
    portBase: 8080,
    portCount: 3,
    disable: false,
    ...overrides,
  };
}

describe('constants', () => {
  it('pins the discovery port, group and NLS the original sends', () => {
    expect(UPNP_DISCOVERY_PORT).toBe(1900);
    expect(UPNP_MULTICAST_ADDRESS).toBe('239.255.255.250');
    expect(NLS).toBe('D1710C33-328D-4152-A5FA-5382541A92FF');
  });

  it('keeps the reply template headers, order and CRLF framing', () => {
    expect(DISCOVERY_TEMPLATE).toBe(
      'HTTP/1.1 200 OK\r\n' +
        'CACHE-CONTROL: max-age=86400\r\n' +
        'EXT:\r\n' +
        'LOCATION: http://%s:%s/upnp/%s/setup.xml\r\n' +
        'OPT: "http://schemas.upnp.org/upnp/1/0/"; ns=01\r\n' +
        '01-NLS: %s\r\n' +
        'ST: urn:schemas-upnp-org:device:basic:1\r\n' +
        'USN: uuid:Socket-1_0-221438K0100073::urn:Belkin:device:**\r\n\r\n',
    );
  });
});

describe('isSSDPDiscovery', () => {
  const listener = new UpnpListener(baseConfig({ disable: true }), () => undefined);

  it('accepts a real M-SEARCH', () => {
    expect(listener.isSSDPDiscovery(M_SEARCH)).toBe(true);
  });

  it('accepts a packet padded to the 1024-byte receive buffer', () => {
    // java reads the whole 1024-byte receive buffer, so the packet string
    // carries NUL padding past the end of the datagram.
    expect(listener.isSSDPDiscovery(M_SEARCH + '\0'.repeat(900))).toBe(true);
  });

  it('rejects a NOTIFY, a truncated M-SEARCH and a null body', () => {
    expect(listener.isSSDPDiscovery('NOTIFY * HTTP/1.1\r\nMAN: "ssdp:discover"\r\n')).toBe(false);
    expect(listener.isSSDPDiscovery('M-SEARCH * HTTP/1.1\r\nHOST: x\r\n')).toBe(false);
    expect(listener.isSSDPDiscovery(null)).toBe(false);
  });
});

describe('getRandomUUIDString', () => {
  it('returns the fixed xkcd string, as the unused helper does', () => {
    expect(new UpnpListener(baseConfig({ disable: true }), () => undefined).getRandomUUIDString()).toBe(
      '88f6698f-2c83-4393-bd03-cd54a9f8595',
    );
  });
});

describe('multicastInterfaceAddresses', () => {
  it('reports at least the loopback interface', () => {
    expect(multicastInterfaceAddresses()).toContain('127.0.0.1');
  });
});

describe('startListening', () => {
  let listener: UpnpListener | null = null;
  let peer: Socket | null = null;

  afterEach(async () => {
    listener?.stop();
    listener = null;
    if (peer !== null) {
      const socket = peer;
      peer = null;
      await new Promise<void>((resolve) => socket.close(() => resolve()));
    }
  });

  it('does nothing at all when upnp.disable is set', async () => {
    let closed = false;
    listener = new UpnpListener(baseConfig({ disable: true }), () => {
      closed = true;
    });
    await listener.startListening();
    expect(closed).toBe(false);
  });

  it('answers a discovery with one reply per emulator port', async () => {
    const responsePort = await freeUdpPort();
    const discoveryPort = await freeUdpPort();
    listener = new UpnpListener(
      baseConfig({ upnpResponsePort: responsePort, discoveryPort }),
      () => expect.unreachable('the context must not close'),
    );
    await listener.startListening();

    peer = createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise<void>((resolve) => peer?.bind(0, '127.0.0.1', resolve));

    const replies: { text: string; port: number }[] = [];
    const collected = new Promise<void>((resolve) => {
      peer?.on('message', (packet, remote) => {
        replies.push({ text: packet.toString('latin1'), port: remote.port });
        if (replies.length === 3) {
          resolve();
        }
      });
    });

    peer.send(Buffer.from(M_SEARCH, 'latin1'), discoveryPort, '127.0.0.1');
    await collected;

    expect(replies.map((reply) => reply.port)).toEqual([responsePort, responsePort, responsePort]);
    expect(replies.map((reply) => reply.text)).toEqual([0, 1, 2].map((index) =>
      'HTTP/1.1 200 OK\r\n' +
      'CACHE-CONTROL: max-age=86400\r\n' +
      'EXT:\r\n' +
      `LOCATION: http://192.168.1.240:${String(8080 + index)}/upnp/amazon-ha-bridge${String(index)}/setup.xml\r\n` +
      'OPT: "http://schemas.upnp.org/upnp/1/0/"; ns=01\r\n' +
      `01-NLS: ${NLS}\r\n` +
      'ST: urn:schemas-upnp-org:device:basic:1\r\n' +
      'USN: uuid:Socket-1_0-221438K0100073::urn:Belkin:device:**\r\n\r\n',
    ));
  });

  it('ignores a datagram that is not a discovery', async () => {
    const responsePort = await freeUdpPort();
    const discoveryPort = await freeUdpPort();
    listener = new UpnpListener(baseConfig({ upnpResponsePort: responsePort, discoveryPort }), () =>
      expect.unreachable('the context must not close'),
    );
    await listener.startListening();

    peer = createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise<void>((resolve) => peer?.bind(0, '127.0.0.1', resolve));

    let replied = false;
    peer.on('message', () => {
      replied = true;
    });
    peer.send(Buffer.from('NOTIFY * HTTP/1.1\r\n\r\n', 'latin1'), discoveryPort, '127.0.0.1');

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(replied).toBe(false);
  });

  it('closes the application context when a socket cannot be bound', async () => {
    // Bound on the wildcard address without SO_REUSEADDR, so the listener's
    // own bind of the same port is refused.
    const taken = createSocket({ type: 'udp4' });
    await new Promise<void>((resolve) => taken.bind(0, resolve));
    const occupiedPort = taken.address().port;

    let closed = false;
    listener = new UpnpListener(
      baseConfig({ upnpResponsePort: occupiedPort, discoveryPort: await freeUdpPort() }),
      () => {
        closed = true;
      },
    );
    await listener.startListening();

    expect(closed).toBe(true);
    await new Promise<void>((resolve) => taken.close(() => resolve()));
  });

  it('is safe to stop twice', async () => {
    listener = new UpnpListener(
      baseConfig({ upnpResponsePort: await freeUdpPort(), discoveryPort: await freeUdpPort() }),
      () => undefined,
    );
    await listener.startListening();
    listener.stop();
    expect(() => listener?.stop()).not.toThrow();
  });
});

/**
 * SSDP discovery: the interface the Amazon Echo uses to find the bridge.
 *
 * The original blocks a scheduled thread in `DatagramSocket.receive()` for the
 * life of the process. Node has no blocking receive, so the loop becomes the
 * socket's `message` event; `startListening()` resolves once both sockets are
 * bound and the group memberships are joined, and the listener then runs until
 * `stop()`. Everything on the wire — the two sockets, which one is the source
 * of a reply, the reply bytes, and how many replies a discovery gets — is
 * unchanged.
 */

import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';

import { getLogger } from '../logger';

const log = getLogger('com.armzilla.ha.upnp.UpnpListener');

export const UPNP_DISCOVERY_PORT = 1900;
export const UPNP_MULTICAST_ADDRESS = '239.255.255.250';

/** `String.format` positions: response address, gateway port, emulator id, NLS. */
export const DISCOVERY_TEMPLATE =
  'HTTP/1.1 200 OK\r\n' +
  'CACHE-CONTROL: max-age=86400\r\n' +
  'EXT:\r\n' +
  'LOCATION: http://%s:%s/upnp/%s/setup.xml\r\n' +
  'OPT: "http://schemas.upnp.org/upnp/1/0/"; ns=01\r\n' +
  '01-NLS: %s\r\n' +
  'ST: urn:schemas-upnp-org:device:basic:1\r\n' +
  'USN: uuid:Socket-1_0-221438K0100073::urn:Belkin:device:**\r\n\r\n';

/** The fixed value the original interpolates into `01-NLS`, not a fresh UUID. */
export const NLS = 'D1710C33-328D-4152-A5FA-5382541A92FF';

/**
 * The constant `getRandomUUIDString()` hands back. The name is the original's
 * joke — https://xkcd.com/221/ — and the value is fixed, which is exactly what
 * the test pins.
 */
export const FIXED_UUID_STRING = '88f6698f-2c83-4393-bd03-cd54a9f8595';

function format(template: string, ...values: readonly string[]): string {
  let index = 0;
  return template.replace(/%s/g, () => values[index++] ?? '');
}

export interface UpnpListenerConfig {
  readonly upnpResponsePort: number;
  readonly responseAddress: string;
  readonly portBase: number;
  readonly portCount: number;
  readonly disable: boolean;
  /** Always `UPNP_DISCOVERY_PORT` in the application; a seam for tests. */
  readonly discoveryPort?: number;
}

/** Every interface that has at least one IPv4 address, as the original counts. */
export function multicastInterfaceAddresses(): string[] {
  const addresses: string[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    let ipsPerNic = 0;
    let first: string | undefined;
    for (const entry of entries ?? []) {
      log.debug(`${name} ... has addr ${entry.address}`);
      if (entry.family === 'IPv4') {
        ipsPerNic++;
        first ??= entry.address;
      }
    }
    log.debug(`Checking ${name} to our interface set`);
    if (ipsPerNic > 0 && first !== undefined) {
      addresses.push(first);
      log.debug(`Adding ${name} to our interface set`);
    }
  }
  return addresses;
}

export class UpnpListener {
  private responseSocket: Socket | null = null;
  private upnpMulticastSocket: Socket | null = null;

  constructor(
    private readonly config: UpnpListenerConfig,
    /** `((ConfigurableApplicationContext) applicationContext).close()`. */
    private readonly closeApplicationContext: () => void,
  ) {}

  /** `@Scheduled(fixedDelay = Integer.MAX_VALUE) public void startListening()`. */
  async startListening(): Promise<void> {
    if (this.config.disable) {
      return;
    }

    log.info('Starting UPNP Discovery Listener');

    const discoveryPort = this.config.discoveryPort ?? UPNP_DISCOVERY_PORT;
    const responseSocket = createSocket({ type: 'udp4', reuseAddr: true });
    const upnpMulticastSocket = createSocket({ type: 'udp4', reuseAddr: true });
    this.responseSocket = responseSocket;
    this.upnpMulticastSocket = upnpMulticastSocket;

    try {
      await bind(responseSocket, this.config.upnpResponsePort);
      await bind(upnpMulticastSocket, discoveryPort);

      for (const address of multicastInterfaceAddresses()) {
        try {
          upnpMulticastSocket.addMembership(UPNP_MULTICAST_ADDRESS, address);
        } catch (error: unknown) {
          // An interface that reports an IPv4 address but cannot carry
          // multicast (a container veth, a VPN tunnel) must not take the whole
          // listener down; the JDK silently tolerates the same case.
          log.debug(`Could not join ${UPNP_MULTICAST_ADDRESS} on ${address}`, error);
        }
      }

      upnpMulticastSocket.on('message', (packet, remote) => {
        const packetString = packet.toString('utf8');
        if (this.isSSDPDiscovery(packetString)) {
          log.debug(`Got SSDP Discovery packet from ${remote.address}:${String(remote.port)}`);
          for (let i = 0; i < this.config.portCount; i++) {
            this.sendUpnpResponse(
              responseSocket,
              remote.address,
              remote.port,
              this.config.portBase + i,
              i,
            ).catch((error: unknown) => this.shutdown(error));
          }
        }
      });
      upnpMulticastSocket.on('error', (error: Error) => this.shutdown(error));
      responseSocket.on('error', (error: Error) => this.shutdown(error));
    } catch (error: unknown) {
      this.shutdown(error);
    }
  }

  private shutdown(error: unknown): void {
    log.error('UpnpListener encountered an error. Shutting down', error);
    this.stop();
    this.closeApplicationContext();
    log.info('UPNP Discovery Listener Stopped');
  }

  /** Closes both sockets, as leaving the try-with-resources block does. */
  stop(): void {
    for (const socket of [this.upnpMulticastSocket, this.responseSocket]) {
      try {
        socket?.close();
      } catch {
        // already closed
      }
    }
    this.upnpMulticastSocket = null;
    this.responseSocket = null;
  }

  /** very naive ssdp discovery packet detection */
  isSSDPDiscovery(body: string | null): boolean {
    if (body !== null && body.startsWith('M-SEARCH * HTTP/1.1') && body.includes('MAN: "ssdp:discover"')) {
      return true;
    }
    return false;
  }

  sendUpnpResponse(
    socket: Socket,
    requester: string,
    sourcePort: number,
    gatewayPort: number,
    emulatorId: number,
  ): Promise<void> {
    const discoveryResponse = format(
      DISCOVERY_TEMPLATE,
      this.config.responseAddress,
      String(gatewayPort),
      `amazon-ha-bridge${String(emulatorId)}`,
      NLS,
    );
    const payload = Buffer.from(discoveryResponse, 'latin1');
    return new Promise<void>((resolve, reject) => {
      socket.send(payload, sourcePort, requester, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  getRandomUUIDString(): string {
    return FIXED_UUID_STRING;
  }
}

function bind(socket: Socket, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    socket.once('error', onError);
    socket.bind(port, () => {
      socket.removeListener('error', onError);
      resolve();
    });
  });
}

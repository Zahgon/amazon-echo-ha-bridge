/**
 * The embedded servlet container, `emulator.portcount` listeners wide.
 *
 * The original builds one `TomcatEmbeddedServletContainerFactory` on
 * `emulator.portbase` and adds a `Connector` for each subsequent port, so every
 * port serves the identical application. Node has no connector abstraction, so
 * this is one `http.Server` per port over one dispatcher — which is what the
 * Tomcat arrangement amounts to.
 */

import { createServer, type Server } from 'node:http';

import type { Dispatcher } from './deps/mvc';
import { handleNodeRequest } from './deps/mvc';

export class HttpListeners {
  private readonly servers: Server[] = [];

  constructor(
    private readonly portBase: number,
    private readonly portCount: number,
    private readonly dispatcher: Dispatcher,
    private readonly alwaysHeaders: Readonly<Record<string, string>>,
  ) {}

  async start(): Promise<number[]> {
    const ports: number[] = [];
    for (let i = 0; i < this.portCount; i++) {
      const server = createServer((incoming, outgoing) => {
        void handleNodeRequest(this.dispatcher, this.alwaysHeaders, incoming, outgoing);
      });
      await listen(server, this.portBase + i);
      this.servers.push(server);
      const address = server.address();
      ports.push(typeof address === 'object' && address !== null ? address.port : this.portBase + i);
    }
    return ports;
  }

  async stop(): Promise<void> {
    await Promise.all(
      this.servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
  }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(port, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}

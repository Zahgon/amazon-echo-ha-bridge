/** Shared fixtures: a scratch store, a stand-in gateway, and a raw HTTP client. */

import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSocket } from 'node:dgram';

export const TEST_PROPERTIES = join(__dirname, 'test.properties');

export function scratchStore(): { path: string; remove: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'echo-bridge-'));
  return {
    path: join(directory, 'store.json'),
    remove: () => rmSync(directory, { recursive: true, force: true }),
  };
}

export interface GatewayCall {
  method: string;
  path: string;
  contentType: string | undefined;
  body: string;
}

export interface GatewayFraming {
  contentLength: string | undefined;
  transferEncoding: string | undefined;
}

export interface StubGateway {
  readonly origin: string;
  readonly calls: GatewayCall[];
  /** How each recorded call framed its body, index-aligned with `calls`. */
  readonly framing: GatewayFraming[];
  /** `/ok/<code>` answers with that status; anything else answers 200. */
  url(path: string): string;
  close(): Promise<void>;
}

export async function startStubGateway(): Promise<StubGateway> {
  const calls: GatewayCall[] = [];
  const framing: GatewayFraming[] = [];
  const server: Server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const path = incoming.url ?? '/';
      calls.push({
        method: incoming.method ?? 'GET',
        path,
        contentType: incoming.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      });
      framing.push({
        contentLength: incoming.headers['content-length'],
        transferEncoding: incoming.headers['transfer-encoding'],
      });
      const segments = (path.split('?')[0] ?? '').replace(/^\/|\/$/g, '').split('/');
      const status = segments[0] === 'ok' && /^\d+$/.test(segments[1] ?? '')
        ? Number.parseInt(segments[1] as string, 10)
        : 200;
      const payload = status === 204 || status === 304 ? '' : 'stub';
      outgoing.writeHead(status, { 'Content-Length': String(payload.length) });
      outgoing.end(payload === '' ? undefined : payload);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    calls,
    framing,
    url: (path: string) => `http://127.0.0.1:${String(port)}${path}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  byteLength: number;
}

export function call(
  port: number,
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    const outgoing = httpRequest(
      { host: '127.0.0.1', port, method, path, headers },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', () => {
          const payload = Buffer.concat(chunks);
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: payload.toString('utf8'),
            byteLength: payload.byteLength,
          });
        });
      },
    );
    outgoing.on('error', reject);
    if (body !== undefined) {
      outgoing.write(body);
    }
    outgoing.end();
  });
}

export function json(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  return call(
    port,
    method,
    path,
    body === undefined ? undefined : JSON.stringify(body),
    { 'Content-Type': 'application/json', ...headers },
  );
}

/** Finds a free TCP port so a suite can pick its own `emulator.portbase`. */
export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Free UDP port, for the SSDP sockets. */
export async function freeUdpPort(): Promise<number> {
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

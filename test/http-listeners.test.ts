/** The multi-port embedded container. */

import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { Dispatcher, ResponseEntity } from '../src/deps/mvc';
import { HttpListeners } from '../src/http-listeners';
import { call, freePort } from './support';

const dispatcher = new Dispatcher({
  mappings: [
    { pattern: '/ping', method: 'GET', handle: () => new ResponseEntity('pong', null, 200) },
  ],
  staticRoot: null,
  alwaysHeaders: {},
});

describe('HttpListeners', () => {
  let listeners: HttpListeners | null = null;
  let occupant: Server | null = null;

  afterEach(async () => {
    await listeners?.stop();
    listeners = null;
    if (occupant !== null) {
      const server = occupant;
      occupant = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('opens portCount consecutive ports, all serving the same application', async () => {
    const base = await freePort();
    listeners = new HttpListeners(base, 3, dispatcher, { 'X-Application-Context': 'application' });

    expect(await listeners.start()).toEqual([base, base + 1, base + 2]);

    for (const port of [base, base + 1, base + 2]) {
      const response = await call(port, 'GET', '/ping');
      expect(response.body).toBe('pong');
      expect(response.headers['x-application-context']).toBe('application');
    }
  });

  it('reports a port it cannot bind', async () => {
    const base = await freePort();
    occupant = createServer();
    // Bound the same way HttpListeners binds (no explicit host), so the two
    // genuinely collide on a dual-stack machine.
    await new Promise<void>((resolve) => occupant?.listen(base, resolve));

    listeners = new HttpListeners(base, 1, dispatcher, {});
    await expect(listeners.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('is safe to stop when nothing was started', async () => {
    listeners = new HttpListeners(await freePort(), 0, dispatcher, {});
    expect(await listeners.start()).toEqual([]);
    await expect(listeners.stop()).resolves.toBeUndefined();
  });
});

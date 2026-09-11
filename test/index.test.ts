/** The entry point and the startup contract it enforces. */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Application } from '../src/application';
import { MISSING_CONFIG_ADDRESS_MESSAGE } from '../src/config-checker';
import { main, reportStartupFailure } from '../src/index';
import { resetSink, setSink } from '../src/logger';
import { call, freePort, freeUdpPort, scratchStore } from './support';

describe('main', () => {
  let application: Application | null = null;
  let cleanup: (() => void) | null = null;

  afterEach(async () => {
    await application?.close();
    application = null;
    cleanup?.();
    cleanup = null;
    resetSink();
  });

  it('starts the bridge from command-line arguments alone', async () => {
    const store = scratchStore();
    cleanup = store.remove;
    const portBase = await freePort();

    application = await main(
      [
        '--upnp.config.address=192.168.1.240',
        `--emulator.portbase=${String(portBase)}`,
        '--emulator.portcount=1',
        `--upnp.response.port=${String(await freeUdpPort())}`,
        '--upnp.disable=true',
      ],
      { storePath: store.path, discoveryPort: await freeUdpPort() },
    );

    expect(application.ports).toEqual([portBase]);
    expect((await call(portBase, 'GET', '/api/devices')).status).toBe(200);
  });

  it('closes the context on SIGTERM', async () => {
    const store = scratchStore();
    cleanup = store.remove;
    const portBase = await freePort();

    const started = await main(
      [
        '--upnp.config.address=192.168.1.240',
        `--emulator.portbase=${String(portBase)}`,
        '--emulator.portcount=1',
        `--upnp.response.port=${String(await freeUdpPort())}`,
        '--upnp.disable=true',
      ],
      { storePath: store.path, discoveryPort: await freeUdpPort() },
    );
    expect((await call(portBase, 'GET', '/api/devices')).status).toBe(200);

    process.emit('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 200));

    await expect(call(portBase, 'GET', '/api/devices')).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
    // already closed; the afterEach close must stay harmless
    application = started;
  });

  it('refuses to start when upnp.config.address is unset', async () => {
    await expect(main(['--emulator.portcount=1'], {})).rejects.toThrow(MISSING_CONFIG_ADDRESS_MESSAGE);
  });

  it('reports a startup failure on stderr and through the logger', () => {
    const lines: string[] = [];
    setSink((line) => lines.push(line));
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      reportStartupFailure(new Error('boom'));
      expect(write).toHaveBeenCalledWith('Error: boom\n');
      expect(lines[0]).toContain('Application startup failed');
    } finally {
      write.mockRestore();
    }
  });

  it('reports a non-Error rejection too', () => {
    setSink(() => undefined);
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      reportStartupFailure('plain failure');
      expect(write).toHaveBeenCalledWith('plain failure\n');
    } finally {
      write.mockRestore();
    }
  });
});

describe('the process contract', () => {
  const entry = join(__dirname, '..', 'dist', 'index.js');

  // The exit code is only observable from a real process, so this block drives
  // the compiled entry point and compiles it first if it is not there yet.
  beforeAll(() => {
    if (!existsSync(entry)) {
      execFileSync('npm', ['run', 'build'], {
        cwd: join(__dirname, '..'),
        stdio: 'ignore',
        timeout: 120_000,
      });
    }
  }, 130_000);

  function run(args: string[]): { status: number; output: string } {
    try {
      const output = execFileSync(process.execPath, [entry, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20_000,
      });
      return { status: 0, output };
    } catch (error: unknown) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return {
        status: failure.status ?? -1,
        output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
      };
    }
  }

  it.each([[[]], [['--help']], [['--version']]])(
    'exits 1 without a bridge address for %j',
    (args: string[]) => {
      const result = run(args);
      expect(result.status).toBe(1);
      expect(result.output).toContain(MISSING_CONFIG_ADDRESS_MESSAGE);
    },
  );
});

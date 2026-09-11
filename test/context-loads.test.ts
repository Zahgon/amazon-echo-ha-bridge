/**
 * The original suite, `demo/DemoApplicationTests.java`.
 *
 * `@SpringApplicationConfiguration(classes = SpringbootEntry.class)` under
 * `classpath:test.properties` asserts that every component of the application
 * initialises. Here that is `Application.run` over the same property file: the
 * repository opens, all `emulator.portcount` listeners bind, the SSDP listener
 * starts (`upnp.disable=false` in test.properties), and nothing throws.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Application } from '../src/application';
import { Environment } from '../src/environment';
import { freePort, freeUdpPort, scratchStore, TEST_PROPERTIES } from './support';

describe('DemoApplicationTests', () => {
  let started: Application | null = null;
  let cleanup: (() => void) | null = null;

  afterEach(async () => {
    await started?.close();
    started = null;
    cleanup?.();
    cleanup = null;
  });

  it('contextLoads', async () => {
    const store = scratchStore();
    cleanup = store.remove;
    const portBase = await freePort();
    const responsePort = await freeUdpPort();
    const discoveryPort = await freeUdpPort();

    const environment = Environment.load(
      [`--emulator.portbase=${String(portBase)}`, `--upnp.response.port=${String(responsePort)}`],
      {},
      TEST_PROPERTIES,
    );

    started = await Application.run(environment, { storePath: store.path, discoveryPort });

    expect(started.ports).toEqual([portBase, portBase + 1, portBase + 2]);
    expect(started.repository.findAll()).toEqual([]);
  });
});

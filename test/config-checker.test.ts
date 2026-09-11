/** The startup contract: no bridge address, no process. */

import { describe, expect, it } from 'vitest';

import { ConfigChecker, ConfigurationError, MISSING_CONFIG_ADDRESS_MESSAGE } from '../src/config-checker';
import { APPLICATION_PROPERTIES, Environment } from '../src/environment';
import { TEST_PROPERTIES } from './support';

describe('ConfigChecker', () => {
  it('quotes the original message, spelling and all', () => {
    expect(MISSING_CONFIG_ADDRESS_MESSAGE).toBe(
      'please provide the IP(v4) address of the interface you want the bridge to listen on ' +
        'using --upnp.config.address=<ipadress>',
    );
  });

  it('fails on the shipped defaults, where the address is empty', () => {
    const checker = new ConfigChecker(Environment.load([], {}, APPLICATION_PROPERTIES));
    expect(() => checker.afterPropertiesSet()).toThrow(ConfigurationError);
    expect(() => checker.afterPropertiesSet()).toThrow(MISSING_CONFIG_ADDRESS_MESSAGE);
  });

  it('passes once the address is supplied on the command line', () => {
    const environment = Environment.load(['--upnp.config.address=192.168.1.240'], {}, APPLICATION_PROPERTIES);
    expect(() => new ConfigChecker(environment).afterPropertiesSet()).not.toThrow();
  });

  it('passes on the test properties, which set it to 192.168.1.1', () => {
    const environment = Environment.load([], {}, TEST_PROPERTIES);
    expect(() => new ConfigChecker(environment).afterPropertiesSet()).not.toThrow();
  });

  it('reports an IllegalArgumentException, as the java bean does', () => {
    const checker = new ConfigChecker(Environment.load([], {}, APPLICATION_PROPERTIES));
    try {
      checker.afterPropertiesSet();
      expect.unreachable('afterPropertiesSet should have thrown');
    } catch (error: unknown) {
      expect((error as Error).name).toBe('IllegalArgumentException');
    }
  });
});

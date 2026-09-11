/** Startup validation, run while the application context initialises. */

import type { Environment } from './environment';

export const MISSING_CONFIG_ADDRESS_MESSAGE =
  'please provide the IP(v4) address of the interface you want the bridge to listen on ' +
  'using --upnp.config.address=<ipadress>';

/** `java.lang.IllegalArgumentException` thrown from `afterPropertiesSet`. */
export class ConfigurationError extends Error {
  override readonly name = 'IllegalArgumentException';
}

export class ConfigChecker {
  private readonly responseAddress: string;

  constructor(environment: Environment) {
    this.responseAddress = environment.getProperty('upnp.config.address') ?? '';
  }

  afterPropertiesSet(): void {
    if (this.responseAddress === '') {
      throw new ConfigurationError(MISSING_CONFIG_ADDRESS_MESSAGE);
    }
  }
}

#!/usr/bin/env node
/** Application entry point — `SpringbootEntry.main(String[] args)`. */

import { Application, type ApplicationOptions } from './application';
import { Environment } from './environment';
import { getLogger } from './logger';

const log = getLogger('com.armzilla.ha.SpringbootEntry');

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  options: ApplicationOptions = {},
): Promise<Application> {
  const application = await Application.run(Environment.load(argv), options);
  const shutdown = (): void => {
    void application.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return application;
}

/**
 * A failed context refresh is fatal: the original prints the cause and the JVM
 * exits 1. `--help` and `--version` are not options — they take this same path,
 * and exit 1 on the unset `upnp.config.address`.
 */
export function reportStartupFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  log.error('Application startup failed', error);
  process.stderr.write(`${error instanceof Error ? `${error.name}: ` : ''}${message}\n`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    reportStartupFailure(error);
    process.exit(1);
  });
}

/**
 * Property resolution, standing in for Spring's `Environment` plus the
 * `@Value("${…}")` placeholder resolver.
 *
 * Sources, highest precedence first — the order Spring Boot establishes:
 *   1. command-line arguments of the form `--key=value`
 *   2. environment variables, under relaxed binding (`UPNP_CONFIG_ADDRESS`
 *      satisfies `upnp.config.address`)
 *   3. `resources/application.properties`
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const APPLICATION_PROPERTIES = join(__dirname, '..', 'resources', 'application.properties');

/**
 * `java.util.Properties.load` semantics for the subset this project uses:
 * `#`/`!` comments, blank lines, `key=value` with surrounding whitespace
 * trimmed and a missing value meaning the empty string.
 */
export function parseProperties(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }
    const separator = line.search(/[=:]/);
    if (separator < 0) {
      out.set(line, '');
      continue;
    }
    out.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return out;
}

/**
 * Spring's `SimpleCommandLinePropertySource`: only `--key=value` and `--key`
 * are options; everything else is a non-option argument and is ignored.
 */
export function parseCommandLine(args: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const arg of args) {
    if (!arg.startsWith('--')) {
      continue;
    }
    const body = arg.slice(2);
    if (body === '') {
      continue;
    }
    const eq = body.indexOf('=');
    if (eq < 0) {
      out.set(body, '');
    } else {
      out.set(body.slice(0, eq), body.slice(eq + 1));
    }
  }
  return out;
}

/**
 * The names Spring Boot's relaxed binding will look for in the environment
 * when asked for a dotted property.
 */
export function relaxedEnvironmentNames(key: string): string[] {
  const underscored = key.replace(/[.-]/g, '_');
  return [key, underscored, underscored.toUpperCase(), key.toUpperCase()];
}

export class Environment {
  constructor(
    private readonly commandLine: Map<string, string>,
    private readonly variables: Record<string, string | undefined>,
    private readonly properties: Map<string, string>,
  ) {}

  static load(
    args: readonly string[] = process.argv.slice(2),
    variables: Record<string, string | undefined> = process.env,
    propertiesPath: string = APPLICATION_PROPERTIES,
  ): Environment {
    return new Environment(
      parseCommandLine(args),
      variables,
      parseProperties(readFileSync(propertiesPath, 'utf8')),
    );
  }

  /** Returns `undefined` only when no source declares the property at all. */
  getProperty(key: string): string | undefined {
    const fromCommandLine = this.commandLine.get(key);
    if (fromCommandLine !== undefined) {
      return fromCommandLine;
    }
    for (const name of relaxedEnvironmentNames(key)) {
      const fromEnvironment = this.variables[name];
      if (fromEnvironment !== undefined) {
        return fromEnvironment;
      }
    }
    return this.properties.get(key);
  }

  /**
   * `@Value("${key}")` on a `String` field: an undeclared placeholder is a
   * startup failure in Spring, so this throws rather than defaulting.
   */
  getRequiredString(key: string): string {
    const value = this.getProperty(key);
    if (value === undefined) {
      throw new Error(`Could not resolve placeholder '${key}'`);
    }
    return value;
  }

  /** `@Value("${key}")` on an `int` field. */
  getRequiredInt(key: string): number {
    const value = this.getRequiredString(key);
    if (!/^[+-]?\d+$/.test(value.trim())) {
      throw new Error(`Failed to convert value of type 'java.lang.String' to required type 'int'; value '${value}'`);
    }
    return Number.parseInt(value.trim(), 10);
  }

  /** `@Value("${key}")` on a `boolean` field: only `true` is true. */
  getRequiredBoolean(key: string): boolean {
    return this.getRequiredString(key).trim().toLowerCase() === 'true';
  }
}

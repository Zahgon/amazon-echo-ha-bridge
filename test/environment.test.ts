/** Property resolution: `application.properties`, the environment, `--key=value`. */

import { describe, expect, it } from 'vitest';

import {
  APPLICATION_PROPERTIES,
  Environment,
  parseCommandLine,
  parseProperties,
  relaxedEnvironmentNames,
} from '../src/environment';

describe('parseProperties', () => {
  it('reads key=value, skipping comments and blank lines', () => {
    const parsed = parseProperties('# comment\n! bang\n\nupnp.disable=false\n  spaced = value  \n');
    expect(parsed.get('upnp.disable')).toBe('false');
    expect(parsed.get('spaced')).toBe('value');
    expect(parsed.has('# comment')).toBe(false);
  });

  it('treats a key with no separator as the empty string', () => {
    expect(parseProperties('lonely\n').get('lonely')).toBe('');
  });

  it('accepts the colon separator java.util.Properties allows', () => {
    expect(parseProperties('a:b\n').get('a')).toBe('b');
  });

  it('reads the shipped application.properties defaults', () => {
    const environment = Environment.load([], {}, APPLICATION_PROPERTIES);
    expect(environment.getProperty('upnp.response.port')).toBe('50000');
    expect(environment.getProperty('upnp.config.address')).toBe('');
    expect(environment.getProperty('emulator.portbase')).toBe('8080');
    expect(environment.getProperty('emulator.portcount')).toBe('3');
    expect(environment.getProperty('upnp.disable')).toBe('false');
  });
});

describe('parseCommandLine', () => {
  it('takes only --key=value options', () => {
    const parsed = parseCommandLine(['--upnp.config.address=10.0.0.1', 'ignored', '-x', '--flag']);
    expect(parsed.get('upnp.config.address')).toBe('10.0.0.1');
    expect(parsed.get('flag')).toBe('');
    expect(parsed.has('ignored')).toBe(false);
    expect(parsed.has('x')).toBe(false);
  });

  it('keeps everything after the first equals sign', () => {
    expect(parseCommandLine(['--a=b=c']).get('a')).toBe('b=c');
  });

  it('ignores a bare --', () => {
    expect(parseCommandLine(['--']).size).toBe(0);
  });
});

describe('relaxedEnvironmentNames', () => {
  it('offers the dotted, underscored and upper-cased spellings', () => {
    expect(relaxedEnvironmentNames('upnp.config.address')).toEqual([
      'upnp.config.address',
      'upnp_config_address',
      'UPNP_CONFIG_ADDRESS',
      'UPNP.CONFIG.ADDRESS',
    ]);
  });
});

describe('Environment precedence', () => {
  const properties = APPLICATION_PROPERTIES;

  it('prefers the command line to the environment and the file', () => {
    const environment = Environment.load(
      ['--upnp.config.address=1.1.1.1'],
      { UPNP_CONFIG_ADDRESS: '2.2.2.2' },
      properties,
    );
    expect(environment.getRequiredString('upnp.config.address')).toBe('1.1.1.1');
  });

  it('prefers the environment to the file, under relaxed binding', () => {
    const environment = Environment.load([], { UPNP_CONFIG_ADDRESS: '2.2.2.2' }, properties);
    expect(environment.getRequiredString('upnp.config.address')).toBe('2.2.2.2');
  });

  it('falls back to the file', () => {
    expect(Environment.load([], {}, properties).getRequiredInt('emulator.portbase')).toBe(8080);
  });

  it('converts int and boolean placeholders the way @Value does', () => {
    const environment = Environment.load(
      ['--emulator.portcount=7', '--upnp.disable=TRUE'],
      {},
      properties,
    );
    expect(environment.getRequiredInt('emulator.portcount')).toBe(7);
    expect(environment.getRequiredBoolean('upnp.disable')).toBe(true);
    expect(Environment.load([], {}, properties).getRequiredBoolean('upnp.disable')).toBe(false);
  });

  it('fails on an unresolvable placeholder', () => {
    expect(() => Environment.load([], {}, properties).getRequiredString('nope.nope')).toThrow(
      "Could not resolve placeholder 'nope.nope'",
    );
  });

  it('fails on an int placeholder that is not an int', () => {
    expect(() =>
      Environment.load(['--emulator.portbase=abc'], {}, properties).getRequiredInt('emulator.portbase'),
    ).toThrow(/required type 'int'/);
  });
});

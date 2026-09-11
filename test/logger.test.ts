/** The Logback console layout Spring Boot configures. */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  abbreviateLoggerName,
  formatLine,
  formatTimestamp,
  getLogger,
  resetSink,
  setRootLevel,
  setSink,
} from '../src/logger';

afterEach(() => {
  resetSink();
  setRootLevel('INFO');
});

describe('formatTimestamp', () => {
  it('renders yyyy-MM-dd HH:mm:ss.SSS with zero padding', () => {
    expect(formatTimestamp(new Date(2026, 8, 3, 5, 6, 7, 89))).toBe('2026-09-03 05:06:07.089');
  });
});

describe('abbreviateLoggerName', () => {
  it('leaves a name that already fits', () => {
    expect(abbreviateLoggerName('com.armzilla.ha.upnp.UpnpListener', 39)).toBe(
      'com.armzilla.ha.upnp.UpnpListener',
    );
  });

  it('shortens leading packages until the name fits', () => {
    expect(
      abbreviateLoggerName(
        'org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping',
        39,
      ),
    ).toBe('o.s.w.s.m.m.a.RequestMappingHandlerMapping');
  });

  it('leaves single-character segments alone', () => {
    expect(abbreviateLoggerName('a.b.c.SomeVeryLongClassNameThatOverflowsTheTarget', 10)).toBe(
      'a.b.c.SomeVeryLongClassNameThatOverflowsTheTarget',
    );
  });
});

describe('formatLine', () => {
  it('lays the columns out exactly as CONSOLE_LOG_PATTERN does', () => {
    const line = formatLine(
      new Date(2026, 8, 3, 5, 26, 12, 227),
      'INFO',
      1,
      'main',
      'com.armzilla.ha.upnp.UpnpListener',
      'Starting UPNP Discovery Listener',
    );
    expect(line).toBe(
      '2026-09-03 05:26:12.227  INFO 1 --- [           main] ' +
        'com.armzilla.ha.upnp.UpnpListener        : Starting UPNP Discovery Listener',
    );
  });

  it('keeps the tail of an over-long logger name, as %-40.40 does', () => {
    const line = formatLine(
      new Date(2026, 8, 3, 0, 0, 0, 0),
      'ERROR',
      9,
      'a-very-long-thread-name',
      'org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean',
      'x',
    );
    // %15.15t truncates from the left, keeping the tail — which is how
    // "http-nio-8080-exec-8" prints as "[nio-8080-exec-8]".
    expect(line).toContain('[ong-thread-name]');
    expect(line).toContain('j.LocalContainerEntityManagerFactoryBean :');
  });
});

describe('Logger', () => {
  it('writes info, warn and error but suppresses debug at the default level', () => {
    const lines: string[] = [];
    setSink((line) => lines.push(line));
    const log = getLogger('com.armzilla.ha.Test');
    log.debug('invisible');
    log.info('visible');
    log.warn('warned');
    log.error('failed');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(' INFO ');
    expect(lines[1]).toContain(' WARN ');
    expect(lines[2]).toContain('ERROR ');
  });

  it('emits debug once the root level is lowered', () => {
    const lines: string[] = [];
    setSink((line) => lines.push(line));
    setRootLevel('DEBUG');
    getLogger('x').debug('now visible');
    expect(lines).toHaveLength(1);
  });

  it('renders an attached throwable on its own line', () => {
    const lines: string[] = [];
    setSink((line) => lines.push(line));
    getLogger('x').error('boom', new Error('inner'));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('inner');
  });

  it('writes to stdout through the default sink', () => {
    resetSink();
    const written: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    try {
      getLogger('com.armzilla.ha.Test').info('to stdout');
    } finally {
      write.mockRestore();
    }
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/ INFO .* com\.armzilla\.ha\.Test\s+: to stdout\n$/);
  });

  it('renders a non-Error throwable too', () => {
    const lines: string[] = [];
    setSink((line) => lines.push(line));
    getLogger('x').info('boom', 'plain string');
    expect(lines[1]).toBe('plain string');
  });
});

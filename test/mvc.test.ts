/** Routing, negotiation and the error document, in isolation. */

import { describe, expect, it } from 'vitest';

import {
  accepts,
  Dispatcher,
  effectiveRequestContentType,
  errorDocument,
  normalizeAddress,
  reasonPhrase,
  ResponseEntity,
  type Mapping,
  type ServletRequest,
} from '../src/deps/mvc';

function servletRequest(method: string, path: string, overrides: Partial<ServletRequest> = {}): ServletRequest {
  return {
    method,
    path,
    pathVariables: {},
    headers: {},
    body: '',
    remoteAddr: '127.0.0.1',
    localAddr: '127.0.0.1',
    localPort: 8080,
    description: `${method} ${path}`,
    ...overrides,
  };
}

const mappings: Mapping[] = [
  {
    pattern: '/api/devices',
    method: 'GET',
    produces: 'application/json',
    handle: () => new ResponseEntity({ which: 'devices' }, null, 200),
  },
  {
    pattern: '/api/{userId}',
    method: 'GET',
    produces: 'application/json',
    handle: (request) => new ResponseEntity({ which: 'hue', userId: request.pathVariables['userId'] }, null, 200),
  },
  {
    pattern: '/api/*',
    method: 'POST',
    produces: 'application/json',
    handle: () => new ResponseEntity('wildcard', null, 200),
  },
  {
    pattern: '/boom',
    method: 'GET',
    handle: () => {
      throw new Error('exploded');
    },
  },
  {
    pattern: '/anonymous',
    method: 'GET',
    handle: () => {
      throw new Error('');
    },
  },
];

const dispatcher = new Dispatcher({ mappings, staticRoot: null, alwaysHeaders: {} });

describe('reasonPhrase', () => {
  it('names the statuses the application uses', () => {
    expect(reasonPhrase(204)).toBe('No Content');
    expect(reasonPhrase(503)).toBe('Service Unavailable');
    expect(reasonPhrase(599)).toBe('Unknown');
  });
});

describe('normalizeAddress', () => {
  it('unwraps an ipv4-mapped ipv6 address', () => {
    expect(normalizeAddress('::ffff:172.17.0.2')).toBe('172.17.0.2');
    expect(normalizeAddress('10.0.0.1')).toBe('10.0.0.1');
    expect(normalizeAddress(undefined)).toBe('');
  });
});

describe('effectiveRequestContentType', () => {
  it('appends the forced utf-8 charset', () => {
    expect(effectiveRequestContentType('text/plain')).toBe('text/plain;charset=UTF-8');
  });

  it('leaves an explicit charset alone', () => {
    expect(effectiveRequestContentType('text/plain;charset=iso-8859-1')).toBe('text/plain;charset=iso-8859-1');
  });

  it('reads a missing header as application/octet-stream', () => {
    expect(effectiveRequestContentType(undefined)).toBe('application/octet-stream');
    expect(effectiveRequestContentType('  ')).toBe('application/octet-stream');
  });
});

describe('accepts', () => {
  it('matches an absent, wildcard or exact Accept', () => {
    expect(accepts(undefined, 'application/json')).toBe(true);
    expect(accepts('*/*', 'application/json')).toBe(true);
    expect(accepts('application/*', 'application/json')).toBe(true);
    expect(accepts('application/json;q=0.9', 'application/json')).toBe(true);
    expect(accepts('text/html, application/json', 'application/json')).toBe(true);
  });

  it('rejects a type the handler cannot produce', () => {
    expect(accepts('text/plain', 'application/json')).toBe(false);
    expect(accepts('application/xml', 'application/json')).toBe(false);
  });
});

describe('errorDocument', () => {
  it('omits the exception key when there is no exception', () => {
    expect(errorDocument(404, '/x', null, 'No message available', 1)).toBe(
      '{"timestamp":1,"status":404,"error":"Not Found","message":"No message available","path":"/x"}',
    );
  });

  it('includes it when there is', () => {
    expect(errorDocument(500, '/x', 'IllegalArgumentException', 'bad', 1)).toBe(
      '{"timestamp":1,"status":500,"error":"Internal Server Error",' +
        '"exception":"IllegalArgumentException","message":"bad","path":"/x"}',
    );
  });
});

describe('Dispatcher', () => {
  it('prefers a literal pattern over one with a variable', async () => {
    const response = await dispatcher.dispatch(servletRequest('GET', '/api/devices'));
    expect(JSON.parse(response.body?.toString('utf8') ?? '')).toEqual({ which: 'devices' });
  });

  it('falls through to the variable pattern for any other segment', async () => {
    const response = await dispatcher.dispatch(servletRequest('GET', '/api/someuser'));
    expect(JSON.parse(response.body?.toString('utf8') ?? '')).toEqual({
      which: 'hue',
      userId: 'someuser',
    });
  });

  it('answers OPTIONS from the container without dispatching', async () => {
    const response = await dispatcher.dispatch(servletRequest('OPTIONS', '/whatever'));
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });

  it('collects the Allow header from every pattern that matches the path', async () => {
    const response = await dispatcher.dispatch(servletRequest('PATCH', '/api/devices'));
    expect(response.status).toBe(405);
    expect(response.headers['Allow']).toBe('GET, POST');
  });

  it('404s a path no pattern matches when there is no static root', async () => {
    const response = await dispatcher.dispatch(servletRequest('GET', '/missing'));
    expect(response.status).toBe(404);
  });

  it('renders an exception as a 500 carrying its class name and message', async () => {
    const response = await dispatcher.dispatch(servletRequest('GET', '/boom'));
    expect(response.status).toBe(500);
    const body = JSON.parse(response.body?.toString('utf8') ?? '') as Record<string, unknown>;
    expect(body['exception']).toBe('Error');
    expect(body['message']).toBe('exploded');
  });

  it('substitutes "No message available" for an exception with no message', async () => {
    const response = await dispatcher.dispatch(servletRequest('GET', '/anonymous'));
    expect(JSON.parse(response.body?.toString('utf8') ?? '')).toHaveProperty(
      'message',
      'No message available',
    );
  });

  it('406s when Accept excludes the produced type', async () => {
    const response = await dispatcher.dispatch(
      servletRequest('GET', '/api/devices', { headers: { accept: 'text/plain' } }),
    );
    expect(response.status).toBe(406);
    expect(response.body).toBeNull();
  });

  it('writes a string body verbatim under the produced content type', async () => {
    const response = await dispatcher.dispatch(servletRequest('POST', '/api/anything'));
    expect(response.headers['Content-Type']).toBe('application/json;charset=UTF-8');
    expect(response.body?.toString('utf8')).toBe('wildcard');
    expect(response.lengthDelimited).toBe(true);
  });

  it('leaves a json body chunked', async () => {
    const response = await dispatcher.dispatch(servletRequest('GET', '/api/devices'));
    expect(response.lengthDelimited).toBe(false);
  });
});

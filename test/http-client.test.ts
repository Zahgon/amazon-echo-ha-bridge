/** The Apache HttpClient behaviours the 500s and 503s come from. */

import { describe, expect, it } from 'vitest';

import {
  createDefaultHttpClient,
  httpGet,
  httpPost,
  httpPut,
  HttpIOError,
  IllegalArgumentError,
  parseContentType,
  validateUri,
} from '../src/deps/http-client';
import { startStubGateway } from './support';

describe('validateUri', () => {
  it('accepts an ordinary absolute url', () => {
    expect(validateUri('http://host:8080/a/b?c=d')?.hostname).toBe('host');
  });

  it('reports the index of an illegal character in the query', () => {
    const url = 'http://host.docker.internal:19099/ok/200?b=200&p=${intensity.percent}';
    expect(() => validateUri(url)).toThrow(new IllegalArgumentError(`Illegal character in query at index 50: ${url}`));
  });

  it('reports an illegal character in the path', () => {
    expect(() => validateUri('http://host/a{b}')).toThrow(/Illegal character in path at index 13/);
  });

  it('reports an illegal character in the fragment', () => {
    expect(() => validateUri('http://host/a#f{g')).toThrow(/Illegal character in fragment at index 15/);
  });

  it('accepts a percent escape and rejects a malformed one', () => {
    expect(validateUri('http://host/a%20b')).not.toBeNull();
    expect(() => validateUri('http://host/a%zz')).toThrow(/Illegal character in path/);
  });

  it('returns null for a uri that parses but names no host', () => {
    expect(validateUri('')).toBeNull();
  });
});

describe('parseContentType', () => {
  it('passes a content type through', () => {
    expect(parseContentType('application/json')).toBe('application/json');
  });

  it('rejects null the way ContentType.parse does', () => {
    expect(() => parseContentType(null)).toThrow(new IllegalArgumentError('Content type may not be null'));
  });
});

describe('createDefaultHttpClient', () => {
  it('rejects a null request', () => {
    expect(() => createDefaultHttpClient().execute(null)).toThrow(
      new IllegalArgumentError('HTTP request may not be null'),
    );
  });

  it('turns a host-less uri into an IOException', async () => {
    await expect(createDefaultHttpClient().execute(httpGet(''))).rejects.toBeInstanceOf(HttpIOError);
  });

  it('turns a refused connection into an IOException', async () => {
    await expect(
      createDefaultHttpClient().execute(httpGet('http://127.0.0.1:9/nope')),
    ).rejects.toBeInstanceOf(HttpIOError);
  });

  it('returns the status code and drains the entity', async () => {
    const gateway = await startStubGateway();
    try {
      const client = createDefaultHttpClient();
      expect(await client.execute(httpGet(gateway.url('/ok/204')))).toBe(204);
      expect(await client.execute(httpGet(gateway.url('/ok/503')))).toBe(503);
    } finally {
      await gateway.close();
    }
  });

  it('sends a body and content type for POST and PUT', async () => {
    const gateway = await startStubGateway();
    try {
      const client = createDefaultHttpClient();
      await client.execute(httpPost(gateway.url('/p'), '{"a":1}', 'application/json'));
      await client.execute(httpPut(gateway.url('/q'), 'plain', 'text/plain'));
      expect(gateway.calls).toEqual([
        { method: 'POST', path: '/p', contentType: 'application/json', body: '{"a":1}' },
        { method: 'PUT', path: '/q', contentType: 'text/plain', body: 'plain' },
      ]);
      // Apache's StringEntity is a fixed-length entity: a gateway that only
      // reads Content-Length must still see the body.
      expect(gateway.framing).toEqual([
        { contentLength: '7', transferEncoding: undefined },
        { contentLength: '5', transferEncoding: undefined },
      ]);
    } finally {
      await gateway.close();
    }
  });

  it('rejects a POST or PUT with no content type before it reaches the wire', () => {
    expect(() => httpPost('http://host/a', 'b', null)).toThrow(IllegalArgumentError);
    expect(() => httpPut('http://host/a', 'b', null)).toThrow(IllegalArgumentError);
  });
});

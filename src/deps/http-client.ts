/**
 * The slice of Apache `httpclient` 4.5.1 this application observes.
 *
 * `HueMulator` calls out to a home-automation gateway through
 * `HttpClients.createDefault()`. Three of that client's behaviours reach the
 * Echo as HTTP status codes and therefore have to be reproduced rather than
 * approximated:
 *
 *  - `new HttpGet(url)` runs the URL through `java.net.URI`, which rejects the
 *    `{` left behind when `${intensity.percent}` was not substituted, with
 *    `Illegal character in query at index <n>: <url>`;
 *  - `execute(null)` — reachable when the stored verb is none of GET/POST/PUT —
 *    fails its argument check with `HTTP request may not be null`;
 *  - `ContentType.parse(null)` fails with `Content type may not be null`.
 *
 * The client has no connect or socket timeout, always drains the response
 * entity, and never lets the response body influence the caller.
 */

import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** `java.lang.IllegalArgumentException`. */
export class IllegalArgumentError extends Error {
  override readonly name = 'IllegalArgumentException';
}

/** `java.io.IOException` — what the original catches and turns into a `503`. */
export class HttpIOError extends Error {
  override readonly name = 'IOException';
}

/**
 * `java.net.URI`'s character classes (RFC 2396 as the JDK implements it).
 * `%` is accepted here and its escape sequence checked separately.
 */
const UNRESERVED = /[A-Za-z0-9\-_.!~*'()]/;
const RESERVED = /[;/?:@&=+$,[\]]/;

function isHex(character: string | undefined): boolean {
  return character !== undefined && /[0-9A-Fa-f]/.test(character);
}

/**
 * Scans a URI component for the first character `java.net.URI` would reject and
 * returns its index within the whole URI string, or -1.
 */
function firstIllegalCharacter(uri: string, from: number, to: number): number {
  for (let index = from; index < to; index++) {
    const character = uri.charAt(index);
    if (character === '%') {
      if (!isHex(uri.charAt(index + 1)) || !isHex(uri.charAt(index + 2))) {
        return index;
      }
      index += 2;
      continue;
    }
    if (!UNRESERVED.test(character) && !RESERVED.test(character)) {
      return index;
    }
  }
  return -1;
}

/**
 * `URI.create(url)`. Reports the offending component and index exactly as the
 * JDK does, because that message is rendered into the `500` body.
 *
 * Returns `null` for a URI that parses but names no host — `URI.create("")`
 * succeeds in Java and only fails later, inside `execute`, as an `IOException`.
 */
export function validateUri(url: string): URL | null {
  const hashIndex = url.indexOf('#');
  const fragmentStart = hashIndex < 0 ? url.length : hashIndex;
  const questionIndex = url.indexOf('?');
  const queryStart = questionIndex >= 0 && questionIndex < fragmentStart ? questionIndex : -1;

  const pathEnd = queryStart >= 0 ? queryStart : fragmentStart;
  const schemeEnd = url.indexOf('://');
  const pathStart = schemeEnd < 0 ? 0 : url.indexOf('/', schemeEnd + 3);

  if (pathStart >= 0 && pathStart < pathEnd) {
    const bad = firstIllegalCharacter(url, pathStart, pathEnd);
    if (bad >= 0) {
      throw new IllegalArgumentError(`Illegal character in path at index ${bad}: ${url}`);
    }
  }
  if (queryStart >= 0) {
    const bad = firstIllegalCharacter(url, queryStart + 1, fragmentStart);
    if (bad >= 0) {
      throw new IllegalArgumentError(`Illegal character in query at index ${bad}: ${url}`);
    }
  }
  if (hashIndex >= 0) {
    const bad = firstIllegalCharacter(url, hashIndex + 1, url.length);
    if (bad >= 0) {
      throw new IllegalArgumentError(`Illegal character in fragment at index ${bad}: ${url}`);
    }
  }
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** `org.apache.http.entity.ContentType.parse`. */
export function parseContentType(contentType: string | null): string {
  if (contentType === null) {
    throw new IllegalArgumentError('Content type may not be null');
  }
  return contentType;
}

export interface HttpUriRequest {
  readonly method: string;
  /** `null` when the URI names no host; `execute` turns that into an IOException. */
  readonly url: URL | null;
  readonly rawUrl: string;
  readonly body: string | null;
  readonly contentType: string | null;
}

export function httpGet(url: string): HttpUriRequest {
  return { method: 'GET', url: validateUri(url), rawUrl: url, body: null, contentType: null };
}

export function httpPost(url: string, body: string, contentType: string | null): HttpUriRequest {
  const parsed = parseContentType(contentType);
  return { method: 'POST', url: validateUri(url), rawUrl: url, body, contentType: parsed };
}

export function httpPut(url: string, body: string, contentType: string | null): HttpUriRequest {
  const parsed = parseContentType(contentType);
  return { method: 'PUT', url: validateUri(url), rawUrl: url, body, contentType: parsed };
}

/** `org.apache.http.impl.client.CloseableHttpClient`. */
export interface HttpClient {
  execute(request: HttpUriRequest | null): Promise<number>;
}

/**
 * `HttpClients.createDefault()`. Resolves with the response status line's code
 * after the entity has been consumed and discarded; rejects with
 * {@link HttpIOError} for anything the JDK would surface as an `IOException`.
 */
export function createDefaultHttpClient(): HttpClient {
  return {
    execute(request: HttpUriRequest | null): Promise<number> {
      if (request === null) {
        // Args.notNull(request, "HTTP request") inside CloseableHttpClient.
        throw new IllegalArgumentError('HTTP request may not be null');
      }
      const { url } = request;
      if (url === null) {
        // ClientProtocolException, which is an IOException.
        return Promise.reject(
          new HttpIOError(`URI does not specify a valid host name: ${request.rawUrl}`),
        );
      }
      return new Promise<number>((resolve, reject) => {
        const options: RequestOptions = {
          method: request.method,
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port === '' ? undefined : url.port,
          path: `${url.pathname}${url.search}`,
          // StringEntity is a fixed-length entity, so the outbound request is
          // Content-Length delimited rather than chunked.
          headers:
            request.body === null
              ? {}
              : {
                  'Content-Type': request.contentType ?? 'text/plain',
                  'Content-Length': String(Buffer.byteLength(request.body, 'utf8')),
                },
        };
        const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
        const outbound = send(options, (response) => {
          // EntityUtils.consume: drain the stream, ignore the content.
          response.resume();
          response.on('end', () => resolve(response.statusCode ?? 0));
          response.on('error', (error: Error) => reject(new HttpIOError(error.message)));
        });
        outbound.on('error', (error: Error) => reject(new HttpIOError(error.message)));
        if (request.body !== null) {
          outbound.write(request.body);
        }
        outbound.end();
      });
    },
  };
}

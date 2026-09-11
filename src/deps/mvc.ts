/**
 * The slice of Spring MVC (plus its embedded Tomcat) this application observes.
 *
 * Reproduced here because every one of these is visible to a caller:
 *   - `@RequestMapping` path matching with `{var}` and `*`, and the
 *     "most specific pattern wins" rule that puts `/api/devices` ahead of
 *     `/api/{userId}`;
 *   - `produces` content negotiation and its empty-bodied `406`;
 *   - the `400`/`404`/`405`/`415`/`500` JSON error document, its key order and
 *     its `Allow` header;
 *   - `;charset=UTF-8` on response content types, and which responses are
 *     chunked rather than length-delimited;
 *   - the container's own `OPTIONS` answer;
 *   - static resource serving from the classpath `static/` directory.
 */

import { readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';

export const HTTP_METHOD_ORDER = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'TRACE',
] as const;

/** What `HttpServlet.doOptions` reports for the dispatcher servlet. */
export const OPTIONS_ALLOW = 'GET, HEAD, POST, PUT, DELETE, TRACE, OPTIONS, PATCH';

const REASON_PHRASES: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  415: 'Unsupported Media Type',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

export function reasonPhrase(status: number): string {
  return REASON_PHRASES[status] ?? 'Unknown';
}

/** `org.springframework.web.HttpMediaTypeNotSupportedException`. */
export class HttpMediaTypeNotSupportedError extends Error {
  override readonly name = 'HttpMediaTypeNotSupportedException';
}

/** `org.springframework.http.converter.HttpMessageNotReadableException`. */
export class HttpMessageNotReadableError extends Error {
  override readonly name = 'HttpMessageNotReadableException';
}

/** `org.springframework.web.HttpRequestMethodNotSupportedException`. */
export class HttpRequestMethodNotSupportedError extends Error {
  override readonly name = 'HttpRequestMethodNotSupportedException';

  constructor(
    method: string,
    readonly allow: readonly string[],
  ) {
    super(`Request method '${method}' not supported`);
  }
}

/** `java.lang.NullPointerException`. */
export class NullPointerError extends Error {
  override readonly name = 'NullPointerException';

  constructor() {
    super('');
  }
}

/**
 * What `RequestResponseBodyMethodProcessor` reports for an absent body. The
 * original appends the JVM identity hash of the handler parameter, which has no
 * counterpart here; see truth.md.
 */
export const MISSING_REQUEST_BODY =
  'Required request body content is missing: ' +
  'org.springframework.web.method.HandlerMethod$HandlerMethodParameter';

/** `org.springframework.http.ResponseEntity`. */
export class ResponseEntity<T> {
  constructor(
    readonly body: T | null,
    readonly headers: Readonly<Record<string, string>> | null,
    readonly status: number,
  ) {}
}

/** `javax.servlet.http.HttpServletRequest`, narrowed to what the handlers use. */
export interface ServletRequest {
  readonly method: string;
  readonly path: string;
  readonly pathVariables: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
  /** `request.getRemoteAddr()` */
  readonly remoteAddr: string;
  /** `request.getLocalAddr()` */
  readonly localAddr: string;
  /** `request.getLocalPort()` */
  readonly localPort: number;
  /** `request.toString()` — only ever logged. */
  readonly description: string;
}

export type Handler = (request: ServletRequest) => ResponseEntity<unknown> | Promise<ResponseEntity<unknown>>;

export interface Mapping {
  readonly pattern: string;
  readonly method: string;
  /** `produces = "…"`; absent means the handler's own converter decides. */
  readonly produces?: string;
  /**
   * What the handler's `@RequestBody` parameter binds to. Both kinds reject a
   * missing body before the handler runs; only `'json'` also negotiates the
   * request content type, because only a POJO needs a Jackson converter.
   */
  readonly requestBody?: 'json' | 'string';
  readonly handle: Handler;
}

interface CompiledMapping extends Mapping {
  readonly regex: RegExp;
  readonly variableNames: readonly string[];
  readonly wildcardCount: number;
}

function compile(mapping: Mapping): CompiledMapping {
  const variableNames: string[] = [];
  let wildcardCount = 0;
  const source = mapping.pattern.replace(/\{([^/}]+)\}|\*|[.+?^${}()|[\]\\]/g, (token, variable: string | undefined) => {
    if (variable !== undefined) {
      variableNames.push(variable);
      wildcardCount += 1;
      return '([^/]+)';
    }
    if (token === '*') {
      wildcardCount += 1;
      return '[^/]*';
    }
    return `\\${token}`;
  });
  return {
    ...mapping,
    regex: new RegExp(`^${source}$`),
    variableNames,
    wildcardCount,
  };
}

/**
 * `AntPathMatcher.getPatternComparator`: fewer wildcards wins, then the longer
 * pattern wins. This is what makes `POST /api/devices` reach `DeviceResource`
 * rather than `HueMulator`'s `/api/*`.
 */
function moreSpecific(left: CompiledMapping, right: CompiledMapping): number {
  if (left.wildcardCount !== right.wildcardCount) {
    return left.wildcardCount - right.wildcardCount;
  }
  return right.pattern.length - left.pattern.length;
}

/** Strips the `::ffff:` prefix Node reports for an IPv4-mapped socket address. */
export function normalizeAddress(address: string | undefined): string {
  if (address === undefined) {
    return '';
  }
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}

/**
 * The media type a servlet container reports for a body whose type it cannot
 * name — a request that sent no `Content-Type`, or a static file with an
 * unrecognised extension. Both callers below need the same string.
 */
export const APPLICATION_OCTET_STREAM = 'application/octet-stream';

/**
 * What `request.getContentType()` returns after Spring Boot's
 * `CharacterEncodingFilter` has forced UTF-8 onto the request: a media type
 * with no charset gains `;charset=UTF-8`, and a missing header reads as
 * `application/octet-stream`.
 */
export function effectiveRequestContentType(header: string | undefined): string {
  if (header === undefined || header.trim() === '') {
    return APPLICATION_OCTET_STREAM;
  }
  return /charset=/i.test(header) ? header : `${header};charset=UTF-8`;
}

function isJsonRequest(contentType: string): boolean {
  const base = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  return base === 'application/json' || base.endsWith('+json');
}

/** `MediaType` matching for a single `Accept` entry against a produced type. */
function acceptMatches(accept: string, produced: string): boolean {
  const [range] = accept.split(';');
  const trimmed = (range ?? '').trim().toLowerCase();
  if (trimmed === '' || trimmed === '*/*') {
    return true;
  }
  const [producedType, producedSubtype] = produced.toLowerCase().split('/');
  const [acceptType, acceptSubtype] = trimmed.split('/');
  if (acceptType !== '*' && acceptType !== producedType) {
    return false;
  }
  return acceptSubtype === '*' || acceptSubtype === producedSubtype;
}

export function accepts(header: string | undefined, produced: string): boolean {
  if (header === undefined || header.trim() === '') {
    return true;
  }
  return header.split(',').some((entry) => acceptMatches(entry, produced));
}

/** `BasicErrorController`'s error attributes, in the order Spring emits them. */
export function errorDocument(
  status: number,
  path: string,
  exception: string | null,
  message: string,
  now: number = Date.now(),
): string {
  const attributes: Record<string, unknown> = {
    timestamp: now,
    status,
    error: reasonPhrase(status),
  };
  if (exception !== null) {
    attributes['exception'] = exception;
  }
  attributes['message'] = message;
  attributes['path'] = path;
  return JSON.stringify(attributes);
}

const STATIC_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html;charset=UTF-8',
  '.js': 'application/javascript;charset=UTF-8',
  '.css': 'text/css;charset=UTF-8',
  '.json': 'application/json;charset=UTF-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml;charset=UTF-8',
};

export interface DispatcherOptions {
  readonly mappings: readonly Mapping[];
  /** Classpath `static/` equivalent; `null` disables resource handling. */
  readonly staticRoot: string | null;
  /** Headers every response carries, whatever the outcome. */
  readonly alwaysHeaders: Readonly<Record<string, string>>;
}

export interface RawResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer | null;
  /** When false the response is chunked, as Spring's converters leave it. */
  readonly lengthDelimited: boolean;
}

function serveStatic(root: string, path: string): RawResponse | null {
  const relative = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
  if (relative === '/' || relative === '' || relative.endsWith('/')) {
    return null;
  }
  const file = join(root, relative);
  if (!file.startsWith(root)) {
    return null;
  }
  try {
    if (!statSync(file).isFile()) {
      return null;
    }
  } catch {
    return null;
  }
  const body = readFileSync(file);
  const contentType = STATIC_CONTENT_TYPES[extname(file).toLowerCase()] ?? APPLICATION_OCTET_STREAM;
  return { status: 200, headers: { 'Content-Type': contentType }, body, lengthDelimited: true };
}

/**
 * Renders a handler's `ResponseEntity`. A `null` body means no `Content-Type`
 * and `Content-Length: 0`; a string body goes out verbatim through
 * `StringHttpMessageConverter` (`text/plain` unless `produces` overrides it);
 * anything else is serialised by Jackson and left chunked.
 */
function renderEntity(entity: ResponseEntity<unknown>, produces: string | undefined): RawResponse {
  const headers: Record<string, string> = { ...(entity.headers ?? {}) };
  if (entity.body === null || entity.body === undefined) {
    return { status: entity.status, headers, body: null, lengthDelimited: true };
  }
  if (typeof entity.body === 'string') {
    headers['Content-Type'] = produces === undefined ? 'text/plain;charset=UTF-8' : `${produces};charset=UTF-8`;
    return {
      status: entity.status,
      headers,
      body: Buffer.from(entity.body, 'utf8'),
      lengthDelimited: true,
    };
  }
  headers['Content-Type'] = `${produces ?? 'application/json'};charset=UTF-8`;
  return {
    status: entity.status,
    headers,
    body: Buffer.from(JSON.stringify(entity.body), 'utf8'),
    lengthDelimited: false,
  };
}

function errorResponse(
  status: number,
  path: string,
  exception: string | null,
  message: string,
  extra: Record<string, string> = {},
): RawResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8', ...extra },
    body: Buffer.from(errorDocument(status, path, exception, message), 'utf8'),
    lengthDelimited: false,
  };
}

export class Dispatcher {
  private readonly compiled: readonly CompiledMapping[];

  constructor(private readonly options: DispatcherOptions) {
    this.compiled = options.mappings.map(compile);
  }

  async dispatch(request: ServletRequest): Promise<RawResponse> {
    if (request.method === 'OPTIONS') {
      return {
        status: 200,
        headers: { Allow: OPTIONS_ALLOW },
        body: null,
        lengthDelimited: true,
      };
    }

    const pathMatches = this.compiled.filter((mapping) => mapping.regex.test(request.path));
    const methodMatches = pathMatches
      .filter((mapping) => mapping.method === request.method)
      .sort(moreSpecific);

    if (methodMatches.length === 0) {
      if (pathMatches.length > 0) {
        const allow = HTTP_METHOD_ORDER.filter((method) =>
          pathMatches.some((mapping) => mapping.method === method),
        );
        const error = new HttpRequestMethodNotSupportedError(request.method, allow);
        return errorResponse(405, request.path, error.name, error.message, {
          Allow: allow.join(', '),
        });
      }
      if (request.method === 'GET' || request.method === 'HEAD') {
        const resource = this.options.staticRoot === null
          ? null
          : serveStatic(this.options.staticRoot, request.path);
        if (resource !== null) {
          return resource;
        }
      }
      return errorResponse(404, request.path, null, 'No message available');
    }

    const mapping = methodMatches[0] as CompiledMapping;

    if (mapping.produces !== undefined && !accepts(request.headers['accept'], mapping.produces)) {
      return { status: 406, headers: {}, body: null, lengthDelimited: true };
    }

    if (mapping.requestBody === 'json') {
      const contentType = effectiveRequestContentType(request.headers['content-type']);
      if (!isJsonRequest(contentType)) {
        const error = new HttpMediaTypeNotSupportedError(`Content type '${contentType}' not supported`);
        return errorResponse(415, request.path, error.name, error.message);
      }
    }
    if (mapping.requestBody !== undefined && request.body === '') {
      // RequestResponseBodyMethodProcessor rejects an absent body for every
      // required @RequestBody, whatever it binds to.
      const error = new HttpMessageNotReadableError(MISSING_REQUEST_BODY);
      return errorResponse(400, request.path, error.name, error.message);
    }

    const match = mapping.regex.exec(request.path);
    const pathVariables: Record<string, string> = {};
    mapping.variableNames.forEach((variable, index) => {
      pathVariables[variable] = match?.[index + 1] ?? '';
    });

    try {
      const entity = await mapping.handle({ ...request, pathVariables });
      return renderEntity(entity, mapping.produces);
    } catch (error: unknown) {
      if (error instanceof HttpMessageNotReadableError) {
        return errorResponse(400, request.path, error.name, error.message);
      }
      const name = error instanceof Error ? error.name : 'Exception';
      const message = error instanceof Error && error.message !== '' ? error.message : 'No message available';
      return errorResponse(500, request.path, name, message);
    }
  }
}

/** Adapts a Node request/response pair onto {@link Dispatcher}. */
export async function handleNodeRequest(
  dispatcher: Dispatcher,
  alwaysHeaders: Readonly<Record<string, string>>,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  const body = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

  const url = incoming.url ?? '/';
  const path = url.split('?')[0] ?? '/';
  const request: ServletRequest = {
    method: incoming.method ?? 'GET',
    path,
    pathVariables: {},
    headers: incoming.headers as Readonly<Record<string, string | undefined>>,
    body,
    remoteAddr: normalizeAddress(incoming.socket.remoteAddress),
    localAddr: normalizeAddress(incoming.socket.localAddress),
    localPort: incoming.socket.localPort ?? 0,
    description: `${incoming.method ?? 'GET'} ${url}`,
  };

  const response = await dispatcher.dispatch(request);
  const headers: Record<string, string> = { ...alwaysHeaders, ...response.headers };
  if (response.body === null) {
    headers['Content-Length'] = '0';
  } else if (response.lengthDelimited) {
    headers['Content-Length'] = String(response.body.byteLength);
  }
  outgoing.writeHead(response.status, reasonPhrase(response.status), headers);
  outgoing.end(response.body ?? undefined);
}

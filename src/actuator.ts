/**
 * The part of `spring-boot-starter-actuator` that is observable here.
 *
 * `GET /health` answers `{"status":"UP"}` — the unauthenticated view, which
 * omits the datasource detail — and every response in the application carries
 * `X-Application-Context: application`. The introspection endpoints
 * (`/env`, `/beans`, `/autoconfig`, `/configprops`, `/mappings`, `/dump`,
 * `/trace`, `/metrics`) enumerate Spring bean definitions and JVM internals and
 * are out of scope; see truth.md.
 */

import { ResponseEntity, type Mapping } from './deps/mvc';

export const APPLICATION_CONTEXT_HEADER: Readonly<Record<string, string>> = Object.freeze({
  'X-Application-Context': 'application',
});

export function healthMappings(): Mapping[] {
  return [
    {
      pattern: '/health',
      method: 'GET',
      produces: 'application/json',
      handle: () => new ResponseEntity({ status: 'UP' }, null, 200),
    },
  ];
}

/**
 * https://spring.io/guides/gs/rest-service-cors/
 * for some reason i thought chrome would send only preflight HEAD request
 * BEFORE the actual call?
 *
 * The original is a servlet `Filter` and so runs ahead of the dispatcher: the
 * four headers are on *every* response, including 404s, 406s and OPTIONS.
 */
export const CORS_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE, PUT',
  'Access-Control-Max-Age': '3600',
  'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
});

export function corsHeaders(): Record<string, string> {
  return { ...CORS_HEADERS };
}

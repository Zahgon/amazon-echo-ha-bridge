/**
 * The slice of `jackson-databind` this application actually observes.
 *
 * The original constructs its own `ObjectMapper` with
 * `FAIL_ON_UNKNOWN_PROPERTIES` disabled, and Spring Boot configures the MVC
 * mapper the same way. Unknown properties are therefore ignored everywhere,
 * which falls out of binding named fields one by one. What does *not* fall out
 * for free, and is reproduced here, is Jackson's failure behaviour: a body that
 * is not JSON, or a value that cannot be coerced to the declared field type, is
 * an error rather than a silently defaulted field.
 *
 * Serialisation is the mirror image: every model exposes a `toJson()` that
 * builds a plain object with the keys in the order Jackson discovers the Java
 * fields, `null` included rather than omitted. `JSON.stringify` then produces
 * the same bytes.
 */

/** `com.fasterxml.jackson.core.JsonParseException`. */
export class JsonParseError extends Error {
  override readonly name = 'JsonParseException';
}

/** `com.fasterxml.jackson.databind.exc.MismatchedInputException`. */
export class MismatchedInputError extends Error {
  override readonly name = 'MismatchedInputException';
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * `ObjectMapper.readTree`. Jackson rejects an empty document, which the
 * built-in parser also does, but with a different message.
 */
export function parseJson(text: string): JsonValue {
  if (text.trim() === '') {
    throw new JsonParseError('No content to map due to end-of-input');
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch (error: unknown) {
    throw new JsonParseError(error instanceof Error ? error.message : String(error));
  }
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The document a POJO binder accepts: an object, or `null` — which Jackson
 * binds to a null reference rather than an instance. Anything else is a
 * mismatch.
 */
export function readObject(text: string): { [key: string]: JsonValue } | null {
  const tree = parseJson(text);
  if (tree === null) {
    return null;
  }
  if (!isObject(tree)) {
    throw new MismatchedInputError(
      `Cannot deserialize instance of object out of ${Array.isArray(tree) ? 'START_ARRAY' : typeof tree} token`,
    );
  }
  return tree;
}

export function bindString(
  source: { [key: string]: JsonValue },
  key: string,
  fallback: string | null,
): string | null {
  const value = source[key];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  throw new MismatchedInputError(`Cannot deserialize instance of java.lang.String out of ${key}`);
}

/** `int` field: Jackson truncates a fractional number and parses a numeric string. */
export function bindInt(source: { [key: string]: JsonValue }, key: string, fallback: number): number {
  const value = source[key];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'number') {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  throw new MismatchedInputError(`Cannot deserialize value of type int from ${key}`);
}

/** `boolean` field: Jackson accepts the literals and the strings "true"/"false". */
export function bindBoolean(
  source: { [key: string]: JsonValue },
  key: string,
  fallback: boolean,
): boolean {
  const value = source[key];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') {
      return true;
    }
    if (lowered === 'false') {
      return false;
    }
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  throw new MismatchedInputError(`Cannot deserialize value of type boolean from ${key}`);
}

/** `List<Double>` field. */
export function bindNumberList(
  source: { [key: string]: JsonValue },
  key: string,
): number[] | null {
  const value = source[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new MismatchedInputError(`Cannot deserialize instance of java.util.List out of ${key}`);
  }
  return value.map((element) => {
    if (typeof element === 'number') {
      return element;
    }
    if (typeof element === 'string' && element.trim() !== '' && !Number.isNaN(Number(element))) {
      return Number(element);
    }
    throw new MismatchedInputError(`Cannot deserialize value of type double from ${key}`);
  });
}

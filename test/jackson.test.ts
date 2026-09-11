/** The Jackson behaviours the application depends on. */

import { describe, expect, it } from 'vitest';

import {
  bindBoolean,
  bindInt,
  bindNumberList,
  bindString,
  JsonParseError,
  MismatchedInputError,
  parseJson,
  readObject,
} from '../src/deps/jackson';

describe('parseJson', () => {
  it('rejects an empty document', () => {
    expect(() => parseJson('   ')).toThrow(JsonParseError);
  });

  it('rejects malformed json', () => {
    expect(() => parseJson('{oops')).toThrow(JsonParseError);
  });

  it('accepts a scalar document', () => {
    expect(parseJson('7')).toBe(7);
  });
});

describe('readObject', () => {
  it('binds an object', () => {
    expect(readObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('binds a literal null to a null reference', () => {
    expect(readObject('null')).toBeNull();
  });

  it('rejects an array and a scalar', () => {
    expect(() => readObject('[1]')).toThrow(MismatchedInputError);
    expect(() => readObject('"text"')).toThrow(MismatchedInputError);
  });
});

describe('field binding', () => {
  it('falls back when a property is absent or explicitly null', () => {
    expect(bindString({}, 'x', null)).toBeNull();
    expect(bindString({ x: null }, 'x', 'fallback')).toBe('fallback');
    expect(bindInt({}, 'bri', 255)).toBe(255);
    expect(bindBoolean({}, 'on', false)).toBe(false);
    expect(bindNumberList({}, 'xy')).toBeNull();
  });

  it('coerces scalars to string the way Jackson does', () => {
    expect(bindString({ x: 5 }, 'x', null)).toBe('5');
    expect(bindString({ x: true }, 'x', null)).toBe('true');
    expect(() => bindString({ x: [1] }, 'x', null)).toThrow(MismatchedInputError);
  });

  it('truncates a fractional int and parses a numeric string', () => {
    expect(bindInt({ bri: 12.9 }, 'bri', 0)).toBe(12);
    expect(bindInt({ bri: ' 42 ' }, 'bri', 0)).toBe(42);
    expect(() => bindInt({ bri: 'abc' }, 'bri', 0)).toThrow(MismatchedInputError);
  });

  it('accepts the boolean literals, their strings, and numbers', () => {
    expect(bindBoolean({ on: true }, 'on', false)).toBe(true);
    expect(bindBoolean({ on: 'TRUE' }, 'on', false)).toBe(true);
    expect(bindBoolean({ on: 'false' }, 'on', true)).toBe(false);
    expect(bindBoolean({ on: 1 }, 'on', false)).toBe(true);
    expect(bindBoolean({ on: 0 }, 'on', true)).toBe(false);
    expect(() => bindBoolean({ on: 'maybe' }, 'on', false)).toThrow(MismatchedInputError);
  });

  it('binds a list of doubles and rejects anything else', () => {
    expect(bindNumberList({ xy: [0.4255, '0.3998'] }, 'xy')).toEqual([0.4255, 0.3998]);
    expect(() => bindNumberList({ xy: 'nope' }, 'xy')).toThrow(MismatchedInputError);
    expect(() => bindNumberList({ xy: [true] }, 'xy')).toThrow(MismatchedInputError);
  });
});

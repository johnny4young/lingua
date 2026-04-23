import { describe, expect, it } from 'vitest';
import {
  formatAllCases,
  toCamel,
  toConstant,
  toKebab,
  toPascal,
  toSentence,
  toSnake,
  toTitle,
  toWords,
} from '@/utils/stringCase';

describe('toWords', () => {
  it('returns an empty array for empty or separator-only input', () => {
    expect(toWords('')).toEqual([]);
    expect(toWords('   ')).toEqual([]);
    expect(toWords('___ - - .')).toEqual([]);
  });

  it('splits common separators into lowercase word tokens', () => {
    expect(toWords('foo_bar-baz qux')).toEqual(['foo', 'bar', 'baz', 'qux']);
    expect(toWords('foo.bar/baz\\qux')).toEqual(['foo', 'bar', 'baz', 'qux']);
    expect(toWords('foo, bar; baz: qux')).toEqual(['foo', 'bar', 'baz', 'qux']);
    expect(toWords('foo!bar+baz—qux')).toEqual(['foo', 'bar', 'baz', 'qux']);
  });

  it('splits camelCase and PascalCase boundaries', () => {
    expect(toWords('fooBar')).toEqual(['foo', 'bar']);
    expect(toWords('FooBar')).toEqual(['foo', 'bar']);
    expect(toWords('fooBarBaz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('keeps acronyms grouped until the next lowercase letter', () => {
    expect(toWords('HTTPRequest')).toEqual(['http', 'request']);
    expect(toWords('HTMLTag')).toEqual(['html', 'tag']);
    expect(toWords('parseJSONValue')).toEqual(['parse', 'json', 'value']);
  });

  it('breaks letter/digit boundaries into separate tokens', () => {
    expect(toWords('v2api')).toEqual(['v', '2', 'api']);
    expect(toWords('chapter1intro')).toEqual(['chapter', '1', 'intro']);
  });

  it('keeps non-ASCII runs intact without casing them', () => {
    expect(toWords('árbol de ñandú')).toEqual(['árbol', 'de', 'ñandú']);
    // Pure CJK run passes through as one token.
    expect(toWords('東京タワー')).toEqual(['東京タワー']);
    // Emoji separator is handled as a non-ASCII run.
    expect(toWords('hello 👋🏽 world')).toEqual(['hello', '👋🏽', 'world']);
  });
});

describe('case emitters', () => {
  it('emit consistent shapes for a canonical identifier phrase', () => {
    const input = 'user profile page';
    expect(toCamel(input)).toBe('userProfilePage');
    expect(toPascal(input)).toBe('UserProfilePage');
    expect(toSnake(input)).toBe('user_profile_page');
    expect(toKebab(input)).toBe('user-profile-page');
    expect(toConstant(input)).toBe('USER_PROFILE_PAGE');
    expect(toSentence(input)).toBe('User profile page');
    expect(toTitle(input)).toBe('User Profile Page');
  });

  it('are idempotent on their own shape', () => {
    expect(toSnake('user_profile_page')).toBe('user_profile_page');
    expect(toCamel('userProfilePage')).toBe('userProfilePage');
    expect(toKebab('user-profile-page')).toBe('user-profile-page');
    expect(toConstant('USER_PROFILE_PAGE')).toBe('USER_PROFILE_PAGE');
    expect(toPascal('UserProfilePage')).toBe('UserProfilePage');
  });

  it('return empty strings for empty input', () => {
    expect(toCamel('')).toBe('');
    expect(toPascal('')).toBe('');
    expect(toSnake('')).toBe('');
    expect(toKebab('')).toBe('');
    expect(toConstant('')).toBe('');
    expect(toSentence('')).toBe('');
    expect(toTitle('')).toBe('');
  });

  it('preserve Unicode letters through the casing operations', () => {
    expect(toTitle('árbol de ñandú')).toBe('Árbol De Ñandú');
    expect(toSentence('árbol de ñandú')).toBe('Árbol de ñandú');
  });

  it('round-trip snake ↔ camel ↔ kebab for the same input', () => {
    const raw = 'HTTPResponseV2';
    const snake = toSnake(raw);
    expect(snake).toBe('http_response_v_2');
    expect(toCamel(snake)).toBe('httpResponseV2');
    expect(toKebab(snake)).toBe('http-response-v-2');
  });
});

describe('formatAllCases', () => {
  it('returns every casing in a single pass', () => {
    const outputs = formatAllCases('parseJSONValue');
    expect(outputs).toEqual({
      camel: 'parseJsonValue',
      pascal: 'ParseJsonValue',
      snake: 'parse_json_value',
      kebab: 'parse-json-value',
      constant: 'PARSE_JSON_VALUE',
      sentence: 'Parse json value',
      title: 'Parse Json Value',
    });
  });

  it('returns empty strings across the board for empty input', () => {
    expect(formatAllCases('')).toEqual({
      camel: '',
      pascal: '',
      snake: '',
      kebab: '',
      constant: '',
      sentence: '',
      title: '',
    });
  });
});

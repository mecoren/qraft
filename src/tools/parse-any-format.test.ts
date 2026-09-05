/**
 * parse-any-format 单元测试 —— YAML / TOML / JSON5 / Properties / URL 参数 → JSON
 * 及 json-utils.parseSmart 的多格式嗅探集成
 */
import { describe, expect, it } from 'vitest';
import {
  json5ToJson,
  propertiesToJson,
  tomlToJson,
  urlParamsToJson,
  yamlToJson,
} from './parse-any-format';
import { parseSmart, sniffInputFormat } from './json-utils';
import { jsonToProperties, jsonToToml, jsonToUrlParams, jsonToYaml } from './json-formats';

describe('yamlToJson', () => {
  it('parses mappings, sequences and scalars', () => {
    expect(yamlToJson('a: 1\nb:\n  - x\n  - y\n')).toEqual({ a: 1, b: ['x', 'y'] });
  });

  it('parses flow style and nested docs', () => {
    expect(yamlToJson('{a: {b: [1, 2]}}')).toEqual({ a: { b: [1, 2] } });
  });

  it('throws on invalid yaml', () => {
    expect(() => yamlToJson('a: [1,')).toThrow();
  });
});

describe('tomlToJson', () => {
  it('parses scalars, strings, arrays and inline tables', () => {
    const doc = [
      'title = "demo"',
      'count = 3',
      'ratio = 0.75',
      'enabled = true',
      'ports = [8000, 8001]',
      'point = { x = 1, y = 2 }',
    ].join('\n');
    expect(tomlToJson(doc)).toEqual({
      title: 'demo',
      count: 3,
      ratio: 0.75,
      enabled: true,
      ports: [8000, 8001],
      point: { x: 1, y: 2 },
    });
  });

  it('parses [table] and [[array of tables]] headers with nesting', () => {
    const doc = [
      'name = "root"',
      '',
      '[owner]',
      'name = "qraft"',
      '',
      '[owner.nested]',
      'ok = true',
      '',
      '[[products]]',
      'id = 1',
      '',
      '[[products]]',
      'id = 2',
    ].join('\n');
    expect(tomlToJson(doc)).toEqual({
      name: 'root',
      owner: { name: 'qraft', nested: { ok: true } },
      products: [{ id: 1 }, { id: 2 }],
    });
  });

  it('supports comments, quoted keys, escapes and hex/octal/binary ints', () => {
    const doc = [
      '# full line comment',
      '"my key" = "v"', // trailing comment',
      'hex = 0xFF',
      'oct = 0o17',
      'bin = 0b101',
      'big = 1_000',
      'esc = "tab\\there"',
    ].join('\n');
    expect(tomlToJson(doc)).toEqual({
      'my key': 'v',
      hex: 255,
      oct: 15,
      bin: 5,
      big: 1000,
      esc: 'tab\there',
    });
  });

  it('supports multi-line strings and dotted keys', () => {
    const doc = ['text = """', 'line1', 'line2"""', "literal = 'no \\escape'", 'a.b.c = 1'].join(
      '\n',
    );
    expect(tomlToJson(doc)).toEqual({
      text: 'line1\nline2',
      literal: 'no \\escape',
      a: { b: { c: 1 } },
    });
  });

  it('rejects duplicate keys and scalar/table conflicts', () => {
    expect(() => tomlToJson('a = 1\na = 2')).toThrow();
    expect(() => tomlToJson('a = 1\n[a]\nb = 2')).toThrow();
    expect(() => tomlToJson('[a]\n[a]')).toThrow();
  });

  it('round-trips with jsonToToml for table/array-of-table shapes', () => {
    const value = {
      name: 't',
      owner: { active: true },
      products: [{ id: 1 }, { id: 2 }],
      ports: [1, 2],
    };
    expect(tomlToJson(jsonToToml(value))).toEqual(value);
  });
});

describe('json5ToJson', () => {
  it('parses unquoted keys, single quotes and comments', () => {
    const doc = [
      '{',
      '  // line comment',
      '  /* block comment */',
      "  name: 'qraft',",
      '  count: 3,',
      '}',
    ].join('\n');
    expect(json5ToJson(doc)).toEqual({ name: 'qraft', count: 3 });
  });

  it('supports trailing commas, hex numbers and leading/trailing dots', () => {
    expect(json5ToJson('[1, 2, 3,]')).toEqual([1, 2, 3]);
    expect(json5ToJson('{ a: 0x10, b: .5, c: 5., }')).toEqual({ a: 16, b: 0.5, c: 5 });
  });

  it('supports Infinity/NaN, \\x and \\u escapes, and newline strings', () => {
    expect(json5ToJson('[Infinity, -Infinity, NaN]')).toEqual([
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NaN,
    ]);
    expect(json5ToJson('"\\x41\\u0042"')).toBe('AB');
    expect(json5ToJson('"a\\\nb"')).toBe('a\nb');
  });

  it('throws on trailing garbage and unterminated constructs', () => {
    expect(() => json5ToJson('{} x')).toThrow();
    expect(() => json5ToJson('"abc')).toThrow();
    expect(() => json5ToJson('{a:}')).toThrow();
  });
});

describe('propertiesToJson', () => {
  it('parses = and : separators into nested objects', () => {
    expect(propertiesToJson('db.host=localhost\ndb.port=5432')).toEqual({
      db: { host: 'localhost', port: '5432' },
    });
    expect(propertiesToJson('key:value')).toEqual({ key: 'value' });
  });

  it('handles comments, blank lines, line continuation and escapes', () => {
    const doc = [
      '# comment',
      '! another comment',
      '',
      'msg = hello \\\n  world',
      'esc = line1\\nline2',
      'uni = \\u4e2d\\u6587',
      'spaced key = value',
    ].join('\n');
    expect(propertiesToJson(doc)).toEqual({
      msg: 'hello world',
      esc: 'line1\nline2',
      uni: '中文',
      'spaced key': 'value',
    });
  });

  it('keeps escaped separators literal in keys', () => {
    expect(propertiesToJson('a\\=b=c')).toEqual({ 'a=b': 'c' });
    expect(propertiesToJson('a\\.b=c')).toEqual({ 'a.b': 'c' });
  });

  it('round-trips with jsonToProperties for flat scalar values', () => {
    const value = { db: { host: 'localhost', port: '5432' }, debug: 'true' };
    expect(propertiesToJson(jsonToProperties(value))).toEqual(value);
  });

  it('throws when no entry parses', () => {
    expect(() => propertiesToJson('# only comments\n\n')).toThrow();
  });
});

describe('urlParamsToJson', () => {
  it('parses flat query strings with decoding', () => {
    expect(urlParamsToJson('page=1&q=hello+world')).toEqual({ page: '1', q: 'hello world' });
    expect(urlParamsToJson('kw=' + encodeURIComponent('中文'))).toEqual({ kw: '中文' });
  });

  it('supports leading ?/#, full URLs and bare keys', () => {
    expect(urlParamsToJson('?a=1')).toEqual({ a: '1' });
    expect(urlParamsToJson('https://x.io/p?a=1#frag')).toEqual({ a: '1' });
    expect(urlParamsToJson('flag')).toEqual({ flag: '' });
  });

  it('collects repeated keys into arrays', () => {
    expect(urlParamsToJson('tag=a&tag=b')).toEqual({ tag: ['a', 'b'] });
  });

  it('restores dot-path nesting from jsonToUrlParams', () => {
    const value = { filter: { tag: ['a', 'b'] }, size: '10' };
    expect(urlParamsToJson(jsonToUrlParams(value))).toEqual(value);
  });

  it('throws on empty input', () => {
    expect(() => urlParamsToJson('  ')).toThrow();
  });
});

describe('sniffInputFormat', () => {
  it('detects xml and urlparams', () => {
    expect(sniffInputFormat('<root/>')).toBe('xml');
    expect(sniffInputFormat('?a=1&b=2')).toBe('urlparams');
    expect(sniffInputFormat('a=1&b=2')).toBe('urlparams');
  });

  it('detects properties and toml', () => {
    expect(sniffInputFormat('a.b=1\nc=2')).toBe('properties');
    expect(sniffInputFormat('[owner]\nname = "x"')).toBe('toml');
    expect(sniffInputFormat('title = "demo"\n[owner]\nname = "qraft"')).toBe('toml');
  });

  it('does not misclassify JSON or YAML as other formats', () => {
    expect(sniffInputFormat('{"a": 1}')).toBeNull();
    expect(sniffInputFormat('{\n  "a": 1,\n  "b": [1, 2]\n}')).toBeNull();
    expect(sniffInputFormat('a: 1\nb: 2')).toBeNull(); // YAML → 走 parseSmart 回退
    expect(sniffInputFormat('')).toBeNull();
  });
});

describe('parseSmart multi-format integration', () => {
  it('auto-converts YAML input to a JSON value', () => {
    expect(parseSmart('a: 1\nb:\n  - x\n  - y')).toEqual({ a: 1, b: ['x', 'y'] });
  });

  it('auto-converts TOML input to a JSON value', () => {
    expect(parseSmart('title = "demo"\n[owner]\nname = "qraft"')).toEqual({
      title: 'demo',
      owner: { name: 'qraft' },
    });
  });

  it('auto-converts JSON5 input (unquoted keys) to a JSON value', () => {
    expect(parseSmart('{ a: 1, b: [1, 2,] }')).toEqual({ a: 1, b: [1, 2] });
  });

  it('auto-converts Properties input to a JSON value', () => {
    expect(parseSmart('db.host=localhost\ndb.port=5432')).toEqual({
      db: { host: 'localhost', port: '5432' },
    });
  });

  it('auto-converts URL params input to a JSON value', () => {
    expect(parseSmart('page=1&q=hello')).toEqual({ page: '1', q: 'hello' });
  });

  it('auto-converts XML input to a JSON value (existing behavior)', () => {
    expect(parseSmart('<root><name>hi</name></root>')).toEqual({ root: { name: 'hi' } });
  });

  it('still parses plain JSON directly', () => {
    expect(parseSmart('{"a":1}')).toEqual({ a: 1 });
  });

  it('throws the original JSON error when no format matches', () => {
    expect(() => parseSmart('{bad json}')).toThrow();
    expect(() => parseSmart('')).toThrow();
  });

  it('chains input formats into jsonToYaml (TOML → JSON → YAML)', () => {
    const value = parseSmart('a = 1\n[list]\nitems = ["x"]\n');
    expect(jsonToYaml(value)).toContain('a: 1');
    expect(jsonToYaml(value)).toContain('list:\n  items:\n    - x');
  });
});

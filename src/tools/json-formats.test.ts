/**
 * json-formats 单元测试 —— JSON → 数据格式转换
 */
import { describe, expect, it } from 'vitest';
import { parseSmart, xmlToJson } from './json-utils';
import {
  DATA_FORMAT_ITEMS,
  jsonToProperties,
  jsonToToml,
  jsonToUrlParams,
  jsonToXml,
  jsonToYaml,
  toJson5,
} from './json-formats';

describe('DATA_FORMAT_ITEMS', () => {
  it('exposes xml/yaml/toml/json5/properties/urlparams in order', () => {
    expect(DATA_FORMAT_ITEMS.map((d) => d.id)).toEqual([
      'xml',
      'yaml',
      'toml',
      'json5',
      'properties',
      'urlparams',
    ]);
  });
});

describe('jsonToYaml', () => {
  it('serializes scalars, arrays and nested objects', () => {
    const yaml = jsonToYaml({ a: 1, b: ['x', 'y'], c: { d: true } });
    expect(yaml).toBe('a: 1\nb:\n  - x\n  - y\nc:\n  d: true\n');
  });
});

describe('jsonToXml', () => {
  it('converts objects/arrays/scalars to elements', () => {
    const xml = jsonToXml({ name: 'qraft', tags: ['a', 'b'], count: 2, active: true });
    expect(xml).toContain('<name>qraft</name>');
    expect(xml).toContain('<tags>a</tags>');
    expect(xml).toContain('<tags>b</tags>');
    expect(xml).toContain('<count>2</count>');
    expect(xml).toContain('<active>true</active>');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it('escapes special characters in text and attributes', () => {
    const xml = jsonToXml({ note: 'a<b & c' });
    expect(xml).toContain('<note>a&lt;b &amp; c</note>');
    const withAttr = jsonToXml({ el: { '@title': 'say "hi" <now>', v: 1 } });
    expect(withAttr).toContain('<el title="say &quot;hi&quot; &lt;now&gt;">');
  });

  it('round-trips attributes and text with xmlToJson (@ / #text conventions)', () => {
    const original = {
      user: { '@id': '7', name: 'qraft', '#text': 'hello' },
    };
    // 先把 XML 转成 JSON 形态(属性带 @、文本 #text),再转回 XML 应保持语义
    const jsonForm = {
      user: { '@id': '7', name: 'qraft', '#text': 'hello' },
    };
    const xml = jsonToXml(jsonForm);
    const back = xmlToJson(xml);
    expect(back).toEqual(original);
  });

  it('wraps array roots in <root> for single-root validity', () => {
    const xml = jsonToXml([1, 2]);
    expect(xml).toContain('<root>');
    expect(xml.match(/<item>1<\/item>/)).not.toBeNull();
    expect(xml.trimEnd().endsWith('</root>')).toBe(true);
  });

  it('emits self-closing tags for null values', () => {
    expect(jsonToXml({ missing: null })).toContain('<missing/>');
  });
});

describe('jsonToToml', () => {
  it('puts top-level scalars first then tables depth-first', () => {
    const toml = jsonToToml({
      title: 'demo',
      count: 3,
      owner: { name: 'qraft', active: true },
      deep: { inner: { x: 1 } },
    });
    const lines = toml.split('\n').filter(Boolean);
    expect(lines[0]).toBe('title = "demo"');
    expect(lines[1]).toBe('count = 3');
    expect(lines.indexOf('[owner]')).toBeGreaterThan(-1);
    expect(lines.indexOf('[owner]')).toBeLessThan(lines.indexOf('[deep.inner]'));
    expect(toml).toContain('name = "qraft"');
    expect(toml).toContain('x = 1');
  });

  it('expands arrays of objects as [[array of tables]] after inline values', () => {
    const toml = jsonToToml({
      name: 't',
      products: [{ id: 1 }, { id: 2 }],
    });
    const lines = toml.split('\n').filter(Boolean);
    expect(lines[0]).toBe('name = "t"');
    expect(lines.filter((l) => l === '[[products]]')).toHaveLength(2);
    // [[products]] 必须出现在顶层标量之后
    expect(lines.indexOf('[[products]]')).toBeGreaterThan(lines.indexOf('name = "t"'));
  });

  it('keeps scalar arrays inline and quotes special keys', () => {
    const toml = jsonToToml({ ports: [8000, 8001], 'my key': 'v' });
    expect(toml).toContain('ports = [8000, 8001]');
    expect(toml).toContain('"my key" = "v"');
  });

  it('renders null as empty string and rejects non-object roots', () => {
    expect(jsonToToml({ a: null })).toContain('a = ""');
    expect(jsonToToml([1])).toMatch(/^#/);
  });
});

describe('toJson5', () => {
  it('unquotes identifier keys and keeps structure', () => {
    const json5 = toJson5({ name: 'x', 'odd-key': 1, nested: { ok: [1, 2] } });
    expect(json5).toContain('name: "x"');
    expect(json5).toContain('"odd-key": 1');
    expect(json5).toContain('nested: {');
    expect(json5).toContain('ok: [');
    expect(json5).not.toContain('"name"');
  });

  it('handles empty containers and null', () => {
    expect(toJson5({})).toBe('{}');
    expect(toJson5([])).toBe('[]');
    expect(toJson5({ a: null })).toBe('{\n  a: null\n}');
  });
});

describe('jsonToProperties', () => {
  it('flattens nesting with dot notation', () => {
    const props = jsonToProperties({ db: { host: 'localhost', port: 5432 } });
    expect(props).toContain('db.host=localhost');
    expect(props).toContain('db.port=5432');
  });

  it('joins scalar arrays by comma and expands object arrays by index', () => {
    const props = jsonToProperties({
      tags: ['a', 'b'],
      items: [{ k: 1 }],
    });
    expect(props).toContain('tags=a, b');
    expect(props).toContain('items.0.k=1');
  });

  it('escapes keys and line breaks in values', () => {
    const props = jsonToProperties({ 'my key=x': 'line1\nline2' });
    expect(props).toContain('my\\ key\\=x=line1\\nline2');
  });

  it('rejects non-object roots', () => {
    expect(jsonToProperties('str')).toMatch(/^#/);
  });
});

describe('jsonToUrlParams', () => {
  it('encodes flat keys and values', () => {
    expect(jsonToUrlParams({ page: 1, q: 'hello world' })).toBe('page=1&q=hello+world');
  });

  it('uses dot paths for nesting and repeated keys for arrays', () => {
    const qs = jsonToUrlParams({ filter: { tag: ['a', 'b'] }, size: 10 });
    expect(qs).toContain('filter.tag=a&filter.tag=b');
    expect(qs).toContain('size=10');
  });

  it('percent-encodes CJK and ampersands', () => {
    const qs = jsonToUrlParams({ kw: '中文', sym: 'a&b' });
    expect(qs).toBe(`kw=${encodeURIComponent('中文')}&sym=a%26b`);
  });

  it('maps null to empty value', () => {
    expect(jsonToUrlParams({ x: null })).toBe('x=');
  });
});

describe('cross-format chain via parseSmart', () => {
  it('converts XML input to YAML (XML→JSON→YAML chain)', () => {
    const value = parseSmart('<root><name>hi</name><n>1</n></root>');
    const yaml = jsonToYaml(value);
    // xmlToJson 将元素文本保留为字符串(既有语义)
    expect(yaml).toContain('name: hi');
    expect(yaml).toContain('n: "1"');
  });
});

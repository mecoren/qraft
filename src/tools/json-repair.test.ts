import { describe, it, expect } from 'vitest';
import { repairJson } from './json-repair';

describe('repairJson', () => {
  it('returns already-valid JSON unchanged with no actions', () => {
    const result = repairJson('{"a":1}');
    expect(result.text).toBe('{"a":1}');
    expect(result.actions).toEqual([]);
    // fixed 语义为「产出文本可解析」,合法输入天然为 true
    expect(result.fixed).toBe(true);
  });

  it('strips Markdown code fences wrapping the document', () => {
    const result = repairJson('```json\n{"a":1}\n```');
    expect(JSON.parse(result.text)).toEqual({ a: 1 });
    expect(result.actions.length).toBe(1);
    expect(result.actions[0].kind).toBe('strip-fence');
    expect(result.fixed).toBe(true);
  });

  it('strips // and /* */ comments outside strings', () => {
    const result = repairJson('{\n  // 行注释\n  "a": 1 /* 块注释 */\n}');
    expect(JSON.parse(result.text)).toEqual({ a: 1 });
    expect(result.actions.some((a) => a.kind === 'strip-comment')).toBe(true);
  });

  it('does not strip // inside string values', () => {
    const result = repairJson('{"url":"https://example.com", // real comment\n"a":1}');
    const parsed = JSON.parse(result.text);
    expect(parsed.url).toBe('https://example.com');
  });

  it('converts single-quoted strings and keys to double quotes', () => {
    const result = repairJson("{'a': 'it\\'s'}");
    const parsed = JSON.parse(result.text);
    expect(parsed.a).toBe("it's");
    expect(result.actions.some((a) => a.kind === 'single-quotes')).toBe(true);
  });

  it('quotes unquoted keys', () => {
    const result = repairJson('{\n  name: "qraft",\n  count: 2\n}');
    const parsed = JSON.parse(result.text);
    expect(parsed.name).toBe('qraft');
    expect(parsed.count).toBe(2);
    expect(result.actions.some((a) => a.kind === 'unquoted-key')).toBe(true);
  });

  it('fixes Python/JS constants None/True/False/undefined to null/true/false', () => {
    const result = repairJson('{"a": None, "b": True, "c": False, "d": undefined}');
    const parsed = JSON.parse(result.text);
    expect(parsed).toEqual({ a: null, b: true, c: false, d: null });
  });

  it('fixes trailing commas before closing brackets', () => {
    const result = repairJson('{"a":[1,2,],}');
    expect(JSON.parse(result.text)).toEqual({ a: [1, 2] });
    expect(result.actions.some((a) => a.kind === 'trailing-comma')).toBe(true);
  });

  it('fixes missing commas between members', () => {
    const result = repairJson('{"a": 1 "b": 2}');
    expect(JSON.parse(result.text)).toEqual({ a: 1, b: 2 });
    expect(result.actions.some((a) => a.kind === 'missing-comma')).toBe(true);
  });

  it('fixes a missing colon after a key', () => {
    const result = repairJson('{"a" 1}');
    expect(JSON.parse(result.text)).toEqual({ a: 1 });
    expect(result.actions.some((a) => a.kind === 'missing-colon')).toBe(true);
  });

  it('appends missing closing brackets at end of input', () => {
    const result = repairJson('{"a": [1, 2');
    expect(JSON.parse(result.text)).toEqual({ a: [1, 2] });
    expect(result.actions.some((a) => a.kind === 'unclosed-brackets')).toBe(true);
  });

  it('removes unbalanced closing brackets after the root value', () => {
    const result = repairJson('{"a":1}}');
    expect(JSON.parse(result.text)).toEqual({ a: 1 });
    expect(result.actions.some((a) => a.kind === 'unbalanced-brackets')).toBe(true);
  });

  it('fixes multiple issues in one pass (fence + comments + single quotes + trailing comma)', () => {
    const source = "```json\n{\n  // 配置\n  name: 'qraft',\n  tags: ['a', 'b',],\n}\n```";
    const result = repairJson(source);
    const parsed = JSON.parse(result.text);
    expect(parsed.name).toBe('qraft');
    expect(parsed.tags).toEqual(['a', 'b']);
    expect(result.actions.length).toBeGreaterThanOrEqual(4);
  });

  it('merges NDJSON lines into a JSON array', () => {
    const source = '{"id":1}\n{"id":2}\n{"id":3}';
    const result = repairJson(source);
    const parsed = JSON.parse(result.text);
    expect(parsed).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(result.actions.some((a) => a.kind === 'ndjson')).toBe(true);
  });

  it('keeps string values with embedded newlines unrepairable rather than guessing', () => {
    // 字符串被裸换行截断:无法确定用户原意(换行还是文档结束),保守不修
    const result = repairJson('{"a": "line1\nline2"}');
    expect(result.fixed).toBe(false);
    expect(result.actions).toEqual([]);
  });

  it('leaves duplicate keys as-is rather than deleting data', () => {
    // 重复键不违反 JSON 语法(JSON.parse 静默保留后者);修复器不猜用户想删哪个,
    // 原样通过(fixed=true 无动作)
    const result = repairJson('{"a":1,"a":2}');
    expect(result.text).toBe('{"a":1,"a":2}');
    expect(result.fixed).toBe(true);
    expect(result.actions).toEqual([]);
  });

  it('gives up on ambiguous raw control characters without guessing', () => {
    // 字符串内裸 TAB:不知道用户想表达 \t 还是别的,不修,交还人工处理
    const result = repairJson('{"a": "x\ty"}');
    expect(result.fixed).toBe(false);
    expect(result.actions).toEqual([]);
  });

  it('wraps a bare top-level string value into a JSON document', () => {
    const result = repairJson('hello world');
    const parsed = JSON.parse(result.text);
    expect(parsed).toBe('hello world');
    expect(result.actions.some((a) => a.kind === 'wrap-bare')).toBe(true);
  });

  it('passes a bare top-level number through unchanged (already valid JSON)', () => {
    const result = repairJson('42');
    expect(result.text).toBe('42');
    expect(result.fixed).toBe(true);
    expect(result.actions).toEqual([]);
  });
});

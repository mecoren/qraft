import { describe, it, expect } from 'vitest';
import { locateJsonError } from './json-diagnostics';

describe('locateJsonError', () => {
  it('returns null for valid JSON', () => {
    expect(locateJsonError('{"a":1}')).toBeNull();
    expect(locateJsonError('[1, 2, 3]')).toBeNull();
    expect(locateJsonError('  "just a string"  ')).toBeNull();
    expect(locateJsonError('')).toBeNull();
  });

  it('locates a bare unquoted word inside braces at its exact line and column', () => {
    // {invalid}:invalid 是标识符(裸键),错误位置指向 i(第 1 行第 2 列)
    const result = locateJsonError('{invalid}');
    expect(result).not.toBeNull();
    expect(result!.line).toBe(1);
    expect(result!.column).toBe(2);
    expect(result!.kind).toBe('unquoted-key');
  });

  it('locates a missing comma between members on a multi-line document', () => {
    const text = '{\n  "a": 1\n  "b": 2\n}';
    // 第 3 行的 "b" 处缺逗号:错误位置应落在第 3 行第 3 列(" 开始处)
    const result = locateJsonError(text);
    expect(result).not.toBeNull();
    expect(result!.line).toBe(3);
    expect(result!.column).toBe(3);
    expect(result!.kind).toBe('missing-comma');
  });

  it('locates a missing colon after a key', () => {
    const text = '{\n  "a" 1\n}';
    const result = locateJsonError(text);
    expect(result).not.toBeNull();
    expect(result!.line).toBe(2);
    expect(result!.column).toBe(7);
    expect(result!.kind).toBe('missing-colon');
  });

  it('locates a trailing comma before the closing brace', () => {
    const text = '{\n  "a": 1,\n}';
    const result = locateJsonError(text);
    expect(result).not.toBeNull();
    expect(result!.line).toBe(3);
    expect(result!.column).toBe(1);
    expect(result!.kind).toBe('trailing-comma');
  });

  it('locates an unterminated string at the end of input', () => {
    const text = '{\n  "a: 1\n}';
    const result = locateJsonError(text);
    expect(result).not.toBeNull();
    expect(result!.line).toBe(2);
    expect(result!.kind).toBe('unterminated-string');
  });

  it('locates a single-quoted string and reports quote kind', () => {
    const result = locateJsonError("{'a': 1}");
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('single-quotes');
    expect(result!.line).toBe(1);
    expect(result!.column).toBe(2);
  });

  it('locates an unquoted key and reports it', () => {
    const text = '{\n  a: 1\n}';
    const result = locateJsonError(text);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('unquoted-key');
    expect(result!.line).toBe(2);
    expect(result!.column).toBe(3);
  });

  it('locates unbalanced closing brackets with the offending position', () => {
    // 多余的 }({"a":1}} 共 8 字符,第二个 } 在第 8 列)
    const result = locateJsonError('{"a":1}}');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('unbalanced-brackets');
    expect(result!.line).toBe(1);
    expect(result!.column).toBe(8);
  });

  it('reports unclosed brackets at end of input', () => {
    const result = locateJsonError('{"a": [1, 2');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('unclosed-brackets');
    // 位置落在文档末尾(1 行文本,列 = 长度 + 1)
    expect(result!.line).toBe(1);
    expect(result!.column).toBe(12);
  });

  it('locates a duplicated key at the second occurrence', () => {
    const text = '{\n  "a": 1,\n  "a": 2\n}';
    const result = locateJsonError(text);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('duplicate-key');
    expect(result!.line).toBe(3);
    expect(result!.column).toBe(3);
    expect(result!.detail).toBe('a');
  });

  it('escapes of unknown form fall back to a generic unexpected-token at the right offset', () => {
    // 控制字符裸露在字符串里(JSON.parse 拒绝),扫描器归为 bad-escape / 控制字符类
    const text = '{"a": "x\ty"}';
    const result = locateJsonError(text);
    expect(result).not.toBeNull();
    expect(result!.line).toBe(1);
    expect(result!.column).toBeGreaterThan(5);
  });

  it('computes line/column with 1-based indexing across CRLF documents', () => {
    const text = '{\r\n  "a": "b\r\n}';
    // 字符串内的裸 CR:应该指出位置(第 2 行内)
    const result = locateJsonError(text);
    expect(result).not.toBeNull();
    expect(result!.line).toBe(2);
  });
});

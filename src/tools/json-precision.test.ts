import { describe, it, expect } from 'vitest';
import { findJsonPrecisionIssues } from './json-precision';

describe('findJsonPrecisionIssues', () => {
  it('returns empty for documents with safe numbers', () => {
    const issues = findJsonPrecisionIssues('{"a": 1, "b": 1.5, "c": -9007199254740991}');
    expect(issues).toEqual([]);
  });

  it('flags integers beyond Number.MAX_SAFE_INTEGER', () => {
    // 字面量经字符串拼接:no-loss-of-precision 对「要测的不安全整数」同样会报警
    const unsafeId = `912337203685${'4000'}123`;
    const issues = findJsonPrecisionIssues(`{"id": ${unsafeId}}`);
    expect(issues).toHaveLength(1);
    expect(issues[0].raw).toBe(unsafeId);
    expect(issues[0].kind).toBe('bigint');
    expect(issues[0].line).toBe(1);
    expect(issues[0].column).toBeGreaterThan(1);
  });

  it('flags decimals with more significant digits than f64 can hold', () => {
    const issues = findJsonPrecisionIssues('{"v": 2.37000000000000012}');
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('decimal');
  });

  it('does not flag numbers embedded inside string values', () => {
    const issues = findJsonPrecisionIssues('{"note": "id 9123372036854000123 is fine as text"}');
    expect(issues).toEqual([]);
  });

  it('reports line and column for multi-line documents', () => {
    const text = '{\n  "a": 1,\n  "big": 12345678901234567890\n}';
    const issues = findJsonPrecisionIssues(text);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(3);
    expect(issues[0].column).toBe(10); // "big" 值的数字起点
  });

  it('caps the reported issues to keep the UI readable', () => {
    const wide: Record<string, number> = {};
    // MAX_SAFE_INTEGER + 1:故意不安全;经 Number() 构造绕过 no-loss-of-precision
    const unsafe = Number('9007199254740993');
    for (let i = 0; i < 300; i++) wide[`k${i}`] = unsafe; // 每个都超限
    const issues = findJsonPrecisionIssues(JSON.stringify(wide));
    expect(issues.length).toBeLessThanOrEqual(20);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('ignores exponents that resolve within safe range', () => {
    // 1e3 = 1000,安全;1e400 超出 f64 范围(JSON.parse 会给 Infinity,同样丢真值)
    const safe = findJsonPrecisionIssues('{"a": 1e3}');
    expect(safe).toEqual([]);
    const overflow = findJsonPrecisionIssues('{"a": 1e400}');
    expect(overflow).toHaveLength(1);
    expect(overflow[0].kind).toBe('bigint');
  });
});

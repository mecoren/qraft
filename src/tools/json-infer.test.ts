import { describe, it, expect } from 'vitest';
import { inferContent } from './json-infer';

describe('inferContent 内容类型推断', () => {
  it('识别 http/https URL', () => {
    expect(inferContent('https://example.com/a?b=1')).toEqual({
      kind: 'url',
      cssColor: null,
    });
    expect(inferContent('http://localhost:14200/x')).toEqual({ kind: 'url', cssColor: null });
  });

  it('不把裸域名或协议碎片当 URL', () => {
    expect(inferContent('example.com/path')).toBeNull();
    expect(inferContent('ftp://files.example.com')).toBeNull();
    expect(inferContent('https://')).toBeNull();
  });

  it('识别 3/4/6/8 位十六进制颜色并规范化小写', () => {
    expect(inferContent('#fff')).toEqual({ kind: 'color', cssColor: '#fff' });
    expect(inferContent('#FF8800')).toEqual({ kind: 'color', cssColor: '#ff8800' });
    expect(inferContent('#ff8800cc')).toEqual({ kind: 'color', cssColor: '#ff8800cc' });
    expect(inferContent('#ff88')).toEqual({ kind: 'color', cssColor: '#ff88' });
  });

  it('不把短十六进制串误判为颜色', () => {
    expect(inferContent('#ggg')).toBeNull();
    expect(inferContent('#12345')).toBeNull();
    expect(inferContent('#1234567')).toBeNull();
    expect(inferContent('ff8800')).toBeNull();
  });

  it('识别 ISO 8601 日期时间(可带毫秒与时区)', () => {
    expect(inferContent('2026-09-08T10:30:00Z')).toEqual({ kind: 'date', cssColor: null });
    expect(inferContent('2026-09-08T10:30:00.123+08:00')).toEqual({
      kind: 'date',
      cssColor: null,
    });
    expect(inferContent('2026-09-08T10:30')).toEqual({ kind: 'date', cssColor: null });
  });

  it('纯日期与普通时间串不推断', () => {
    expect(inferContent('2026-09-08')).toBeNull();
    expect(inferContent('10:30:00')).toBeNull();
  });

  it('非字符串与非确凿形态返回 null', () => {
    expect(inferContent(42)).toBeNull();
    expect(inferContent(null)).toBeNull();
    expect(inferContent('hello world')).toBeNull();
    expect(inferContent('  ')).toBeNull();
  });
});

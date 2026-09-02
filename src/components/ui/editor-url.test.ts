import { describe, expect, it } from 'vitest';
import { findHttpUrlAtPosition } from './editor-url';

describe('findHttpUrlAtPosition', () => {
  it('点击完整 URL 内部时返回该 URL', () => {
    const line = 'see https://example.com/path now';
    const column = line.indexOf('https://') + 5;

    expect(findHttpUrlAtPosition(line, column)).toBe('https://example.com/path');
  });

  it('URL 后跟标点时去掉结尾标点', () => {
    const line = 'https://example.com.';
    const column = line.indexOf('example.com');

    expect(findHttpUrlAtPosition(line, column)).toBe('https://example.com');
  });

  it('URL 前后有空白时按完整 URL 匹配', () => {
    const line = '  http://example.com  ';
    const column = line.indexOf('http://') + 3;

    expect(findHttpUrlAtPosition(line, column)).toBe('http://example.com');
  });

  it('不完整的 URL 不匹配', () => {
    const line = 'https://';

    expect(findHttpUrlAtPosition(line, 3)).toBeNull();
  });

  it('点击 URL 外部时不匹配', () => {
    const line = 'text https://example.com text';

    expect(findHttpUrlAtPosition(line, 2)).toBeNull();
    expect(findHttpUrlAtPosition(line, line.length - 2)).toBeNull();
  });
});

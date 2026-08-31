import { describe, expect, it } from 'vitest';
import { convertIndentation, detectIndentation, trimTrailingWhitespace } from './indentation';

describe('detectIndentation', () => {
  it('2 空格缩进 → 空格 2', () => {
    const content = ['root:', '  a: 1', '  b:', '    c: 2'].join('\n');
    expect(detectIndentation(content)).toEqual({ insertSpaces: true, tabSize: 2 });
  });

  it('4 空格缩进 → 空格 4', () => {
    const content = ['if x:', '    y = 1', '    z = 2'].join('\n');
    expect(detectIndentation(content)).toEqual({ insertSpaces: true, tabSize: 4 });
  });

  it('制表符行过半 → 制表符缩进', () => {
    const content = ['root:', '\ta: 1', '\tb: 2'].join('\n');
    expect(detectIndentation(content)).toEqual({ insertSpaces: false, tabSize: 4 });
  });

  it('无任何缩进行 → null(无法检测)', () => {
    expect(detectIndentation('hello\nworld')).toBeNull();
    expect(detectIndentation('')).toBeNull();
  });

  it('兼容 CRLF 行尾', () => {
    const content = 'root:\r\n  a: 1\r\n  b: 2';
    expect(detectIndentation(content)).toEqual({ insertSpaces: true, tabSize: 2 });
  });

  it('空行与顶格行不参与投票', () => {
    const content = ['', 'root:', '', '  a: 1', ''].join('\n');
    expect(detectIndentation(content)).toEqual({ insertSpaces: true, tabSize: 2 });
  });
});

describe('convertIndentation', () => {
  it('制表符 → 空格(宽度 4):按 tabStop 展开', () => {
    const content = 'root:\n\t{\n\t\ta: 1\n}';
    expect(convertIndentation(content, { useSpaces: true, tabSize: 4 })).toBe(
      'root:\n    {\n        a: 1\n}',
    );
  });

  it('空格 → 制表符:整除部分转 Tab,余数保留空格', () => {
    const content = 'root:\n    a\n      b\n';
    expect(convertIndentation(content, { useSpaces: false, tabSize: 4 })).toBe(
      'root:\n\ta\n\t  b\n',
    );
  });

  it('行内 Tab 不被转换(仅处理前导空白)', () => {
    const content = 'a\tb\n\tc\td';
    expect(convertIndentation(content, { useSpaces: true, tabSize: 4 })).toBe('a\tb\n    c\td');
  });

  it('CRLF 行尾原样保留', () => {
    const content = 'root:\r\n\t a';
    expect(convertIndentation(content, { useSpaces: true, tabSize: 4 })).toBe('root:\r\n     a');
  });

  it('无前导空白的行保持不变', () => {
    expect(convertIndentation('abc\ndef', { useSpaces: true, tabSize: 2 })).toBe('abc\ndef');
  });
});

describe('trimTrailingWhitespace', () => {
  it('去除每行行尾空格与制表符', () => {
    expect(trimTrailingWhitespace('a  \n\tb\t\nc')).toBe('a\n\tb\nc');
  });

  it('兼容 CRLF:换行符本身保留', () => {
    expect(trimTrailingWhitespace('a \t\r\nb ')).toBe('a\r\nb');
  });

  it('行首空白不受影响', () => {
    expect(trimTrailingWhitespace('  a')).toBe('  a');
  });
});

import { describe, it, expect } from 'vitest';

import {
  applyFindReplace,
  extractPattern,
  wordFrequency,
  EXTRACT_PRESETS,
  type ExtractPresetId,
} from './text-ops';
import {
  fullWidthToAscii,
  removeConsecutiveDuplicateLines,
  removeLinesContaining,
  addPrefixSuffix,
  numberLines,
} from './text-ops';

describe('applyFindReplace', () => {
  it('replaces all occurrences of a plain-text pattern by default', () => {
    expect(applyFindReplace('a-b-c', '-', '_', { regex: false, caseSensitive: true })).toBe(
      'a_b_c',
    );
  });

  it('supports regex with capture-group $1 templates', () => {
    // (\w+)@(\w+) → $2/$1(捕获组引用)
    const out = applyFindReplace('alice@example.com', '(\\w+)@(\\w+)', '$2/$1', {
      regex: true,
      caseSensitive: true,
    });
    expect(out).toBe('example/alice.com');
  });

  it('supports $N with global regex across multiple matches', () => {
    const out = applyFindReplace('key=value\nfoo=bar', '(\\w+)=(\\w+)', '$2=$1', {
      regex: true,
      caseSensitive: true,
    });
    expect(out).toBe('value=key\nbar=foo');
  });

  it('case-insensitive matching when caseSensitive is off', () => {
    expect(
      applyFindReplace('Hello hello HELLO', 'hello', 'hi', { regex: false, caseSensitive: false }),
    ).toBe('hi hi hi');
  });

  it('returns the text unchanged for an empty pattern', () => {
    expect(applyFindReplace('abc', '', 'x', { regex: false, caseSensitive: true })).toBe('abc');
  });

  it('escapes replacement string by default (no $-template in plain mode)', () => {
    // 纯文本模式:$ 不具备模板语义,原样替换
    expect(applyFindReplace('cost', 'cost', '$100', { regex: false, caseSensitive: true })).toBe(
      '$100',
    );
  });

  it('invalid regex throws SyntaxError with pattern info for the UI to catch', () => {
    expect(() =>
      applyFindReplace('x', '(', 'y', { regex: true, caseSensitive: true }),
    ).toThrow(SyntaxError);
  });
});

describe('extractPattern', () => {
  it('presets cover url / email / ip / date / quoted', () => {
    expect(EXTRACT_PRESETS.map((p) => p.id)).toEqual([
      'url',
      'email',
      'ip',
      'date',
      'quoted',
    ] satisfies ExtractPresetId[]);
  });

  it('extracts URLs (one per line, deduped in order of first appearance)', () => {
    const text = 'see https://a.com/x and http://b.org?y=1\nagain https://a.com/x';
    const out = extractPattern(text, 'url');
    expect(out).toBe('https://a.com/x\nhttp://b.org?y=1');
  });

  it('extracts email addresses', () => {
    expect(extractPattern('alice@ex.com bob@test.org alice@ex.com', 'email')).toBe(
      'alice@ex.com\nbob@test.org',
    );
  });

  it('extracts IPv4 addresses', () => {
    expect(extractPattern('ip 192.168.1.10 and 10.0.0.1 done', 'ip')).toBe(
      '192.168.1.10\n10.0.0.1',
    );
  });

  it('extracts ISO dates', () => {
    expect(extractPattern('at 2026-09-01 or 2026/09/02, then 2026-09-01', 'date')).toBe(
      '2026-09-01\n2026/09/02',
    );
  });

  it('extracts double-quoted text', () => {
    expect(extractPattern('say "hello" and "world" but "hello" again', 'quoted')).toBe(
      'hello\nworld',
    );
  });

  it('returns empty string when nothing matches', () => {
    expect(extractPattern('no matches here', 'url')).toBe('');
  });
});

describe('wordFrequency', () => {
  it('counts words (whitespace-delimited) sorted by count desc then first appearance', () => {
    const rows = wordFrequency('b a b a c');
    // a、b 均为 2 次;平局按首次出现(b 在输入中先于 a)
    expect(rows).toEqual([
      { value: 'b', count: 2 },
      { value: 'a', count: 2 },
      { value: 'c', count: 1 },
    ]);
  });

  it('supports a custom delimiter (split lines by comma)', () => {
    const rows = wordFrequency('x,y,x', { delimiter: ',' });
    expect(rows).toEqual([
      { value: 'x', count: 2 },
      { value: 'y', count: 1 },
    ]);
  });

  it('skips empty segments produced by consecutive delimiters', () => {
    expect(wordFrequency('a,,a', { delimiter: ',' })).toEqual([{ value: 'a', count: 2 }]);
  });

  it('returns empty for blank input', () => {
    expect(wordFrequency('   ')).toEqual([]);
  });
});

describe('行级杂项操作(P2 批次)', () => {
  it('fullWidthToAscii 转换全角数字/字母/标点为半角', () => {
    expect(fullWidthToAscii('ＡＢＣ１２３')).toBe('ABC123');
    expect(fullWidthToAscii('中文ｘｙ保留')).toBe('中文xy保留');
  });

  it('removeConsecutiveDuplicateLines 仅删相邻重复(非相邻重复保留)', () => {
    expect(removeConsecutiveDuplicateLines('a\na\nb\na\nc\nc\n')).toBe('a\nb\na\nc\n');
  });

  it('removeLinesContaining 删除包含关键字的行(保留不含关键字的行)', () => {
    expect(removeLinesContaining('keep this\nDROP me\nkeep too\ndrop it', 'drop')).toBe(
      'keep this\nkeep too',
    );
  });

  it('addPrefixSuffix 给每行加前后缀', () => {
    expect(addPrefixSuffix('a\nb', { prefix: '> ', suffix: '' })).toBe('> a\n> b');
    expect(addPrefixSuffix('a', { prefix: '[', suffix: ']' })).toBe('[a]');
  });

  it('numberLines 给每行加行号(1 起始,可选分隔符)', () => {
    expect(numberLines('a\nb\nc')).toBe('1. a\n2. b\n3. c');
    expect(numberLines('a\nb', { separator: ' ' })).toBe('1 a\n2 b');
    expect(numberLines('a\nb', { start: 10, step: 2 })).toBe('10. a\n12. b');
  });
});

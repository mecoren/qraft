import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TextStatistics } from './TextStatistics';
import { computeStats } from './text-statistics-utils';

describe('computeStats', () => {
  it('统计字符/去空白字符/词数/行数/UTF-8 字节数', () => {
    const s = computeStats('hello 世界\nfoo bar');
    expect(s.chars).toBe(16);
    expect(s.charsNoSpaces).toBe(13);
    expect(s.lines).toBe(2);
    // '世界' 每字 3 字节
    expect(s.bytes).toBe(5 + 1 + 6 + 1 + 3 + 1 + 3);
    expect(s.words).toBeGreaterThan(0);
  });

  it('空输入全零;末尾换行不计一行', () => {
    expect(computeStats('')).toEqual({ chars: 0, charsNoSpaces: 0, words: 0, lines: 0, bytes: 0 });
    expect(computeStats('a\n').lines).toBe(1);
    expect(computeStats('a\nb').lines).toBe(2);
  });
});

describe('TextStatistics', () => {
  it('输入后即时显示统计结果', () => {
    render(<TextStatistics toolId="text_statistics" metadata={null as never} />);
    const box = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(box, { target: { value: 'hello' } });
    expect(screen.getByTestId('stat-chars')).toHaveTextContent('5');
    expect(screen.getByTestId('stat-words')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-bytes')).toHaveTextContent('5');
  });

  it('清空后统计归零', () => {
    render(<TextStatistics toolId="text_statistics" metadata={null as never} />);
    const box = screen.getByTestId('input').querySelector('textarea')!;
    fireEvent.change(box, { target: { value: '' } });
    expect(screen.getByTestId('stat-chars')).toHaveTextContent('0');
  });
});

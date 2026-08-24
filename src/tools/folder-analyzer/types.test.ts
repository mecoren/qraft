import { describe, expect, it } from 'vitest';
import { humanBytes, zhCategory } from './types';

describe('humanBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2.0 KB'],
    [1536 * 1024, '1.5 MB'],
  ])('formats %d → %s', (input, expected) => {
    expect(humanBytes(input)).toBe(expected);
  });

  it('handles invalid input', () => {
    expect(humanBytes(-1)).toBe('-');
  });
});

describe('zhCategory', () => {
  it('maps known categories', () => {
    expect(zhCategory('code')).toBe('代码');
    expect(zhCategory('archive')).toBe('压缩包');
  });
});

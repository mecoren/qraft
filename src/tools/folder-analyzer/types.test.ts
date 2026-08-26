import { describe, expect, it } from 'vitest';
import { categoryLabel, humanBytes } from './types';

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

describe('categoryLabel', () => {
  it('maps known categories (zh 桩下为中文)', () => {
    expect(categoryLabel('code')).toBe('代码');
    expect(categoryLabel('archive')).toBe('压缩包');
  });

  it('falls back to raw value for unknown category', () => {
    expect(categoryLabel('mystery' as never)).toBe('mystery');
  });
});

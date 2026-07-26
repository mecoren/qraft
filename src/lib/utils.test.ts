import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn utility', () => {
  it('merges plain class strings', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1');
  });

  it('dedupes conflicting tailwind classes via tailwind-merge', () => {
    // tailwind-merge 应保留后者
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('handles conditional and falsy inputs via clsx', () => {
    // 使用变量避免 ESLint no-constant-binary-expression 误报
    const isHidden = false;
    expect(cn('base', isHidden && 'hidden', { 'text-red': true }, undefined))
      .toBe('base text-red');
  });
});

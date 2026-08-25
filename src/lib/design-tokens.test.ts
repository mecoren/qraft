import { describe, expect, it } from 'vitest';
import { deriveCustomPalette, parseHexColor, pickAccentForeground } from './design-tokens';

describe('parseHexColor', () => {
  it('解析 6 位 HEX', () => {
    expect(parseHexColor('#FF0000')).toEqual([255, 0, 0]);
    expect(parseHexColor('#4e8cff')).toEqual([78, 140, 255]);
  });
  it('解析 3 位 HEX', () => {
    expect(parseHexColor('#F00')).toEqual([255, 0, 0]);
  });
  it('非法输入返回 null', () => {
    expect(parseHexColor('red')).toBeNull();
    expect(parseHexColor('#12')).toBeNull();
    expect(parseHexColor('#GGGGGG')).toBeNull();
    expect(parseHexColor('')).toBeNull();
  });
});

describe('pickAccentForeground(按 WCAG 对比度选前景)', () => {
  it('深色 accent 选近白前景', () => {
    expect(pickAccentForeground('#111111')).toBe('oklch(0.99 0 0)');
  });
  it('极浅 accent 选近黑前景(修复白字浅底不可读)', () => {
    expect(pickAccentForeground('#FFFF00')).toBe('oklch(0.15 0 0)');
    expect(pickAccentForeground('#FFFFFF')).toBe('oklch(0.15 0 0)');
  });
  it('中等亮度 accent 维持近白前景(保持现有视觉习惯)', () => {
    expect(pickAccentForeground('#4E8CFF')).toBe('oklch(0.99 0 0)');
  });
  it('非法输入回退近白前景(与旧行为一致)', () => {
    expect(pickAccentForeground('oops')).toBe('oklch(0.99 0 0)');
  });
});

describe('deriveCustomPalette 对比度防护', () => {
  it('深色 accent 时前景为近白', () => {
    const p = deriveCustomPalette('#1A237E');
    expect(p.primaryForeground).toBe('oklch(0.99 0 0)');
    expect(p.sidebarPrimaryForeground).toBe('oklch(0.99 0 0)');
  });
  it('浅色 accent 时前景切换为近黑', () => {
    const p = deriveCustomPalette('#FFFF00');
    expect(p.primaryForeground).toBe('oklch(0.15 0 0)');
    expect(p.sidebarPrimaryForeground).toBe('oklch(0.15 0 0)');
  });
});

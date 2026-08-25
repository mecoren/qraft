import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('globals.css 主题系统(Tailwind v4 + OKLCH + data-palette)', () => {
  it('使用 Tailwind v4 入口与 dark 自定义变体', () => {
    const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf-8');
    expect(css).toContain("@import 'tailwindcss'");
    expect(css).toContain('@custom-variant dark (&:is(.dark *))');
  });

  it('默认 :root 提供亮色基底(OKLCH)', () => {
    const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf-8');
    expect(css).toContain(':root');
    // 使用 OKLCH 而非 HSL
    expect(css).toMatch(/--background:\s*oklch\(/);
    expect(css).toMatch(/--foreground:\s*oklch\(/);
  });

  it('定义 5 套预设主题 + 自定义主题的 data-palette 选择器', () => {
    const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf-8');
    expect(css).toContain("[data-palette='obsidian']");
    expect(css).toContain("[data-palette='deep-sea']");
    expect(css).toContain("[data-palette='twilight']");
    expect(css).toContain("[data-palette='emerald-night']");
    expect(css).toContain("[data-palette='daylight']");
    expect(css).toContain("[data-palette='custom']");
  });

  it('使用 @theme inline 映射 CSS 变量到 Tailwind utility', () => {
    const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf-8');
    expect(css).toContain('@theme inline');
    expect(css).toMatch(/--color-background:\s*var\(--background\)/);
    expect(css).toMatch(/--color-sidebar:\s*var\(--sidebar\)/);
    expect(css).toMatch(/--color-primary:\s*var\(--primary\)/);
  });

  it('深色主题启用 color-scheme: dark', () => {
    const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf-8');
    expect(css).toMatch(/color-scheme:\s*dark/);
    expect(css).toMatch(/color-scheme:\s*light/);
  });

  it('提供圆角令牌与字体回退', () => {
    const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf-8');
    expect(css).toMatch(/--radius:\s*0\.5rem/);
    expect(css).toMatch(/--app-font-family/);
  });

  it('尊重系统减少动态效果偏好(prefers-reduced-motion)', () => {
    const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf-8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

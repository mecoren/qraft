import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Logo } from './Logo';

describe('Logo', () => {
  it('renders an SVG with the brand viewBox', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('viewBox', '0 0 614.4 614.4');
  });

  it('is decorative via aria-hidden', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('maps brand colors to theme tokens for dark-mode inversion', () => {
    const { container } = render(<Logo />);
    // 底色瓦片使用 --logo-bg
    expect(container.querySelector('svg rect[fill="var(--logo-bg)"]')).not.toBeNull();
    // 图形元素全部使用 --logo-fg(外框描边 + 5 path + 3 circle)
    expect(container.querySelectorAll('svg [stroke="var(--logo-fg)"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('svg [fill="var(--logo-fg)"]').length).toBeGreaterThan(0);
  });

  it('renders the full window-plus-code mark', () => {
    const { container } = render(<Logo />);
    // 底色瓦片 + 窗口外框
    expect(container.querySelectorAll('svg rect')).toHaveLength(2);
    // 标题栏 + 左侧标签 + `<` / `>` / `/`
    expect(container.querySelectorAll('svg path')).toHaveLength(5);
    // 三个窗口控制圆点
    expect(container.querySelectorAll('svg circle')).toHaveLength(3);
  });

  it('passes className through to the svg element', () => {
    const { container } = render(<Logo className="size-4 text-primary" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('size-4');
    expect(svg).toHaveClass('text-primary');
  });
});

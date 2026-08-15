import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Logo } from './Logo';

describe('Logo', () => {
  it('renders an SVG with the brand viewBox and currentColor stroke', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('viewBox', '0 0 120 120');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
  });

  it('is decorative via aria-hidden', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders an outlined window frame and three code-symbol strokes', () => {
    const { container } = render(<Logo />);
    expect(container.querySelectorAll('svg rect')).toHaveLength(1);
    expect(container.querySelectorAll('svg path')).toHaveLength(3);
  });

  it('passes className through to the svg element', () => {
    const { container } = render(<Logo className="size-4 text-primary" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('size-4');
    expect(svg).toHaveClass('text-primary');
  });
});
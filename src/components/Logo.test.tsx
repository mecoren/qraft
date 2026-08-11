import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Logo } from './Logo';

describe('Logo', () => {
  it('renders an SVG with the toolbox viewBox and currentColor fill', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('viewBox', '0 0 220 166');
    expect(svg).toHaveAttribute('fill', 'currentColor');
  });

  it('is decorative via aria-hidden', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders two toolbox paths (body + keyhole)', () => {
    const { container } = render(<Logo />);
    const paths = container.querySelectorAll('svg path');
    expect(paths).toHaveLength(2);
  });

  it('passes className through to the svg element', () => {
    const { container } = render(<Logo className="size-4 text-primary" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('size-4');
    expect(svg).toHaveClass('text-primary');
  });
});

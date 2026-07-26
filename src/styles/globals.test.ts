import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('globals.css design tokens', () => {
  it('contains :root with light tokens', () => {
    const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf-8');
    expect(css).toContain(':root');
    expect(css).toMatch(/--background:\s*0 0% 100%/);
    expect(css).toMatch(/--foreground:\s*222\.2 84% 4\.9%/);
  });

  it('contains .dark with dark tokens', () => {
    const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf-8');
    expect(css).toContain('.dark');
    expect(css).toMatch(/--background:\s*222\.2 84% 4\.9%/);
    expect(css).toMatch(/--foreground:\s*210 40% 98%/);
  });

  it('defines radius and font tokens', () => {
    const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf-8');
    expect(css).toMatch(/--radius:\s*0\.5rem/);
    expect(css).toMatch(/--font-sans:/);
    expect(css).toMatch(/--font-mono:/);
  });
});

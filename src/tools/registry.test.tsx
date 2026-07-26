import { describe, it, expect, beforeEach } from 'vitest';
import { getToolComponent, registerTool, clearRegistry } from './registry';

describe('ToolRegistry (UI)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('returns null for unknown tool id', () => {
    expect(getToolComponent('unknown')).toBeNull();
  });

  it('returns registered component by tool id', () => {
    const Stub = () => <div>stub</div>;
    registerTool('stub', Stub);
    const Comp = getToolComponent('stub');
    expect(Comp).toBe(Stub);
  });

  it('registerTool overwrites previous registration silently', () => {
    const A = () => <div>a</div>;
    const B = () => <div>b</div>;
    registerTool('over', A);
    registerTool('over', B);
    expect(getToolComponent('over')).toBe(B);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { getToolComponent, registerTool, clearRegistry } from './registry';
import type { ToolMetadata } from '@/types/tool';

// lazy 组件契约要求注入 ToolProps,测试中用空元数据即可
const STUB_METADATA = {} as ToolMetadata;

describe('ToolRegistry (UI)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('returns null for unknown tool id', () => {
    expect(getToolComponent('unknown')).toBeNull();
  });

  it('returns a lazily loaded component by tool id', async () => {
    const Stub = () => <div>stub</div>;
    registerTool('stub', async () => ({ default: Stub }));
    const Comp = getToolComponent('stub');
    expect(Comp).not.toBeNull();
    if (!Comp) throw new Error('expected component');
    render(
      <Suspense fallback={<div>loading</div>}>
        <Comp toolId="stub" metadata={STUB_METADATA} />
      </Suspense>,
    );
    expect(await screen.findByText('stub')).toBeTruthy();
  });

  it('registerTool overwrites previous registration silently', async () => {
    const A = () => <div>a</div>;
    const B = () => <div>b</div>;
    registerTool('over', async () => ({ default: A }));
    registerTool('over', async () => ({ default: B }));
    const Comp = getToolComponent('over');
    expect(Comp).not.toBeNull();
    if (!Comp) throw new Error('expected component');
    render(
      <Suspense fallback={<div>loading</div>}>
        <Comp toolId="over" metadata={STUB_METADATA} />
      </Suspense>,
    );
    expect(await screen.findByText('b')).toBeTruthy();
  });
});

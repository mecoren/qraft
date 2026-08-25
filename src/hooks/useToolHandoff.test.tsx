import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { useToolHandoff } from './useToolHandoff';
import { requestHandoff, useHandoffStore } from '@/store/handoffStore';
import { useToolStateStore } from '@/store/toolStateStore';

function Harness({ toolId, onApply }: { toolId: string; onApply: (t: string) => void }) {
  useToolHandoff(toolId, onApply);
  return null;
}

describe('useToolHandoff', () => {
  beforeEach(() => {
    useHandoffStore.setState({ pending: null });
    useToolStateStore.setState({ currentToolId: null });
  });

  it('非激活工具不消费载荷;成为激活工具时立即消费并回调', () => {
    const onApply = vi.fn();
    requestHandoff('demo_tool', 'payload-text');
    // 未激活:渲染也不消费
    const { rerender } = render(<Harness toolId="demo_tool" onApply={onApply} />);
    expect(onApply).not.toHaveBeenCalled();
    expect(useHandoffStore.getState().pending).not.toBeNull();
    // 激活后消费
    useToolStateStore.setState({ currentToolId: 'demo_tool' });
    rerender(<Harness toolId="demo_tool" onApply={onApply} />);
    expect(onApply).toHaveBeenCalledWith('payload-text');
    expect(useHandoffStore.getState().pending).toBeNull();
    // 单次消费:再次渲染不再触发
    rerender(<Harness toolId="demo_tool" onApply={onApply} />);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('挂载前已有载荷且即为激活工具时,挂载即消费', () => {
    useToolStateStore.setState({ currentToolId: 'demo_tool' });
    requestHandoff('demo_tool', 'early');
    const onApply = vi.fn();
    render(<Harness toolId="demo_tool" onApply={onApply} />);
    expect(onApply).toHaveBeenCalledWith('early');
  });

  it('发往其他工具的载荷不会被本工具误收', () => {
    useToolStateStore.setState({ currentToolId: 'demo_tool' });
    requestHandoff('other_tool', 'not-mine');
    const onApply = vi.fn();
    render(<Harness toolId="demo_tool" onApply={onApply} />);
    expect(onApply).not.toHaveBeenCalled();
    expect(useHandoffStore.getState().pending?.toolId).toBe('other_tool');
  });
});

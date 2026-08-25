import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { useToolShortcutActions } from './useToolShortcutActions';
import { executeToolAction, resetToolActions } from '@/lib/tool-actions';
import { useToolStateStore } from '@/store/toolStateStore';

function Harness({ toolId, onExecute }: { toolId: string; onExecute: () => void }) {
  useToolShortcutActions(toolId, { execute: onExecute });
  return null;
}

describe('useToolShortcutActions', () => {
  beforeEach(() => {
    resetToolActions();
    useToolStateStore.setState({ currentToolId: 'demo_tool' });
  });

  it('挂载后注册生效、卸载后注销', () => {
    const onExecute = vi.fn();
    const { unmount } = render(<Harness toolId="demo_tool" onExecute={onExecute} />);
    executeToolAction();
    expect(onExecute).toHaveBeenCalledTimes(1);
    unmount();
    // 卸载后走「不支持」降级路径,不应再命中旧回调
    executeToolAction();
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it('重渲染后始终执行最新闭包(latest-ref)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness toolId="demo_tool" onExecute={first} />);
    rerender(<Harness toolId="demo_tool" onExecute={second} />);
    executeToolAction();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

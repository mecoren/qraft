import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from 'sonner';
import {
  clearInputAction,
  copyOutputAction,
  executeToolAction,
  resetToolActions,
  setToolActions,
} from './tool-actions';
import { useToolStateStore } from '@/store/toolStateStore';

function setActiveTool(id: string | null): void {
  useToolStateStore.setState({ currentToolId: id });
}

describe('tool-actions 注册表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetToolActions();
    setActiveTool('json_formatter');
  });

  it('激活工具已注册动作时直接执行', () => {
    const exec = vi.fn();
    setToolActions('json_formatter', { execute: exec });
    executeToolAction();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('未提供对应动作时降级为提示且不抛错', () => {
    setToolActions('json_formatter', {});
    executeToolAction();
    expect(toast.info).toHaveBeenCalledWith('当前工具不支持快捷键执行');
    copyOutputAction();
    expect(toast.info).toHaveBeenCalledWith('当前工具暂无可复制的输出');
  });

  it('只响应 currentToolId 对应的注册项(keepalive 多实例并存)', () => {
    const a = vi.fn();
    const b = vi.fn();
    setToolActions('json_formatter', { execute: a });
    setToolActions('hash_calculator', { execute: b });
    setActiveTool('hash_calculator');
    executeToolAction();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('currentToolId 为 null 时安全降级为提示', () => {
    setActiveTool(null);
    expect(() => clearInputAction()).not.toThrow();
    expect(toast.info).toHaveBeenCalled();
  });

  it('注销(null)后不再可用', () => {
    const fn = vi.fn();
    setToolActions('json_formatter', { execute: fn });
    setToolActions('json_formatter', null);
    executeToolAction();
    expect(fn).not.toHaveBeenCalled();
  });
});

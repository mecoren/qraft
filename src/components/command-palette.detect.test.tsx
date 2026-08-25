import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { CommandPalette } from './CommandPalette';
import { useUiStore } from '@/store/uiStore';
import { useToolStateStore } from '@/store/toolStateStore';

describe('CommandPalette Smart Detection 推荐组', () => {
  beforeEach(() => {
    useUiStore.setState({
      detectedTools: [{ toolId: 'jwt_parser', reason: 'JWT 结构' }],
      smartDetectionEnabled: true,
    });
    useToolStateStore.setState({ currentToolId: 'text_editor' });
  });

  it('无探测结果时不渲染推荐组', () => {
    useUiStore.setState({ detectedTools: [] });
    render(<CommandPalette open onOpenChange={vi.fn()} />);
    expect(screen.queryByText('检测到剪贴板内容')).not.toBeInTheDocument();
  });

  it('有探测结果时展示推荐组(工具名 + 命中原因)', () => {
    render(<CommandPalette open onOpenChange={vi.fn()} />);
    expect(screen.getByText('检测到剪贴板内容')).toBeInTheDocument();
    // 同名条目同时存在于「工具」全量分组,故用 getAllByText
    expect(screen.getAllByText('JWT编码器/解码器').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('JWT 结构')).toBeInTheDocument();
  });

  it('选中推荐项后切换当前工具并关闭面板', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette open onOpenChange={onOpenChange} />);
    await user.click(screen.getByText('JWT 结构'));
    expect(useToolStateStore.getState().currentToolId).toBe('jwt_parser');
    expect(useUiStore.getState().recents[0]).toBe('jwt_parser');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { SendToMenu } from './send-to-menu';
import { useHandoffStore } from '@/store/handoffStore';

describe('SendToMenu', () => {
  beforeEach(() => {
    useHandoffStore.setState({ pending: null });
  });

  it('点击展开目标列表,排除当前工具自身', async () => {
    const user = userEvent.setup();
    render(<SendToMenu text="abc" currentToolId="json_formatter" testId="send-json" />);
    await user.click(screen.getByTestId('send-json'));
    // 目标展示名取自 tool-catalog(LocalizedText 随语言走)
    expect(
      await screen.findByRole('menuitem', { name: /哈希 \/ 校验和生成器/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /JSON 格式化器/ })).not.toBeInTheDocument();
  });

  it('目标清单含文本处理与文本比较两个文本类工具', async () => {
    const user = userEvent.setup();
    render(<SendToMenu text="abc" currentToolId="json_formatter" testId="send-json" />);
    await user.click(screen.getByTestId('send-json'));
    expect(await screen.findByRole('menuitem', { name: /文本处理工具/ })).toBeInTheDocument();
    // 文本比较是双栏目标,占修改前/修改后两项
    expect(screen.getAllByRole('menuitem', { name: /文本比较工具/ })).toHaveLength(2);
  });

  it('选择目标后写入对应载荷', async () => {
    const user = userEvent.setup();
    render(<SendToMenu text="abc" currentToolId="json_formatter" testId="send-json" />);
    await user.click(screen.getByTestId('send-json'));
    await user.click(await screen.findByRole('menuitem', { name: /哈希 \/ 校验和生成器/ }));
    await waitFor(() => {
      expect(useHandoffStore.getState().pending).toEqual({
        toolId: 'hash_calculator',
        text: 'abc',
      });
    });
  });

  it('文本比较列出修改前/修改后两项,分别写入对应侧', async () => {
    const user = userEvent.setup();
    render(<SendToMenu text="abc" currentToolId="json_formatter" testId="send-json" />);
    await user.click(screen.getByTestId('send-json'));
    await user.click(await screen.findByRole('menuitem', { name: /文本比较工具.*修改前/ }));
    await waitFor(() => {
      expect(useHandoffStore.getState().pending).toEqual({
        toolId: 'text_compare',
        text: 'abc',
        side: 'original',
      });
    });

    useHandoffStore.setState({ pending: null });
    await user.click(screen.getByTestId('send-json'));
    await user.click(await screen.findByRole('menuitem', { name: /文本比较工具.*修改后/ }));
    await waitFor(() => {
      expect(useHandoffStore.getState().pending).toEqual({
        toolId: 'text_compare',
        text: 'abc',
        side: 'modified',
      });
    });
  });
  it('text 为空时不渲染触发按钮', () => {
    render(<SendToMenu text="" currentToolId="json_formatter" testId="send-empty" />);
    expect(screen.queryByTestId('send-empty')).not.toBeInTheDocument();
  });
});

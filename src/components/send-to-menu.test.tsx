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

  it('text 为空时不渲染触发按钮', () => {
    render(<SendToMenu text="" currentToolId="json_formatter" testId="send-empty" />);
    expect(screen.queryByTestId('send-empty')).not.toBeInTheDocument();
  });
});

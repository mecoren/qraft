import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { PopoutApp } from './PopoutApp';
import { DEFAULT_USER_CONFIG } from '@/types/config';
import type { CommandResponse } from '@/types/ipc';
import type { UserConfig } from '@/types/config';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  // 满足 PopoutApp 启动期的 config_get_all / tool_list IPC
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'config_get_all') {
      return Promise.resolve({
        success: true,
        data: { ...DEFAULT_USER_CONFIG },
      } as CommandResponse<UserConfig>);
    }
    return Promise.resolve({ success: true, data: [] });
  });
});

describe('PopoutApp 弹窗根组件', () => {
  it('非法 toolId 渲染「未找到工具」提示,不渲染标题栏', async () => {
    render(<PopoutApp toolId="not_exist_tool" />);
    // 启动期 loadConfig/loadTools 为异步,flush 后再断言,避免卸载后 act 警告
    await act(async () => {});
    expect(screen.getByText('未找到工具')).toBeInTheDocument();
    expect(screen.queryByTestId('popout-titlebar')).not.toBeInTheDocument();
  });

  it('特殊页面 toolId 同样渲染未找到提示', async () => {
    render(<PopoutApp toolId="settings" />);
    await act(async () => {});
    expect(screen.getByText('未找到工具')).toBeInTheDocument();
  });

  it('合法 toolId 渲染最小标题栏(工具名)与工具工作区', async () => {
    render(<PopoutApp toolId="base64_codec" />);
    // 标题栏展示工具名(目录中文名)
    expect(screen.getByTestId('popout-titlebar')).toBeInTheDocument();
    expect(screen.getByTestId('popout-tool-name')).toHaveTextContent(/Base64/i);
    // 懒加载工具组件最终挂载(Suspense 结束)
    await waitFor(
      () => {
        expect(screen.queryByText('加载工具中…')).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { UpdateCheckButton, UpdateResultCard } from './UpdateSection';
import { useUpdateCheck } from '@/hooks/useUpdateCheck';
import type { JSX } from 'react';

// 与 AboutDialog InfoSection 相同的组合方式:状态提升到宿主,按钮与结果卡分发渲染
function UpdateFixture(): JSX.Element {
  const state = useUpdateCheck();
  return (
    <>
      <UpdateCheckButton state={state} />
      <UpdateResultCard state={state} />
    </>
  );
}

// mock sonner:断言 toast 文案(全局 setup 已在 afterEach 清理 mock 调用记录)
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { toast } from 'sonner';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
const toastErrorMock = vi.mocked(toast.error);

beforeEach(() => {
  invokeMock.mockReset();
});

describe('UpdateSection 检查更新错误提示', () => {
  it('检查更新失败时展示后端真实错误信息(而非 "[object Object]")', async () => {
    // Tauri 命令 Err(AppError) 时以序列化错误对象 reject({ kind, detail }),
    // 不得直接 String() 插值
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'app_check_update') {
        return Promise.reject({
          kind: 'ERR_NETWORK',
          detail: 'GitHub Releases 请求超时',
        });
      }
      return Promise.resolve({ success: true, data: true });
    });

    const user = userEvent.setup();
    render(<UpdateFixture />);
    await user.click(screen.getByRole('button', { name: '检查更新' }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    expect(toastErrorMock).toHaveBeenCalledWith('检查更新失败:GitHub Releases 请求超时');
  });

  it('安装失败包含 MANUAL_INSTALL_REQUIRED 哨兵时跳转下载页而非报错', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'app_check_update') {
        return Promise.resolve({
          available: true,
          version: '9.9.9',
          currentVersion: '0.1.0',
          notes: null,
          date: null,
          packageType: 'portable',
          installMode: 'in-place',
          installModeLabel: null,
        });
      }
      if (cmd === 'app_install_update') {
        return Promise.reject({
          kind: 'ERR_INTERNAL',
          detail: 'MANUAL_INSTALL_REQUIRED: msi',
        });
      }
      return Promise.resolve({ success: true, data: true });
    });

    const user = userEvent.setup();
    render(<UpdateFixture />);
    // 检查更新成功 → 出现「立即更新」按钮(in-place 安装方式)
    await user.click(screen.getByRole('button', { name: '检查更新' }));
    const installBtn = await screen.findByRole('button', { name: '立即更新' });
    await user.click(installBtn);

    // 哨兵命中:打开 Releases 页兜底,不弹「安装更新失败」
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('app_open_release_page'));
    expect(toastErrorMock).not.toHaveBeenCalledWith(expect.stringContaining('安装更新失败'));
  });

  it('NSIS 安装版走自动更新而非手动跳转(显示「立即更新」)', async () => {
    // windows-nsis 由 tauri-plugin-updater 原生支持静默安装,
    // 不应被误判为手动安装模式(显示「前往 GitHub 下载整包」)
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'app_check_update') {
        return Promise.resolve({
          available: true,
          version: '9.9.9',
          currentVersion: '0.2.2',
          notes: null,
          date: null,
          packageType: 'nsis',
          installMode: 'windows-nsis',
          installModeLabel: '安装版(NSIS)',
        });
      }
      return Promise.resolve({ success: true, data: true });
    });

    const user = userEvent.setup();
    render(<UpdateFixture />);
    await user.click(screen.getByRole('button', { name: '检查更新' }));

    // NSIS 安装版 → 主按钮为「立即更新」而非「前往 GitHub 下载整包」
    await screen.findByRole('button', { name: '立即更新' });
    expect(screen.queryByRole('button', { name: '前往 GitHub 下载整包' })).toBeNull();
    // 点击后调用自动安装命令,而非打开 Releases 页
    await user.click(screen.getByRole('button', { name: '立即更新' }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('app_install_update', {
        installMode: 'windows-nsis',
      }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith('app_open_release_page');
  });
});

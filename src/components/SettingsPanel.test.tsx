import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { SettingsPanel } from './SettingsPanel';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';
import { changeLocale } from '@/i18n';

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
  useConfigStore.setState({ config: { ...DEFAULT_USER_CONFIG }, loading: false, error: null });
});

describe('SettingsPanel', () => {
  it('renders theme section and form fields from current config', () => {
    render(<SettingsPanel />);
    expect(screen.getByText(/^主题$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/最大历史数/)).toBeInTheDocument();
    expect(screen.getByLabelText(/打开命令面板/)).toBeInTheDocument();
  });

  it('en-US:分区/字段/快捷键标签随语言切换(手动切语言场景),结束恢复 zh 桩', () => {
    changeLocale('en-US');
    // 先卸载再切回 zh 桩,避免异步 languageChanged 在 act 环境外触发告警更新
    const { unmount } = render(<SettingsPanel />);
    try {
      expect(screen.getByText(/^Settings$/)).toBeInTheDocument();
      expect(screen.getByText(/^Theme$/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Max history entries/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Open command palette/)).toBeInTheDocument();
    } finally {
      unmount();
      changeLocale('zh-CN');
    }
  });

  it('renders without crashing when config lacks toolPrefs (legacy persisted config)', () => {
    // 模拟旧版本持久化配置缺少 toolPrefs 字段的场景,回归此前
    // "Cannot read properties of undefined (reading 'json_formatter')" 崩溃
    useConfigStore.setState({
      config: {
        version: 1,
        general: { ...DEFAULT_USER_CONFIG.general },
        theme: { ...DEFAULT_USER_CONFIG.theme },
        shortcuts: { ...DEFAULT_USER_CONFIG.shortcuts },
        favorites: [],
        // 故意不提供 toolPrefs,构造缺失字段的旧配置
      } as unknown as typeof DEFAULT_USER_CONFIG,
      loading: false,
      error: null,
    });
    render(<SettingsPanel />);
    expect(screen.getByText(/^主题$/)).toBeInTheDocument();
    // JSON 缩进应安全回退为默认值 2
    expect((screen.getByLabelText(/JSON 默认缩进/) as HTMLInputElement).value).toBe('2');
  });

  it('shows validation error when max history is negative', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);
    const input = screen.getByLabelText(/最大历史数/) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '-5');
    await screen.findByText(/必须为 0 或正整数/);
  });

  it('clicking save calls setConfig with changed values', async () => {
    const user = userEvent.setup();
    // list_system_fonts 返回 [],其他 invoke 返回 { success: true, data: true }
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'list_system_fonts'
        ? Promise.resolve([])
        : Promise.resolve({ success: true, data: true }),
    );
    render(<SettingsPanel />);
    const input = screen.getByLabelText(/最大历史数/) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '50');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(invokeMock).toHaveBeenCalledWith(
      'config_set',
      expect.objectContaining({
        key: 'general.max_history',
        value: 50,
      }),
    );
  });

  it('does not call setConfig when form invalid', async () => {
    const user = userEvent.setup();
    // list_system_fonts 返回 [],其他 invoke 返回 { success: true, data: true }
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'list_system_fonts'
        ? Promise.resolve([])
        : Promise.resolve({ success: true, data: true }),
    );
    render(<SettingsPanel />);
    const input = screen.getByLabelText(/最大历史数/) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '-1');
    await user.click(screen.getByRole('button', { name: '保存' }));
    // 表单无效时不应调用 config_set(但 list_system_fonts 会被调用)
    const configSetCalls = invokeMock.mock.calls.filter((c) => c[0] === 'config_set');
    expect(configSetCalls).toHaveLength(0);
  });
});

describe('UpdateSection 检查更新错误提示', () => {
  it('检查更新失败时展示后端真实错误信息(而非 "[object Object]")', async () => {
    // Tauri 命令 Err(AppError) 时以序列化错误对象 reject({ kind, detail }),
    // 不得直接 String() 插值;按命令名定向 mock,避免被挂载期
    // list_system_fonts 等调用误消费
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'app_check_update') {
        return Promise.reject({
          kind: 'ERR_NETWORK',
          detail: 'GitHub Releases 请求超时',
        });
      }
      if (cmd === 'list_system_fonts') return Promise.resolve([]);
      return Promise.resolve({ success: true, data: true });
    });

    const user = userEvent.setup();
    render(<SettingsPanel />);
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
    render(<SettingsPanel />);
    // 检查更新成功 → 出现「立即更新」按钮(in-place 安装方式)
    await user.click(screen.getByRole('button', { name: '检查更新' }));
    const installBtn = await screen.findByRole('button', { name: '立即更新' });
    await user.click(installBtn);

    // 哨兵命中:打开 Releases 页兜底,不弹「安装更新失败」
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('app_open_release_page'));
    expect(toastErrorMock).not.toHaveBeenCalledWith(expect.stringContaining('安装更新失败'));
  });
});

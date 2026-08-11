import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { SettingsPanel } from './SettingsPanel';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

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

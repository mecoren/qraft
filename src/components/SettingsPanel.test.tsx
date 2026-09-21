import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import {
  JsonFormatterSection,
  SettingsPanel,
  ToolsSection,
  type ToolsTabId,
} from './SettingsPanel';
import { useConfigStore } from '@/store/configStore';
import { DEFAULT_USER_CONFIG } from '@/types/config';
import { changeLocale } from '@/i18n';

/** Radix Tabs 在 onMouseDown 时激活(不是 click),故断言统一用 mouseDown 切页 */
const switchToJsonTab = () => fireEvent.mouseDown(screen.getByTestId('tool-tab-json_formatter'));

/** ToolsSection 受控标签页的测试宿主(整页/弹窗外部持有状态) */
function ToolsHarness() {
  const [tab, setTab] = useState<ToolsTabId>('editor');
  return <ToolsSection activeTab={tab} onActiveTabChange={setTab} />;
}

// mock sonner:组件保存路径会弹 toast,避免真实渲染 toast 容器
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

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

  it('renders without crashing when config lacks tool_prefs (legacy persisted config)', () => {
    // 模拟旧版本持久化配置缺少 tool_prefs 字段的场景,回归此前
    // "Cannot read properties of undefined (reading 'json_formatter')" 崩溃
    useConfigStore.setState({
      config: {
        version: 1,
        general: { ...DEFAULT_USER_CONFIG.general },
        theme: { ...DEFAULT_USER_CONFIG.theme },
        shortcuts: { ...DEFAULT_USER_CONFIG.shortcuts },
        favorites: [],
        // 故意不提供 tool_prefs,构造缺失字段的旧配置
      } as unknown as typeof DEFAULT_USER_CONFIG,
      loading: false,
      error: null,
    });
    render(<SettingsPanel />);
    expect(screen.getByText(/^主题$/)).toBeInTheDocument();
    // JSON 缩进在「工具设置 → JSON 格式化器」标签页内,缺 tool_prefs 时应安全回退为默认值 2
    switchToJsonTab();
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
    // JSON 缩进已迁入「工具设置」菜单的独立表单,通用表单不再触碰该偏好槽
    expect(invokeMock).not.toHaveBeenCalledWith(
      'config_set',
      expect.objectContaining({ key: 'tool_prefs.json_formatter' }),
    );
  });

  it('保存缩进时保留同一 tool_prefs 槽内的其它偏好', async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'list_system_fonts'
        ? Promise.resolve([])
        : Promise.resolve({ success: true, data: true }),
    );
    // 整槽覆盖语义:提交前必须把已有的 layout 与 values 兄弟键并进载荷
    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        tool_prefs: {
          json_formatter: { layout: 'split', values: { indent: 4, sort_keys: true } },
        },
      },
      loading: false,
      error: null,
    });
    render(<JsonFormatterSection />);
    const input = screen.getByLabelText(/JSON 默认缩进/) as HTMLInputElement;
    // 表单从 tool_prefs 槽回填出 4(旧 number 形状读侧兼容),改成 2 后保存
    expect(input.value).toBe('4');
    await user.clear(input);
    await user.type(input, '2');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(invokeMock).toHaveBeenCalledWith(
      'config_set',
      expect.objectContaining({
        key: 'tool_prefs.json_formatter',
        value: {
          layout: 'split',
          values: { indent: { useTabs: false, size: 2 }, sort_keys: true },
        },
      }),
    );
  });

  it('JSON Tab 开关:打开后保存为 useTabs:true(同槽整写,兄弟键保留)', async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'list_system_fonts'
        ? Promise.resolve([])
        : Promise.resolve({ success: true, data: true }),
    );
    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        tool_prefs: {
          json_formatter: { layout: 'split', values: { indent: 4, sort_keys: true } },
        },
      },
      loading: false,
      error: null,
    });
    render(<JsonFormatterSection />);
    const useTabsSwitch = screen.getByRole('switch', { name: /JSON 使用 Tab 缩进/ });
    expect(useTabsSwitch).not.toBeChecked();
    await user.click(useTabsSwitch);
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(invokeMock).toHaveBeenCalledWith(
      'config_set',
      expect.objectContaining({
        key: 'tool_prefs.json_formatter',
        value: {
          layout: 'split',
          values: { indent: { useTabs: true, size: 4 }, sort_keys: true },
        },
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

  it('编辑器展示区:渲染默认开关值,切换即 config_set editor.display 路径', async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'list_system_fonts'
        ? Promise.resolve([])
        : Promise.resolve({ success: true, data: true }),
    );
    render(<SettingsPanel />);
    // 默认值(无 display 配置)下开关全开
    const minimapSwitch = screen.getByRole('switch', { name: /缩略图/ });
    expect(minimapSwitch).toBeChecked();
    expect(screen.getByRole('switch', { name: /括号配对着色/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: /自动换行/ })).toBeChecked();
    // 字号档位展示默认 13px
    expect(screen.getByText('13 px')).toBeInTheDocument();
    // 切换缩略图开关 → 持久化 editor.display.minimap=false
    await user.click(minimapSwitch);
    expect(invokeMock).toHaveBeenCalledWith(
      'config_set',
      expect.objectContaining({ key: 'editor.display.minimap', value: false }),
    );
  });

  it('编辑器展示区:持久化值渲染为关(旧配置无 display 也不回退错乱)', () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'list_system_fonts'
        ? Promise.resolve([])
        : Promise.resolve({ success: true, data: true }),
    );
    useConfigStore.setState({
      config: {
        ...DEFAULT_USER_CONFIG,
        editor: {
          ...DEFAULT_USER_CONFIG.editor,
          display: { ...DEFAULT_USER_CONFIG.editor?.display, minimap: false, fontSize: 16 },
        },
      },
      loading: false,
      error: null,
    });
    render(<SettingsPanel />);
    expect(screen.getByRole('switch', { name: /缩略图/ })).not.toBeChecked();
    expect(screen.getByText('16 px')).toBeInTheDocument();
    // 其余未写字段仍为默认开
    expect(screen.getByRole('switch', { name: /吸顶滚动/ })).toBeChecked();
  });

  it('工具设置标签页:默认文本编辑器,与 JSON 格式化器互斥切换', () => {
    render(<ToolsHarness />);
    expect(screen.getByLabelText(/编辑器字号/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/JSON 默认缩进/)).not.toBeInTheDocument();

    switchToJsonTab();
    expect(screen.getByLabelText(/JSON 默认缩进/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/编辑器字号/)).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('tool-tab-editor'));
    expect(screen.getByLabelText(/编辑器字号/)).toBeInTheDocument();
  });

  it('文本编辑器标签页:编辑器展示与命名风格是两张独立卡片', () => {
    render(<ToolsHarness />);
    // 命名风格独立成卡(标题 + 说明),不再混在编辑器展示卡里
    expect(screen.getByText('命名风格')).toBeInTheDocument();
    expect(screen.getByText('选中文本的字符命名风格转换')).toBeInTheDocument();
    expect(screen.getByText('编辑器界面与缩进行为')).toBeInTheDocument();
    expect(screen.queryByText(/编辑器展示配置与字符命名转换/)).not.toBeInTheDocument();
  });

  it('JSON 缩进非法值:提示校验错误且不落库', async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation(() => Promise.resolve({ success: true, data: true }));
    render(<JsonFormatterSection />);
    const input = screen.getByLabelText(/JSON 默认缩进/) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '99');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText(/缩进需为 0-8 之间的整数/)).toBeInTheDocument();
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'config_set')).toHaveLength(0);
  });
});

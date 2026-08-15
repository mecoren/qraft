import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { App } from './App';
import type { ToolMetadata } from '@/types/tool';
import type { CommandResponse } from '@/types/ipc';
import type { UserConfig } from '@/types/config';
import { DEFAULT_USER_CONFIG } from '@/types/config';
import { useToolStateStore } from '@/store/toolStateStore';
import { useUiStore } from '@/store/uiStore';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

// 仅用于满足 tool_list IPC 的 happy-path mock;侧栏实际从静态目录渲染
const tools: ToolMetadata[] = [
  {
    id: 'json_formatter',
    name: 'JSON Formatter',
    description: '',
    category: 'formatter',
    icon: 'Braces',
    version: '0.1.0',
    input_schema: {},
    timeout_secs: null,
    streaming_supported: false,
    tags: [],
  },
];

function setupHappyPath() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'config_get_all') {
      return Promise.resolve({
        success: true,
        data: { ...DEFAULT_USER_CONFIG },
      } as CommandResponse<UserConfig>);
    }
    if (cmd === 'tool_list') {
      return Promise.resolve({
        success: true,
        data: tools,
      } as CommandResponse<ToolMetadata[]>);
    }
    if (cmd === 'history_list') {
      return Promise.resolve({ success: true, data: [] });
    }
    return Promise.resolve({ success: true, data: null });
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  // uiStore 经 localStorage 持久化,跨测试会泄漏,这里复位到确定状态
  useUiStore.setState({
    view: 'welcome',
    sidebarCollapsed: false,
    favorites: [],
    recents: [],
    expandedCategories: [],
  });
  useToolStateStore.setState({
    availableTools: [],
    currentToolId: null,
    running: false,
    streamingTasks: new Map(),
  });
});

describe('App', () => {
  it('renders SideNav with tool groups after mount', async () => {
    setupHappyPath();
    await act(async () => {
      render(<App />);
    });
    const sidebar = screen.getByRole('navigation');
    expect(sidebar).toBeInTheDocument();
    // 分类分组标题渲染(默认折叠,仅显示分组标签)
    // 限定在侧栏内查询:欢迎页「所有工具」分区也含分类名,会与侧栏重名
    expect(await within(sidebar).findByText('格式化工具')).toBeInTheDocument();
    expect(within(sidebar).getByText('编解码器')).toBeInTheDocument();
  });

  it('clicking a tool switches main area to ToolPanel', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    // 展开「格式化工具」分类,使工具按钮可见(限定在侧栏内查询,避免与欢迎页网格卡片重名)
    const sidebar = screen.getByRole('navigation');
    await user.click(await within(sidebar).findByTestId('nav-cat-formatter'));
    await user.click(await within(sidebar).findByRole('button', { name: /JSON 格式化器/i }));
    // 标题栏左段显示当前工具名(工具标题区已迁移至 Titlebar)
    expect(await screen.findByTestId('titlebar-tool-name')).toHaveTextContent(/JSON 格式化器/i);
    // 当前工具已切换
    expect(useToolStateStore.getState().currentToolId).toBe('json_formatter');
  });

  it('Ctrl+K opens CommandPalette', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Control>}{k}{/Control}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { App } from './App';
import { useToolStateStore } from '@/store/toolStateStore';
import { useHistoryStore } from '@/store/historyStore';
import { useConfigStore } from '@/store/configStore';
import { useUiStore } from '@/store/uiStore';
import type { ToolMetadata } from '@/types/tool';
import type { CommandResponse } from '@/types/ipc';
import type { UserConfig, HistoryEntry } from '@/types';
import { DEFAULT_USER_CONFIG } from '@/types/config';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

// 仅用于满足 tool_list IPC 的 happy-path mock;侧栏/命令面板实际从静态目录渲染
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
    tags: ['json'],
  },
  {
    id: 'base64_codec',
    name: 'Base64 Codec',
    description: '',
    category: 'encoder',
    icon: 'Binary',
    version: '0.1.0',
    input_schema: {},
    timeout_secs: null,
    streaming_supported: false,
    tags: ['base64'],
  },
];

const historyEntry: HistoryEntry = {
  id: 'h-1',
  toolId: 'json_formatter',
  timestamp: '2026-07-25T10:00:00Z',
  inputSummary: { textPreview: '{}', textBytes: 2, params: {}, redacted: false },
  outputSummary: { textPreview: '{}', textBytes: 2, redacted: false },
  success: true,
  durationMs: 1,
};

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
      return Promise.resolve({
        success: true,
        data: [historyEntry],
      } as CommandResponse<HistoryEntry[]>);
    }
    return Promise.resolve({ success: true, data: null });
  });
}

beforeEach(() => {
  invokeMock.mockReset();
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
  useHistoryStore.setState({ entries: [], loading: false, error: null });
  useConfigStore.setState({ config: null, loading: false, error: null });
});

describe('smoke: SideNav 显示工具分组', () => {
  it('渲染工具分类分组标题', async () => {
    setupHappyPath();
    await act(async () => {
      render(<App />);
    });
    // 当前 7 个分类分组标题均渲染(默认折叠,仅显示分组标签)
    // 限定在侧栏内查询:欢迎页「所有工具」分区也含分类名,会与侧栏重名
    const sidebar = screen.getByRole('navigation');
    expect(await within(sidebar).findByText('编解码器')).toBeInTheDocument();
    expect(within(sidebar).getByText('格式化工具')).toBeInTheDocument();
  });

  it('展开分组后工具渲染为按钮', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    // 展开「编解码器」分组(限定在侧栏内查询,避免与欢迎页网格卡片重名)
    const sidebar = screen.getByRole('navigation');
    await user.click(await within(sidebar).findByTestId('nav-cat-encoder'));
    // 该分组下的工具渲染为按钮
    expect(
      await within(sidebar).findByRole('button', { name: /Base64文本编码\/解码/i }),
    ).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: /GZip压缩\/解压缩/i })).toBeInTheDocument();
  });
});

describe('smoke: 点击工具切换 ToolPanel', () => {
  it('点击工具后主区域显示该工具名', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    const sidebar = screen.getByRole('navigation');
    await user.click(await within(sidebar).findByTestId('nav-cat-formatter'));
    await user.click(await within(sidebar).findByRole('button', { name: /JSON 格式化器/i }));
    // 主区域页头显示工具名
    expect(
      await screen.findByRole('heading', { level: 1, name: /JSON 格式化器/i }),
    ).toBeInTheDocument();
  });

  it('切换工具后 currentToolId 更新', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    const sidebar = screen.getByRole('navigation');
    await user.click(await within(sidebar).findByTestId('nav-cat-encoder'));
    await user.click(await within(sidebar).findByRole('button', { name: /Base64文本编码\/解码/i }));
    expect(useToolStateStore.getState().currentToolId).toBe('base64_codec');
  });
});

describe('smoke: Ctrl+K 打开 CommandPalette', () => {
  it('按 Ctrl+K 出现 dialog,Esc 关闭', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Control>}{k}{/Control}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    // Radix Dialog 通过 onOpenChange 关闭,可能需等待 React 处理
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('命令面板中输入 base64 后显示相关工具', async () => {
    setupHappyPath();
    const user = userEvent.setup();
    await act(async () => {
      render(<App />);
    });
    await user.keyboard('{Control>}{k}{/Control}');
    const dialog = await screen.findByRole('dialog');
    const input = dialog.querySelector('input') as HTMLInputElement;
    await user.type(input, 'base64');
    // base64 相关工具出现(现含文本与图片两个)
    expect(screen.getByRole('option', { name: /Base64文本编码\/解码/i })).toBeInTheDocument();
    // 不相关工具被过滤
    expect(screen.queryByRole('option', { name: /Cron 表达式解析器/i })).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Titlebar } from './Titlebar';
import { useUiStore } from '@/store/uiStore';
import { useToolStateStore } from '@/store/toolStateStore';
import { useToolMenusStore } from '@/store/toolMenubarStore';
import type { ToolMenu } from '@/types/tool-menu';

/** 模拟一个工具注册的菜单(等价于 EditorWorkbench 挂载后的 store 状态) */
function registerMenus(toolId: string): void {
  const menus: ToolMenu[] = [
    {
      id: 'file',
      label: '文件',
      groups: [
        {
          items: [{ id: 'new', label: '新建', onSelect: vi.fn() }],
        },
      ],
    },
  ];
  useToolMenusStore.getState().setMenus(toolId, menus);
}

beforeEach(() => {
  useToolMenusStore.getState().clear();
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

describe('Titlebar', () => {
  it('shows the current tool icon + name on the left in tool view', () => {
    useUiStore.setState({ view: 'tool' });
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    render(<Titlebar />);
    // 左区展示当前工具名,中间品牌 Qraft 仍在
    expect(screen.getByTestId('titlebar-tool-name')).toHaveTextContent(/Base64/i);
    expect(screen.getByText('Qraft')).toBeInTheDocument();
  });

  it('hides the tool title on non-tool views (e.g. welcome)', () => {
    useUiStore.setState({ view: 'welcome' });
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    render(<Titlebar />);
    expect(screen.queryByTestId('titlebar-tool-name')).not.toBeInTheDocument();
    expect(screen.getByText('Qraft')).toBeInTheDocument();
  });

  it('shows the tool description in a tooltip when hovering the tool title', async () => {
    useUiStore.setState({ view: 'tool' });
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    render(<Titlebar />);
    const trigger = screen.getByTestId('titlebar-tool');
    // Radix Tooltip 由 pointermove 触发打开
    fireEvent.pointerMove(trigger);
    const tooltip = await screen.findByRole('tooltip', {}, { timeout: 2000 });
    expect(tooltip).toHaveTextContent(/Base64/i);
  });

  it('shows the tool icon + name followed by the menubar when the active tool owns menus', () => {
    useUiStore.setState({ view: 'tool' });
    useToolStateStore.setState({ currentToolId: 'text_editor' });
    registerMenus('text_editor');
    render(<Titlebar />);
    // 工具名与菜单栏同时存在,且工具名位于菜单栏左侧
    const tool = screen.getByTestId('titlebar-tool');
    const menubar = screen.getByTestId('tool-menubar');
    expect(screen.getByTestId('titlebar-tool-name')).toHaveTextContent(/文本编辑器/i);
    expect(tool.compareDocumentPosition(menubar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides the menubar when menus belong to another (previously visited) tool', () => {
    // 模拟 keepalive:编辑器已访问并注册菜单,但当前激活的是其他工具
    useUiStore.setState({ view: 'tool' });
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    registerMenus('text_editor');
    render(<Titlebar />);
    // 菜单归属工具 ≠ 当前激活工具:其他功能不显示左上角菜单栏
    expect(screen.queryByTestId('tool-menubar')).not.toBeInTheDocument();
    expect(screen.getByTestId('titlebar-tool-name')).toHaveTextContent(/Base64/i);
  });

  it('hides the menubar on non-tool views even when the active tool owns menus', () => {
    useUiStore.setState({ view: 'history' });
    useToolStateStore.setState({ currentToolId: 'text_editor' });
    registerMenus('text_editor');
    render(<Titlebar />);
    // 历史/欢迎/扩展等非工具页一律不显示菜单栏
    expect(screen.queryByTestId('tool-menubar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('titlebar-tool-name')).not.toBeInTheDocument();
  });
});

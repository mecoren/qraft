import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  it('shows the project Logo + name on the left and the current tool icon + name in the center in tool view', () => {
    useUiStore.setState({ view: 'tool' });
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    render(<Titlebar />);
    // 左区展示品牌 Qraft,中区展示当前工具名
    expect(screen.getByText('Qraft')).toBeInTheDocument();
    expect(screen.getByTestId('titlebar-tool-name')).toHaveTextContent(/Base64/i);
  });

  it('hides the tool title on non-tool views (e.g. welcome)', () => {
    useUiStore.setState({ view: 'welcome' });
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    render(<Titlebar />);
    expect(screen.queryByTestId('titlebar-tool-name')).not.toBeInTheDocument();
    expect(screen.getByText('Qraft')).toBeInTheDocument();
  });

  it('exposes the tool description via native title (rendered by the global hint layer)', () => {
    useUiStore.setState({ view: 'tool' });
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    render(<Titlebar />);
    // 提示走原生 title + 全局接管模块:与查找组件浮层同一机制/样式,
    // 悬停时由 global-title-tooltip 渲染为 HINT_LAYER(不在本组件测试范围)
    const trigger = screen.getByTestId('titlebar-tool');
    expect(trigger).toHaveAttribute('title');
    expect(trigger.getAttribute('title')).toMatch(/Base64/i);
  });

  it('places the menubar next to the brand in the left segment, with the tool name centered', () => {
    useUiStore.setState({ view: 'tool' });
    useToolStateStore.setState({ currentToolId: 'text_editor' });
    registerMenus('text_editor');
    render(<Titlebar />);
    // 左段为「品牌 Qraft + 菜单栏」,中段为「工具名」,菜单栏在 DOM 中先于工具名
    const brand = screen.getByText('Qraft');
    const tool = screen.getByTestId('titlebar-tool');
    const menubar = screen.getByTestId('tool-menubar');
    expect(screen.getByTestId('titlebar-tool-name')).toHaveTextContent(/文本编辑器/i);
    expect(brand.compareDocumentPosition(menubar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(menubar.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

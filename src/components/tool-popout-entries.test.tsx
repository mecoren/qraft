import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { Titlebar } from './layout/Titlebar';
import { CommandPalette } from './CommandPalette';
import { Sidebar } from './layout/Sidebar';
import { useUiStore } from '@/store/uiStore';
import { useToolStateStore } from '@/store/toolStateStore';

/**
 * 「在新窗口打开」三处触发入口的交互测试。
 * openToolInNewWindow 经 mock 隔离,仅验证入口到调用的接线。
 */
const openPopout = vi.hoisted(() => vi.fn<(toolId: string) => Promise<void>>());
vi.mock('@/lib/popout-window', () => ({
  openToolInNewWindow: (...args: Parameters<typeof openPopout>) => openPopout(...args),
  isPopoutSupported: (toolId: string) => toolId === 'base64_codec' || toolId === 'text_compare',
}));

beforeEach(() => {
  openPopout.mockClear();
  openPopout.mockResolvedValue(undefined);
  useUiStore.setState({
    view: 'tool',
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

describe('标题栏弹出按钮', () => {
  it('工具视图下展示弹出按钮,点击以当前工具调用', async () => {
    useUiStore.setState({ view: 'tool' });
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    render(<Titlebar />);
    const btn = screen.getByTestId('titlebar-popout');
    expect(btn).toHaveAttribute('aria-label', '在新窗口打开');
    const user = userEvent.setup();
    await user.click(btn);
    expect(openPopout).toHaveBeenCalledWith('base64_codec');
  });

  it('非工具视图(欢迎页)不渲染弹出按钮', () => {
    useUiStore.setState({ view: 'welcome' });
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    render(<Titlebar />);
    expect(screen.queryByTestId('titlebar-popout')).not.toBeInTheDocument();
  });
});

describe('命令面板弹出动作', () => {
  it('当前工具存在时展示动作项,点击后调用并关闭面板', async () => {
    useToolStateStore.setState({ currentToolId: 'base64_codec' });
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('option', { name: '在新窗口打开当前工具' }));
    expect(openPopout).toHaveBeenCalledWith('base64_codec');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('无当前工具(欢迎页)时动作项隐藏', () => {
    useToolStateStore.setState({ currentToolId: null });
    render(<CommandPalette open onOpenChange={vi.fn()} />);
    expect(screen.queryByRole('option', { name: '在新窗口打开当前工具' })).not.toBeInTheDocument();
  });
});

describe('侧栏右键菜单弹出项', () => {
  async function openContextMenuOnBase64(user: UserEvent): Promise<void> {
    render(<Sidebar />);
    const sidebar = screen.getByTestId('sidebar');
    await user.click(within(sidebar).getByTestId('nav-cat-encoder'));
    const btn = within(sidebar).getByRole('button', { name: /Base64 转换器/i });
    await user.pointer({ keys: '[MouseRight]', target: btn });
  }

  it('工具项右键首项为「在新窗口打开」,点击后调用', async () => {
    const user = userEvent.setup();
    await openContextMenuOnBase64(user);
    await user.click(await screen.findByRole('menuitem', { name: '在新窗口打开' }));
    expect(openPopout).toHaveBeenCalledWith('base64_codec');
  });

  it('固定的文本编辑器右键含「在新窗口打开」,点击后调用', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const sidebar = screen.getByTestId('sidebar');
    const btn = within(sidebar).getByTestId('nav-text-editor');
    await user.pointer({ keys: '[MouseRight]', target: btn });
    await user.click(await screen.findByRole('menuitem', { name: '在新窗口打开' }));
    expect(openPopout).toHaveBeenCalledWith('text_editor');
  });
});

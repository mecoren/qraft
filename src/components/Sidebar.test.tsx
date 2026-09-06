import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { Sidebar } from './layout/Sidebar';
import { useUiStore } from '@/store/uiStore';
import { useToolStateStore } from '@/store/toolStateStore';

beforeEach(() => {
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

/** 渲染侧栏并返回容器 nav */
function renderSidebar(): HTMLElement {
  render(<Sidebar />);
  return screen.getByTestId('sidebar');
}

/** 在按钮上右键,打开 Radix ContextMenu(菜单内容渲染在 portal 中) */
async function openContextMenu(user: UserEvent, btn: HTMLElement): Promise<void> {
  await user.pointer({ keys: '[MouseRight]', target: btn });
}

describe('Sidebar 工具右键菜单', () => {
  it('分类内工具右键弹出「收藏」,点击后加入收藏夹', async () => {
    const user = userEvent.setup();
    const sidebar = renderSidebar();
    await user.click(within(sidebar).getByTestId('nav-cat-encoder'));
    const btn = within(sidebar).getByRole('button', { name: /Base64 转换器/i });
    await openContextMenu(user, btn);
    await user.click(await screen.findByRole('menuitem', { name: '收藏' }));
    expect(useUiStore.getState().favorites).toEqual(['base64_codec']);
  });

  it('收藏夹内工具右键显示「取消收藏」,点击后移出收藏夹', async () => {
    useUiStore.setState({ favorites: ['base64_codec'] });
    const user = userEvent.setup();
    renderSidebar();
    const btn = screen.getByRole('button', { name: /Base64 转换器/i });
    await openContextMenu(user, btn);
    await user.click(await screen.findByRole('menuitem', { name: '取消收藏' }));
    expect(useUiStore.getState().favorites).toEqual([]);
  });

  it('固定「文本编辑器」条目右键仅含「在新窗口打开」(不支持收藏/排序)', async () => {
    const user = userEvent.setup();
    renderSidebar();
    // 固定条目始终排第一且不可收藏:右键仅提供弹出,不含收藏/排序
    const btn = screen.getByTestId('nav-text-editor');
    await openContextMenu(user, btn);
    expect(await screen.findByRole('menuitem', { name: '在新窗口打开' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '收藏' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '取消收藏' })).not.toBeInTheDocument();
  });

  it('收藏的工具以平铺方式直接显示在固定文本编辑器下方', () => {
    useUiStore.setState({ favorites: ['base64_codec', 'json_formatter'] });
    const sidebar = renderSidebar();
    // 无「收藏夹」分组标题
    expect(screen.queryByTestId('nav-favorites')).not.toBeInTheDocument();
    // 顺序:文本编辑器 → 收藏工具 → 分类分组
    const editor = screen.getByTestId('nav-text-editor');
    const base64 = within(sidebar).getByRole('button', { name: /Base64 转换器/i });
    const json = within(sidebar).getByRole('button', { name: /JSON 格式化器/i });
    const encoderCat = screen.getByTestId('nav-cat-encoder');
    expect(editor.compareDocumentPosition(base64) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(base64.compareDocumentPosition(json) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      json.compareDocumentPosition(encoderCat) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('「编辑器」分类分组渲染,展开后「PDF 编辑器」为二级菜单项', async () => {
    const user = userEvent.setup();
    const sidebar = renderSidebar();
    const cat = screen.getByTestId('nav-cat-editor');
    await user.click(cat);
    const pdf = within(sidebar).getByRole('button', { name: /PDF 编辑器/i });
    // PDF 编辑器是分组内的二级项(depth=1),且位于分组头之后
    expect(cat.compareDocumentPosition(pdf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('「编辑器」分组内不重复渲染固定的文本编辑器', async () => {
    const user = userEvent.setup();
    const sidebar = renderSidebar();
    await user.click(screen.getByTestId('nav-cat-editor'));
    // 固定项仅顶部一个:全侧栏名为「文本编辑器」的按钮只有固定条目本身
    expect(within(sidebar).getAllByRole('button', { name: /^文本编辑器$/ })).toHaveLength(1);
    // 分组内仅 PDF 编辑器一个子项
    expect(within(sidebar).getAllByRole('button', { name: /PDF 编辑器/i })).toHaveLength(1);
  });

  it('分类内的「PDF 编辑器」右键可收藏(普通工具语义)', async () => {
    const user = userEvent.setup();
    const sidebar = renderSidebar();
    await user.click(screen.getByTestId('nav-cat-editor'));
    const btn = within(sidebar).getByRole('button', { name: /PDF 编辑器/i });
    await openContextMenu(user, btn);
    await user.click(await screen.findByRole('menuitem', { name: '收藏' }));
    expect(useUiStore.getState().favorites).toEqual(['pdf_editor']);
  });

  it('收藏的 PDF 编辑器平铺在固定文本编辑器下方(无重复固定项)', () => {
    useUiStore.setState({ favorites: ['pdf_editor'] });
    const sidebar = renderSidebar();
    expect(within(sidebar).getAllByRole('button', { name: /PDF 编辑器/i })).toHaveLength(1);
    const editor = screen.getByTestId('nav-text-editor');
    const pdf = within(sidebar).getByRole('button', { name: /PDF 编辑器/i });
    expect(editor.compareDocumentPosition(pdf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('旧数据中收藏的文本编辑器不重复渲染', () => {
    useUiStore.setState({ favorites: ['text_editor', 'base64_codec'] });
    const sidebar = renderSidebar();
    // 固定项仅一个,收藏列表过滤掉 text_editor
    expect(within(sidebar).getAllByRole('button', { name: /文本编辑器/i })).toHaveLength(1);
    expect(useUiStore.getState().favorites).toContain('text_editor'); // store 不静默改写,仅展示层过滤
    expect(within(sidebar).getByRole('button', { name: /Base64 转换器/i })).toBeInTheDocument();
  });

  it('收藏为空时不显示提示文案', () => {
    renderSidebar();
    expect(screen.queryByText('右键点击侧栏中的工具即可收藏')).not.toBeInTheDocument();
  });

  it('未收藏的工具右键不显示「上移/下移」', async () => {
    const user = userEvent.setup();
    const sidebar = renderSidebar();
    await user.click(within(sidebar).getByTestId('nav-cat-encoder'));
    const btn = within(sidebar).getByRole('button', { name: /Base64 转换器/i });
    await openContextMenu(user, btn);
    await screen.findByRole('menuitem', { name: '收藏' });
    expect(screen.queryByRole('menuitem', { name: '上移' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '下移' })).not.toBeInTheDocument();
  });

  it('收藏夹首项「上移」禁用、「下移」可用', async () => {
    useUiStore.setState({ favorites: ['base64_codec', 'json_formatter'] });
    const user = userEvent.setup();
    renderSidebar();
    const firstBtn = screen.getByRole('button', { name: /Base64 转换器/i });
    await openContextMenu(user, firstBtn);
    const up = await screen.findByRole('menuitem', { name: '上移' });
    expect(up).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '下移' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('收藏夹末项「下移」禁用、「上移」可用', async () => {
    useUiStore.setState({ favorites: ['base64_codec', 'json_formatter'] });
    const user = userEvent.setup();
    renderSidebar();
    const lastBtn = screen.getByRole('button', { name: /JSON 格式化器/i });
    await openContextMenu(user, lastBtn);
    const down = await screen.findByRole('menuitem', { name: '下移' });
    expect(down).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '上移' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('收藏夹内右键「上移」调整收藏顺序', async () => {
    useUiStore.setState({ favorites: ['base64_codec', 'json_formatter'] });
    const user = userEvent.setup();
    renderSidebar();
    const lastBtn = screen.getByRole('button', { name: /JSON 格式化器/i });
    await openContextMenu(user, lastBtn);
    await user.click(await screen.findByRole('menuitem', { name: '上移' }));
    expect(useUiStore.getState().favorites).toEqual(['json_formatter', 'base64_codec']);
  });

  it('收藏夹内右键「下移」调整收藏顺序', async () => {
    useUiStore.setState({ favorites: ['base64_codec', 'json_formatter'] });
    const user = userEvent.setup();
    renderSidebar();
    const firstBtn = screen.getByRole('button', { name: /Base64 转换器/i });
    await openContextMenu(user, firstBtn);
    await user.click(await screen.findByRole('menuitem', { name: '下移' }));
    expect(useUiStore.getState().favorites).toEqual(['json_formatter', 'base64_codec']);
  });

  it('搜索结果中的工具右键可收藏', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.type(screen.getByLabelText('搜索工具'), 'json');
    const btn = screen.getByRole('button', { name: /JSON 格式化器/i });
    await openContextMenu(user, btn);
    await user.click(await screen.findByRole('menuitem', { name: '收藏' }));
    expect(useUiStore.getState().favorites).toEqual(['json_formatter']);
  });

  it('排序后重开菜单,禁用态随新位置迁移(上移后成为首项则「上移」禁用)', async () => {
    useUiStore.setState({
      favorites: ['base64_codec', 'json_formatter', 'markdown_preview'],
    });
    const user = userEvent.setup();
    renderSidebar();
    const middleBtn = screen.getByRole('button', { name: /JSON 格式化器/i });
    await openContextMenu(user, middleBtn);
    await user.click(await screen.findByRole('menuitem', { name: '上移' }));
    expect(useUiStore.getState().favorites).toEqual([
      'json_formatter',
      'base64_codec',
      'markdown_preview',
    ]);
    // 关闭菜单后重新右键同一工具(现为首项),「上移」应变为禁用
    await user.keyboard('{Escape}');
    await openContextMenu(user, middleBtn);
    expect(await screen.findByRole('menuitem', { name: '上移' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('搜索结果中的固定文本编辑器不显示收藏菜单', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.type(screen.getByLabelText('搜索工具'), '文本编辑器');
    const btn = screen.getByRole('button', { name: /文本编辑器/i });
    await openContextMenu(user, btn);
    // 固定条目同样只提供弹出,搜索结果中也不出现收藏入口
    expect(await screen.findByRole('menuitem', { name: '在新窗口打开' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '收藏' })).not.toBeInTheDocument();
  });

  it('非工具条目(所有工具/管理扩展/设置)右键均不弹出菜单', async () => {
    const user = userEvent.setup();
    const sidebar = renderSidebar();
    // 固定「文本编辑器」属于工具条目,有意提供「在新窗口打开」,不在此列
    for (const name of ['所有工具', '管理扩展', '设置']) {
      const btn = within(sidebar).getByRole('button', { name });
      await openContextMenu(user, btn);
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    }
  });
});
